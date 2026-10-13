// -----------------------------------------------------------------------------
// In-memory stand-ins for the two web services the integration calls, as
// `fetch` replacements (no network in the tests):
//
//   - miot-spec.org, serving the specification fixtures;
//   - the Xiaomi account and API, following the login flow of the Mi Home app:
//     serviceLogin → serviceLoginAuth2 → location → serviceToken, the two-step
//     verification (identity/list, verifyPhone) and the RC4-encrypted
//     home/device_list. The account answers are prefixed with &&&START&&& like
//     the real ones.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { decryptValue, encryptValue, signedNonce } from '../../src/cloud/crypto.js';
import { FIXTURES } from './fakeMiio.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

/** miot-spec.org with every fixture, or only `models`. */
export function createSpecServer({ models = Object.keys(FIXTURES) } = {}) {
  const server = {
    calls: [],
    down: false,
    fetch: async (url) => {
      server.calls.push(String(url));
      if (server.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      const parsed = new URL(url);
      if (parsed.pathname === '/miot-spec-v2/instances') {
        return json({
          instances: models.flatMap((model) => [
            { status: 'released', model, version: 1, type: FIXTURES[model].spec.type, ts: 1 },
            // An older draft that must not win.
            {
              status: 'debug',
              model,
              version: 9,
              type: `${FIXTURES[model].spec.type}-draft`,
              ts: 2,
            },
          ]),
        });
      }
      if (parsed.pathname === '/miot-spec-v2/instance') {
        const type = parsed.searchParams.get('type');
        const fixture = Object.values(FIXTURES).find((entry) => entry.spec.type === type);
        return fixture ? json(fixture.spec) : json({ error: 'not found' }, { status: 404 });
      }
      return json({}, { status: 404 });
    },
  };
  return server;
}

const START = '&&&START&&&';
const account = (body, headers = {}) =>
  new Response(`${START}${JSON.stringify(body)}`, { status: 200, headers });

function cookiesOf(init) {
  const header = init?.headers?.Cookie ?? '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)]),
  );
}

function withCookies(response, cookies) {
  for (const [name, value] of Object.entries(cookies)) {
    response.headers.append('set-cookie', `${name}=${value}; Path=/; Secure; HttpOnly`);
  }
  return response;
}

/**
 * The Xiaomi account of one user.
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {Array} options.devices raw device_list entries
 * @param {boolean} [options.twoStep] asks for a verification code
 * @param {string} [options.code] the code that verification accepts
 */
export function createXiaomiServer({
  username = 'user@example.com',
  password = 'correct horse',
  devices = [],
  twoStep = false,
  code = '123456',
  region = 'de',
} = {}) {
  const ssecurity = Buffer.from('ssecurity-of-tst').toString('base64');
  const server = {
    calls: [],
    down: false,
    captcha: false,
    // Everything the integration sent, to check no secret leaks elsewhere.
    bodies: [],
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      const cookies = cookiesOf(init);
      server.calls.push(`${init.method ?? 'GET'} ${parsed.host}${parsed.pathname}`);
      if (init.body) {
        server.bodies.push(String(init.body));
      }
      if (server.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const form = init.body instanceof URLSearchParams ? init.body : new URLSearchParams();

      if (parsed.host === 'account.xiaomi.com') {
        switch (parsed.pathname) {
          case '/pass/serviceLogin':
            if (cookies.passToken === 'pass-token') {
              return account({
                code: 0,
                location: 'https://sts.api.io.mi.com/sts?d=after-verification',
                ssecurity,
                userId: 1234567,
              });
            }
            return account({
              code: 70016,
              _sign: 'sign-of-step-1',
              qs: '%3Fsid%3Dxiaomiio',
              callback: 'https://sts.api.io.mi.com/sts',
              sid: 'xiaomiio',
            });
          case '/pass/serviceLoginAuth2': {
            const hash = createHash('md5').update(password).digest('hex').toUpperCase();
            if (form.get('_sign') !== 'sign-of-step-1') {
              return account({ code: 70002 });
            }
            if (form.get('user') !== username || form.get('hash') !== hash) {
              return account({ code: 70016, desc: 'wrong password' });
            }
            if (server.captcha) {
              return account({ code: 87001, captchaUrl: '/pass/getCode?icodeType=login' });
            }
            if (twoStep) {
              return account({
                code: 0,
                notificationUrl:
                  '/fe/service/identity/authStart?sid=xiaomiio&context=ctx-1&_locale=en_GB',
              });
            }
            return account({
              code: 0,
              location: 'https://sts.api.io.mi.com/sts?d=direct',
              ssecurity,
              userId: 1234567,
              nonce: 42,
            });
          }
          case '/identity/list':
            return withCookies(account({ code: 0, flag: 4, options: [4] }), {
              identity_session: 'identity-1',
            });
          case '/identity/auth/verifyPhone':
            if (cookies.identity_session !== 'identity-1' || form.get('ticket') !== code) {
              return account({ code: 70014, desc: 'wrong code' });
            }
            return account({
              code: 0,
              location: 'https://account.xiaomi.com/identity/result/check?sid=xiaomiio',
            });
          case '/identity/result/check':
            return withCookies(
              new Response(null, {
                status: 302,
                headers: { location: 'https://account.xiaomi.com/pass/userinfo' },
              }),
              { passToken: 'pass-token', userId: '1234567' },
            );
          case '/pass/userinfo':
            return new Response('<html></html>', { status: 200 });
          default:
            return new Response('not found', { status: 404 });
        }
      }
      if (parsed.host === 'sts.api.io.mi.com') {
        return withCookies(new Response('ok', { status: 200 }), { serviceToken: 'service-token' });
      }
      if (
        parsed.host === `${region}.api.io.mi.com` &&
        parsed.pathname === '/app/home/device_list'
      ) {
        const nonceSigned = signedNonce(form.get('ssecurity') ?? '', form.get('_nonce') ?? '');
        if (cookies.serviceToken !== 'service-token' || form.get('ssecurity') !== ssecurity) {
          return new Response(JSON.stringify({ code: 3, message: 'auth err' }), { status: 401 });
        }
        const data = JSON.parse(decryptValue(nonceSigned, form.get('data')));
        if (data.support_smart_home !== true) {
          return new Response(JSON.stringify({ code: -1 }), { status: 400 });
        }
        return new Response(
          encryptValue(nonceSigned, JSON.stringify({ code: 0, result: { list: devices } })),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    },
  };
  return server;
}

/** A raw device_list entry, anonymized (documentation addresses). */
export function cloudEntry(device, overrides = {}) {
  return {
    did: String(device.did),
    token: device.token,
    longitude: '0.0',
    latitude: '0.0',
    name: overrides.name ?? `Mi ${device.model}`,
    pid: '0',
    localip: device.host,
    mac: '02:00:00:00:00:01',
    ssid: 'Home Wi-Fi',
    bssid: '02:00:00:00:00:FE',
    parent_id: '',
    parent_model: '',
    show_mode: 1,
    model: device.model,
    adminFlag: 1,
    shareFlag: 0,
    permitLevel: 16,
    isOnline: true,
    desc: '',
    rssi: -48,
    ...overrides,
  };
}
