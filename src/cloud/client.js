// -----------------------------------------------------------------------------
// The Xiaomi account, used once to list the devices with their local address,
// model and token. Everything else is local (src/miio/).
//
// Login, as the Mi Home app does it (after the Apache-2.0 client of
// hass-xiaomi-miot):
//   1. GET  account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true
//      → `_sign`, `qs`, `callback`;
//   2. POST account.xiaomi.com/pass/serviceLoginAuth2 with the e-mail or
//      phone, MD5(password) in upper case and step 1's fields
//      → `ssecurity`, `userId` and a `location`; or a `notificationUrl`
//      (two-step verification) or a `captchaUrl`;
//   3. GET  the location → the `serviceToken` cookie.
// Two-step verification: the user opens the notification URL, asks for the
// code there (SMS or e-mail) WITHOUT entering it on the page, and gives it to
// us: `identity/list` (same URL, other path) gives an `identity_session`,
// `identity/auth/verifyPhone` (or verifyEmail) takes the code and gives a
// location to follow; step 1 then answers with `ssecurity` directly.
//
// Then one RC4-encrypted call: POST <region>.api.io.mi.com/app/home/device_list.
//
// The password and the tokens never reach the logs: the errors carry a code,
// never the request.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { decryptValue, rc4Form } from './crypto.js';

export const ACCOUNT_URL = 'https://account.xiaomi.com';
export const REGIONS = ['cn', 'de', 'i2', 'ru', 'sg', 'us'];
const SID = 'xiaomiio';
const TIMEOUT_MS = 20_000;
// The pending two-step verification is kept this long in memory.
export const VERIFICATION_TTL_MS = 15 * 60_000;

export class CloudError extends Error {
  /**
   * @param {string} message never a secret
   * @param {'credentials'|'verification'|'bad-code'|'captcha'|'network'|'api'} kind
   * @param {object} [details] `verifyUrl` for kind `verification`
   */
  constructor(message, kind, details = {}) {
    super(message);
    this.name = 'CloudError';
    this.kind = kind;
    Object.assign(this, details);
  }
}

/** API base URL of a region: `cn` has no prefix. */
export function apiBase(region) {
  return region === 'cn' ? 'https://api.io.mi.com/app' : `https://${region}.api.io.mi.com/app`;
}

const randomId = (length) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
};

/** The JSON of an account answer, prefixed with `&&&START&&&`. */
export function parseAccountJson(text) {
  try {
    return JSON.parse(String(text).replace('&&&START&&&', ''));
  } catch {
    return null;
  }
}

/** A small cookie jar: name → value, fed by every Set-Cookie seen. */
class Jar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
  }

  take(response) {
    const lines =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute.trim()));
      if (expired || value === '' || value === 'EXPIRED') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get(name) {
    return this.cookies.get(name);
  }

  header(extra = {}) {
    const all = new Map([...this.cookies, ...Object.entries(extra)]);
    return [...all].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export class XiaomiCloud {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] test seam
   * @param {() => number} [options.now]
   */
  constructor({ fetch: fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    /** Login waiting for its verification code: one at a time. */
    this.pending = null;
  }

  async http(url, { method = 'GET', jar, body, headers = {}, cookies = {} } = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        method,
        body,
        redirect: 'manual',
        headers: {
          'User-Agent':
            this.userAgent ??
            'Android-7.1.1-1.0.0-ONEPLUS A3010-136 APP/xiaomi.smarthome APPV/62830',
          ...(body instanceof URLSearchParams
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
          ...headers,
          Cookie: jar.header(cookies),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const code = err?.cause?.code ?? err?.name ?? 'error';
      throw new CloudError(`Cannot reach ${new URL(url).host} (${code})`, 'network');
    }
    jar.take(response);
    return response;
  }

  /** GET following the redirects by hand, so every hop feeds the jar. */
  async follow(url, jar) {
    let current = url;
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await this.http(current, { jar });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return { response, url: current };
    }
    throw new CloudError('Too many redirects from the Xiaomi account', 'api');
  }

  /**
   * Log in. Resolves with the session `{ userId, ssecurity, serviceToken }`.
   * @param {object} credentials `{ username, password }`
   * @param {object} [options]
   * @param {string} [options.code] the two-step verification code
   * @throws CloudError (kind `verification` carries `verifyUrl`)
   */
  async login({ username, password }, { code } = {}) {
    if (code && this.pending && this.pending.username === username) {
      if (this.now() - this.pending.at > VERIFICATION_TTL_MS) {
        this.pending = null;
      } else {
        return this.verify(code);
      }
    }
    this.pending = null;
    const deviceId = randomId(16);
    this.userAgent = `Android-7.1.1-1.0.0-ONEPLUS A3010-136-${deviceId} APP/xiaomi.smarthome APPV/62830`;
    const jar = new Jar({ sdkVersion: '3.8.6', deviceId });

    const sign = await this.serviceLogin(jar);
    if (sign.code === 0 && sign.location && sign.ssecurity) {
      return this.finish(jar, sign);
    }
    const form = new URLSearchParams({
      user: username,
      hash: createHash('md5').update(String(password)).digest('hex').toUpperCase(),
      callback: sign.callback ?? '',
      sid: sign.sid ?? SID,
      qs: sign.qs ?? '',
      _sign: sign._sign ?? '',
    });
    const response = await this.http(`${ACCOUNT_URL}/pass/serviceLoginAuth2?_json=true`, {
      method: 'POST',
      jar,
      body: form,
    });
    const auth = parseAccountJson(await response.text());
    if (!auth) {
      throw new CloudError(`Unexpected answer from the Xiaomi account (${response.status})`, 'api');
    }
    if (auth.location && auth.ssecurity) {
      return this.finish(jar, auth);
    }
    if (auth.notificationUrl) {
      const verifyUrl = absolute(auth.notificationUrl);
      this.pending = { username, jar, verifyUrl, at: this.now() };
      throw new CloudError('Xiaomi asks for a two-step verification', 'verification', {
        verifyUrl,
      });
    }
    if (auth.captchaUrl) {
      throw new CloudError('Xiaomi asks for a captcha', 'captcha');
    }
    if ([20003, 70002, 70016].includes(auth.code)) {
      throw new CloudError(
        `Xiaomi refused the e-mail or the password (code ${auth.code})`,
        'credentials',
      );
    }
    throw new CloudError(`Xiaomi refused the login (code ${auth.code ?? response.status})`, 'api');
  }

  async serviceLogin(jar) {
    const response = await this.http(`${ACCOUNT_URL}/pass/serviceLogin?sid=${SID}&_json=true`, {
      jar,
    });
    const sign = parseAccountJson(await response.text());
    if (!sign) {
      throw new CloudError(`Unexpected answer from the Xiaomi account (${response.status})`, 'api');
    }
    return sign;
  }

  /** Step 3: the location gives the service token. */
  async finish(jar, auth) {
    const { response } = await this.follow(auth.location, jar);
    const serviceToken = jar.get('serviceToken');
    if (!serviceToken) {
      throw new CloudError(`No service token from Xiaomi (${response.status})`, 'api');
    }
    this.pending = null;
    return {
      userId: String(auth.userId ?? jar.get('userId') ?? ''),
      ssecurity: auth.ssecurity,
      serviceToken,
    };
  }

  /** Two-step verification, with the code the user received. */
  async verify(code) {
    const { jar, verifyUrl } = this.pending;
    const listUrl = verifyUrl.replace('fe/service/identity/authStart', 'identity/list');
    const listing = await this.http(listUrl, { jar });
    const identity = parseAccountJson(await listing.text()) ?? {};
    const identitySession = jar.get('identity_session');
    if (!identitySession) {
      throw new CloudError('The Xiaomi verification page did not open a session', 'api');
    }
    const flags =
      Array.isArray(identity.options) && identity.options.length > 0
        ? identity.options
        : [identity.flag ?? 4];
    let answer = null;
    for (const flag of flags) {
      const path = { 4: 'verifyPhone', 8: 'verifyEmail' }[flag];
      if (!path) {
        continue;
      }
      const response = await this.http(`${ACCOUNT_URL}/identity/auth/${path}?_dc=${this.now()}`, {
        method: 'POST',
        jar,
        body: new URLSearchParams({
          _flag: String(flag),
          ticket: String(code).trim(),
          trust: 'false',
          _json: 'true',
        }),
      });
      answer = parseAccountJson(await response.text());
      if (answer?.code === 0 && answer.location) {
        break;
      }
    }
    if (!answer || answer.code !== 0 || !answer.location) {
      throw new CloudError(
        `Xiaomi refused the verification code (code ${answer?.code ?? '?'})`,
        'bad-code',
      );
    }
    const landed = await this.follow(answer.location, jar);
    // Some accounts land on a "confirm your phone" page with a skip link.
    const skip = new URL(landed.url).searchParams.get('skipUrl');
    if (new URL(landed.url).pathname.startsWith('/fe/') && skip) {
      await this.follow(absolute(skip), jar);
    }
    // Logged in on the account: step 1 now answers with the security keys.
    const sign = await this.serviceLogin(jar);
    if (!sign.location || !sign.ssecurity) {
      throw new CloudError(`Xiaomi did not complete the login (code ${sign.code ?? '?'})`, 'api');
    }
    return this.finish(jar, sign);
  }

  /**
   * The devices of the account, as the Mi Home app lists them.
   * @param {{ userId: string, ssecurity: string, serviceToken: string }} session
   * @param {string} region
   * @returns {Promise<Array<object>>} raw entries (did, token, localip, model, name...)
   */
  async listDevices(session, region) {
    const url = `${apiBase(region)}/home/device_list`;
    const { form, nonceSigned } = rc4Form({
      url,
      ssecurity: session.ssecurity,
      data: {
        getVirtualModel: false,
        getHuamiDevices: 0,
        get_split_device: false,
        support_smart_home: true,
      },
    });
    const jar = new Jar({
      userId: session.userId,
      yetAnotherServiceToken: session.serviceToken,
      serviceToken: session.serviceToken,
      locale: 'en_GB',
      channel: 'MI_APP_STORE',
    });
    const response = await this.http(url, {
      method: 'POST',
      jar,
      body: form,
      headers: {
        'X-XIAOMI-PROTOCAL-FLAG-CLI': 'PROTOCAL-HTTP2',
        'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
        'Accept-Encoding': 'identity',
      },
    });
    const text = await response.text();
    let answer = parseAccountJson(text);
    if (!answer) {
      try {
        answer = JSON.parse(decryptValue(nonceSigned, text));
      } catch {
        answer = null;
      }
    }
    if (!answer || answer.code !== 0) {
      throw new CloudError(
        `Xiaomi did not list the devices (code ${answer?.code ?? response.status})`,
        'api',
      );
    }
    return Array.isArray(answer.result?.list) ? answer.result.list : [];
  }
}

function absolute(url) {
  return /^https?:/.test(url) ? url : `${ACCOUNT_URL}${url}`;
}
