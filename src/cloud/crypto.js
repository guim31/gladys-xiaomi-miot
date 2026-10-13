// -----------------------------------------------------------------------------
// The signatures and the RC4 layer of the Xiaomi cloud API (`*.api.io.mi.com`),
// as the Mi Home app uses them. Written after the Apache-2.0 client of
// hass-xiaomi-miot (al-one), with node:crypto.
//
// - nonce = 8 random bytes + the minutes since the epoch (4 bytes, big endian),
//   base64;
// - signed nonce = base64(SHA-256(ssecurity + nonce)), both base64-decoded;
// - a request signature = base64(SHA-1("POST&/path&k=v&...&<signed nonce>")),
//   the `/app` prefix of the path left out;
// - every parameter value is RC4-encrypted with the signed nonce as key, the
//   first 1024 bytes of the key stream dropped; the answer is too.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

/** RC4 with the first 1024 bytes of the key stream dropped ("RC4-drop1024"). */
export function rc4(keyBuffer, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + keyBuffer[i % keyBuffer.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  const step = () => {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 255];
  };
  for (let n = 0; n < 1024; n += 1) {
    step();
  }
  const input = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const output = Buffer.alloc(input.length);
  for (let n = 0; n < input.length; n += 1) {
    output[n] = input[n] ^ step();
  }
  return output;
}

/** @param {number} [nowMs] */
export function generateNonce(nowMs = Date.now()) {
  const minutes = Buffer.alloc(4);
  minutes.writeUInt32BE(Math.floor(nowMs / 60_000) >>> 0);
  return Buffer.concat([randomBytes(8), minutes]).toString('base64');
}

export function signedNonce(ssecurity, nonce) {
  return createHash('sha256')
    .update(Buffer.from(ssecurity, 'base64'))
    .update(Buffer.from(nonce, 'base64'))
    .digest('base64');
}

/** The path the signatures use: the URL path without its `/app` prefix. */
export function signaturePath(url) {
  const path = new URL(url).pathname;
  return path.startsWith('/app/') ? path.slice(4) : path;
}

/**
 * @param {string} method 'POST' or 'GET'
 * @param {string} url
 * @param {Array<[string, string]>} entries the parameters, in order
 * @param {string} nonceSigned
 */
export function sha1Signature(method, url, entries, nonceSigned) {
  const parts = [method.toUpperCase(), signaturePath(url)];
  for (const [key, value] of entries) {
    parts.push(`${key}=${value}`);
  }
  parts.push(nonceSigned);
  return createHash('sha1').update(parts.join('&'), 'utf8').digest('base64');
}

export const encryptValue = (nonceSigned, value) =>
  rc4(Buffer.from(nonceSigned, 'base64'), value).toString('base64');

export const decryptValue = (nonceSigned, base64) =>
  rc4(Buffer.from(nonceSigned, 'base64'), Buffer.from(base64, 'base64')).toString('utf8');

/**
 * The form of an RC4 API request.
 * @param {object} options
 * @param {string} options.url
 * @param {object} options.data the request body (JSON-encoded in `data`)
 * @param {string} options.ssecurity
 * @param {string} [options.nonce] test seam
 * @returns {{ form: URLSearchParams, nonceSigned: string }}
 */
export function rc4Form({ url, data, ssecurity, nonce = generateNonce() }) {
  const nonceSigned = signedNonce(ssecurity, nonce);
  const entries = [['data', JSON.stringify(data)]];
  entries.push(['rc4_hash__', sha1Signature('POST', url, entries, nonceSigned)]);
  const encrypted = entries.map(([key, value]) => [key, encryptValue(nonceSigned, value)]);
  const signature = sha1Signature('POST', url, encrypted, nonceSigned);
  const form = new URLSearchParams([
    ...encrypted,
    ['signature', signature],
    ['ssecurity', ssecurity],
    ['_nonce', nonce],
  ]);
  return { form, nonceSigned };
}
