// -----------------------------------------------------------------------------
// The miIO packet format, the local protocol of the Xiaomi Wi-Fi devices (UDP
// port 54321). Written from the public descriptions of the protocol (the
// OpenMiHome notes, python-miio read for understanding, nothing copied) with
// node:crypto only.
//
//   0      2      4          8          12        16                32
//   | 2131 | len  | unknown  | deviceId | stamp   | checksum (16 B)  | data...
//
// - `len` is the whole packet length, header included.
// - The data is AES-128-CBC with PKCS#7 padding: key = MD5(token),
//   IV = MD5(key + token). It holds a JSON-RPC request or reply, often
//   followed by a NUL byte.
// - The checksum is MD5(header up to the stamp + token + data).
// - "Hello" is a bare header of 0xFF bytes: every device answers it with its
//   device id and its stamp (seconds since its boot), which the next request
//   must carry. A device not yet paired to an account puts its token in the
//   checksum field of that answer; a paired one sends 0xFF or 0x00 bytes.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const MIIO_PORT = 54321;
const MAGIC = 0x2131;
const HEADER_LENGTH = 32;

/** The 32-byte discovery / handshake packet. */
export const HELLO = Buffer.from(`21310020${'ff'.repeat(28)}`, 'hex');

const md5 = (...parts) => {
  const hash = createHash('md5');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
};

/**
 * A device token as typed or listed by the cloud: 32 hexadecimal characters.
 * @param {unknown} value
 * @returns {string|null} the lower-case hex token, or null when malformed
 */
export function normalizeToken(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return null;
  }
  // All zeros or all F: the placeholder of a device that hides its token.
  if (/^(0{32}|f{32})$/.test(token)) {
    return null;
  }
  return token;
}

function keys(token) {
  const raw = Buffer.from(token, 'hex');
  const key = md5(raw);
  const iv = md5(key, raw);
  return { raw, key, iv };
}

export function encrypt(token, plaintext) {
  const { key, iv } = keys(token);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** @throws when the token is wrong (bad padding) or the data truncated */
export function decrypt(token, ciphertext) {
  const { key, iv } = keys(token);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Read the header of any miIO packet.
 * @param {Buffer} packet
 * @returns {{ length: number, unknown: number, deviceId: number, stamp: number, checksum: Buffer }|null}
 */
export function readHeader(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < HEADER_LENGTH) {
    return null;
  }
  if (packet.readUInt16BE(0) !== MAGIC) {
    return null;
  }
  return {
    length: packet.readUInt16BE(2),
    unknown: packet.readUInt32BE(4),
    deviceId: packet.readUInt32BE(8),
    stamp: packet.readUInt32BE(12),
    checksum: packet.subarray(16, 32),
  };
}

/**
 * The answer to a hello: the device id, its stamp, and the token of a device
 * not yet paired (null otherwise).
 * @param {Buffer} packet
 */
export function parseHelloReply(packet) {
  const header = readHeader(packet);
  if (!header || header.length !== HEADER_LENGTH || packet.length < HEADER_LENGTH) {
    return null;
  }
  if (header.deviceId === 0xffffffff) {
    // Our own hello, echoed back by the network.
    return null;
  }
  return {
    deviceId: header.deviceId,
    stamp: header.stamp,
    token: normalizeToken(header.checksum.toString('hex')),
  };
}

/**
 * Build an encrypted request packet.
 * @param {object} options
 * @param {string} options.token hex token
 * @param {number} options.deviceId from the hello answer
 * @param {number} options.stamp the device stamp to send
 * @param {Buffer|string} options.payload the JSON request
 */
export function encodePacket({ token, deviceId, stamp, payload }) {
  const data = encrypt(token, Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(MAGIC, 0);
  header.writeUInt16BE(HEADER_LENGTH + data.length, 2);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(deviceId >>> 0, 8);
  header.writeUInt32BE(stamp >>> 0, 12);
  md5(header.subarray(0, 16), keys(token).raw, data).copy(header, 16);
  return Buffer.concat([header, data]);
}

/**
 * Decrypt a reply packet.
 * @param {string} token hex token
 * @param {Buffer} packet
 * @returns {{ deviceId: number, stamp: number, payload: Buffer, checksumValid: boolean }}
 * @throws when the packet is not a miIO packet or does not decrypt
 */
export function decodePacket(token, packet) {
  const header = readHeader(packet);
  if (!header) {
    throw new Error('not a miIO packet');
  }
  const data = packet.subarray(HEADER_LENGTH, Math.max(HEADER_LENGTH, header.length));
  if (data.length === 0) {
    return {
      deviceId: header.deviceId,
      stamp: header.stamp,
      payload: Buffer.alloc(0),
      checksumValid: true,
    };
  }
  const expected = md5(packet.subarray(0, 16), keys(token).raw, data);
  return {
    deviceId: header.deviceId,
    stamp: header.stamp,
    payload: decrypt(token, data),
    checksumValid: expected.equals(header.checksum),
  };
}

/**
 * The JSON of a decrypted payload. Devices end it with NUL bytes, and a few
 * firmwares answer an empty payload.
 * @param {Buffer} payload
 * @returns {object|null}
 */
export function parsePayload(payload) {
  const text = payload.toString('utf8').replace(/\0+$/, '').trim();
  if (text === '') {
    return null;
  }
  return JSON.parse(text);
}
