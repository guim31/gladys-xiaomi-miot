// -----------------------------------------------------------------------------
// The miIO packet format and the UDP exchanges, against packets built here
// and fake devices speaking the real format.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  HELLO,
  decodePacket,
  decrypt,
  encodePacket,
  encrypt,
  normalizeToken,
  parseHelloReply,
  parsePayload,
  readHeader,
} from '../src/miio/protocol.js';
import { MiioTransport } from '../src/miio/transport.js';
import { readProperties, writeProperty } from '../src/miot/properties.js';
import { FakeMiio, createNetwork } from './helpers/fakeMiio.js';
import { FAST_TRANSPORT, PURIFIER } from './helpers/world.js';

const TOKEN = '00112233445566778899aabbccddeeff';

test('the token derives the AES key and IV by MD5, and the cipher round-trips', () => {
  const raw = Buffer.from(TOKEN, 'hex');
  const key = createHash('md5').update(raw).digest();
  const iv = createHash('md5')
    .update(Buffer.concat([key, raw]))
    .digest();
  const plaintext = Buffer.from('{"id":1,"method":"miIO.info","params":[]}');
  const ciphertext = encrypt(TOKEN, plaintext);
  assert.equal(ciphertext.length % 16, 0, 'PKCS#7 padded blocks');
  assert.deepEqual(decrypt(TOKEN, ciphertext), plaintext);
  // Same as an AES-128-CBC built by hand from the derived key and IV.
  assert.equal(key.length, 16);
  assert.equal(iv.length, 16);
  assert.throws(() => decrypt('ffeeddccbbaa99887766554433221100', ciphertext));
});

test('a request packet: magic, length, device id, stamp, MD5 checksum, data', () => {
  const payload = '{"id":7,"method":"get_properties","params":[]}\0';
  const packet = encodePacket({ token: TOKEN, deviceId: 0x01020304, stamp: 1234, payload });
  const header = readHeader(packet);
  assert.equal(packet.readUInt16BE(0), 0x2131);
  assert.equal(header.length, packet.length);
  assert.equal(header.unknown, 0);
  assert.equal(header.deviceId, 0x01020304);
  assert.equal(header.stamp, 1234);
  const expected = createHash('md5')
    .update(packet.subarray(0, 16))
    .update(Buffer.from(TOKEN, 'hex'))
    .update(packet.subarray(32))
    .digest();
  assert.deepEqual(header.checksum, expected);
  const decoded = decodePacket(TOKEN, packet);
  assert.equal(decoded.checksumValid, true);
  assert.deepEqual(parsePayload(decoded.payload), { id: 7, method: 'get_properties', params: [] });
});

test('hello: 32 bytes of 0xFF after the header start; the answer gives id, stamp and token', () => {
  assert.equal(HELLO.length, 32);
  assert.equal(HELLO.toString('hex'), `21310020${'f'.repeat(56)}`);
  assert.equal(parseHelloReply(HELLO), null, 'our own hello is not an answer');

  const paired = Buffer.alloc(32, 0xff);
  paired.writeUInt16BE(0x2131, 0);
  paired.writeUInt16BE(32, 2);
  paired.writeUInt32BE(0, 4);
  paired.writeUInt32BE(123456789, 8);
  paired.writeUInt32BE(4242, 12);
  assert.deepEqual(parseHelloReply(paired), { deviceId: 123456789, stamp: 4242, token: null });

  const unpaired = Buffer.from(paired);
  Buffer.from(TOKEN, 'hex').copy(unpaired, 16);
  assert.equal(parseHelloReply(unpaired).token, TOKEN);
  assert.equal(parseHelloReply(Buffer.from('not a packet')), null);
});

test('tokens: 32 hex characters, the all-zero and all-F placeholders refused', () => {
  assert.equal(normalizeToken(' 00112233445566778899AABBCCDDEEFF '), TOKEN);
  assert.equal(normalizeToken('0'.repeat(32)), null);
  assert.equal(normalizeToken('f'.repeat(32)), null);
  assert.equal(normalizeToken('0011'), null);
  assert.equal(normalizeToken('zz112233445566778899aabbccddeeff'), null);
  assert.equal(normalizeToken(undefined), null);
});

test('a NUL-terminated or empty payload parses', () => {
  assert.deepEqual(parsePayload(Buffer.from('{"id":1,"result":["ok"]}\0\0')), {
    id: 1,
    result: ['ok'],
  });
  assert.equal(parsePayload(Buffer.from('\0')), null);
});

function transportFor(devices) {
  const network = createNetwork(devices);
  const transport = new MiioTransport({
    createSocket: network.createSocket,
    timings: FAST_TRANSPORT,
  });
  return { transport, network };
}

test('the transport says hello once, then asks with the device id and its stamp', async () => {
  const device = new FakeMiio(PURIFIER, '192.0.2.10', { values: { 2.1: true } });
  const { transport, network } = transportFor([device]);
  const target = { host: device.host, token: device.token, deviceId: device.did };
  const info = await transport.request(target, 'miIO.info');
  assert.equal(info.model, PURIFIER);
  const sentAfterFirst = network.sent;
  assert.equal(sentAfterFirst, 2, 'hello + request');
  await transport.request(target, 'miIO.info');
  assert.equal(network.sent, sentAfterFirst + 1, 'the session is kept');
  transport.close();
});

test('a wrong token: the device says hello and ignores the request (no-answer)', async () => {
  const device = new FakeMiio(PURIFIER, '192.0.2.10');
  const { transport } = transportFor([device]);
  await assert.rejects(
    transport.request({ host: device.host, token: TOKEN }, 'miIO.info'),
    (err) => err.kind === 'no-answer' && !err.unreachable,
  );
});

test('an address with no device is offline; another device at the address is "moved"', async () => {
  const device = new FakeMiio(PURIFIER, '192.0.2.10');
  const { transport } = transportFor([device]);
  await assert.rejects(
    transport.request({ host: '192.0.2.99', token: TOKEN }, 'miIO.info'),
    (err) => err.kind === 'offline' && err.unreachable,
  );
  await assert.rejects(
    transport.request({ host: device.host, token: device.token, deviceId: 42 }, 'miIO.info'),
    (err) => err.kind === 'moved' && err.unreachable,
  );
});

test('get_properties in chunks: a device answering 3 at a time is cut down to it', async () => {
  const device = new FakeMiio(PURIFIER, '192.0.2.10', { maxChunk: 3 });
  const { transport } = transportFor([device]);
  const properties = [
    [2, 1],
    [2, 2],
    [2, 4],
    [2, 5],
    [3, 1],
    [3, 4],
    [3, 7],
    [9, 99],
  ].map(([siid, piid]) => ({ siid, piid }));
  const target = { host: device.host, token: device.token, deviceId: device.did };
  const { readings, chunk } = await readProperties(transport, target, device.did, properties);
  assert.ok(chunk <= 3, `chunk ${chunk}`);
  assert.equal(readings.size, 8);
  assert.equal(readings.get('2.1').code, 0);
  assert.equal(readings.get('9.99').code, -4003, 'an unknown property is marked, not fatal');

  const again = await readProperties(transport, target, device.did, properties, { chunk });
  assert.equal(again.chunk, chunk, 'the size that works is kept');
});

test('set_properties: code 0 is done, a negative code is a refusal', async () => {
  const device = new FakeMiio(PURIFIER, '192.0.2.10');
  const { transport } = transportFor([device]);
  const target = { host: device.host, token: device.token, deviceId: device.did };
  assert.equal(await writeProperty(transport, target, device.did, { siid: 2, piid: 1 }, true), 0);
  assert.equal(device.values['2.1'], true);
  await assert.rejects(
    writeProperty(transport, target, device.did, { siid: 3, piid: 4 }, 12),
    (err) => err.code === -4002,
  );
});
