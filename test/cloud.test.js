// -----------------------------------------------------------------------------
// The Xiaomi account: the login of the Mi Home app (with and without the
// two-step verification), the RC4 device list, the sorting of what it lists,
// and the manual addition by address and token. Against the fake account of
// test/helpers/fakeServers.js: no network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { XiaomiCloud, apiBase, parseAccountJson } from '../src/cloud/client.js';
import { classifyCloudDevice, isVacuum, sortCloudDevices } from '../src/cloud/devices.js';
import { rc4, sha1Signature, signaturePath } from '../src/cloud/crypto.js';
import { cloudEntry, createXiaomiServer } from './helpers/fakeServers.js';
import { FakeMiio, PLUG, PURIFIER, createAll, createWorld, deviceId } from './helpers/world.js';

const ACCOUNT = { username: 'user@example.com', password: 'correct horse', language: 'en' };

test('RC4-drop1024 and the request signature, as the Mi Home app computes them', () => {
  // RC4 is symmetric: twice with the same key gives the input back.
  const key = Buffer.from('a key of sixteen');
  const once = rc4(key, 'hello');
  assert.notEqual(once.toString(), 'hello');
  assert.equal(rc4(key, once).toString(), 'hello');
  assert.equal(signaturePath('https://de.api.io.mi.com/app/home/device_list'), '/home/device_list');
  // A value checked against the Python reference of hass-xiaomi-miot.
  assert.equal(
    sha1Signature(
      'POST',
      'https://de.api.io.mi.com/app/home/device_list',
      [['data', '{}']],
      'bm9uY2U=',
    ),
    'ahBioqytk8WAITLDtuYwWl32yOg=',
  );
  assert.equal(apiBase('cn'), 'https://api.io.mi.com/app');
  assert.equal(apiBase('de'), 'https://de.api.io.mi.com/app');
  assert.deepEqual(parseAccountJson('&&&START&&&{"code":0}'), { code: 0 });
});

test('the account devices are sorted: Wi-Fi with address and token kept, the rest counted', () => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const entries = [
    cloudEntry(plug),
    cloudEntry(plug, { did: '200000001', model: 'roborock.vacuum.a15', token: plug.token }),
    cloudEntry(plug, { did: 'blt.3.1abcdefgh', model: 'miaomiaoce.sensor_ht.t2', localip: '' }),
    cloudEntry(plug, { did: 'lumi.158d0001000001', model: 'lumi.sensor_magnet.v2', localip: '' }),
    cloudEntry(plug, { did: '200000002', parent_id: '200000009' }),
    cloudEntry(plug, { did: '200000003', token: '' }),
  ];
  const { devices, counts } = sortCloudDevices(entries);
  assert.equal(devices.length, 1);
  assert.deepEqual(devices[0], {
    did: String(plug.did),
    model: PLUG,
    host: '192.0.2.11',
    token: plug.token,
    name: `Mi ${PLUG}`,
  });
  assert.deepEqual(counts, { ok: 1, vacuum: 1, 'no-address': 3, 'no-token': 1 });
  for (const model of [
    'roborock.vacuum.a15',
    'dreame.vacuum.p2009',
    'viomi.vacuum.v8',
    'rockrobo.vacuum.v1',
    'xiaomi.vacuum.c102gl',
  ]) {
    assert.ok(isVacuum(model), model);
  }
  assert.equal(isVacuum(PURIFIER), false);
  assert.equal(classifyCloudDevice(null).status, 'no-address');
});

test('login without verification, then the RC4 device list', async () => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const server = createXiaomiServer({ devices: [cloudEntry(plug)] });
  const cloud = new XiaomiCloud({ fetch: server.fetch });
  const session = await cloud.login(ACCOUNT);
  assert.deepEqual(session, {
    userId: '1234567',
    ssecurity: Buffer.from('ssecurity-of-tst').toString('base64'),
    serviceToken: 'service-token',
  });
  const list = await cloud.listDevices(session, 'de');
  assert.equal(list.length, 1);
  assert.equal(list[0].token, plug.token);
  assert.ok(
    server.bodies.every((body) => !body.includes(encodeURIComponent(ACCOUNT.password))),
    'the password itself is never sent, only its MD5',
  );
});

test('the import action: devices saved with their token (file 0600), published, message', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createWorld({ devices: [purifier, plug], known: false, config: ACCOUNT });
  t.after(() => world.app.stop());
  // Saving the account in the configuration imported at once.
  await world.hub.idle();
  assert.equal(world.fake.discoveredDevices.length, 2);
  const ack = await world.fake.action('import_from_cloud', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /^2 device\(s\) imported: Mi zhimi\.airp\.mb5, Mi chuangmi\.plug\.212a01\./,
  );
  assert.match(ack.data.message.en, /Discovery tab/);
  assert.match(ack.data.message.fr, /^2 appareil\(s\) importé\(s\)/);
  const file = join(world.dataDir, 'xiaomi-miot.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.devices[String(plug.did)].token, plug.token);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  // The Mi Home name is the default device name.
  assert.equal(world.fake.discoveredDevices[0].name, `Mi ${PURIFIER}`);
});

test('two-step verification: the link first, then the code, then the devices', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createWorld({
    devices: [plug],
    known: false,
    config: { language: 'en' },
    account: { twoStep: true, code: '654321' },
  });
  t.after(() => world.app.stop());
  await world.fake.configUpdated(ACCOUNT);
  await world.hub.idle();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /two-step verification/);

  const first = await world.fake.action('import_from_cloud', {});
  assert.match(first.data.message.en, /two-step verification/);
  assert.match(
    first.data.message.en,
    /https:\/\/account\.xiaomi\.com\/fe\/service\/identity\/authStart\?sid=xiaomiio&context=ctx-1/,
  );
  assert.match(first.data.message.de, /gib ihn aber NICHT auf dieser Seite ein/);

  const wrong = await world.fake.action('import_from_cloud', { verification_code: '000000' });
  assert.match(wrong.data.message.en, /refused this code/);

  // A wrong code ends the pending login: ask again, then the right code.
  await world.fake.action('import_from_cloud', {});
  const done = await world.fake.action('import_from_cloud', { verification_code: ' 654321 ' });
  assert.match(done.data.message.en, /^1 device\(s\) imported/);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('wrong password, captcha, unreachable account, missing details: a sentence, no secret', async (t) => {
  const world = await createWorld({ devices: [], known: false, config: { language: 'en' } });
  t.after(() => world.app.stop());
  const missing = await world.fake.action('import_from_cloud', {});
  assert.match(missing.data.message.en, /Fill in the e-mail/);

  await world.fake.configUpdated({ ...ACCOUNT, password: 'wrong' });
  await world.hub.idle();
  const wrong = await world.fake.action('import_from_cloud', {});
  assert.match(wrong.data.message.en, /refused the e-mail or the password/);
  assert.ok(!JSON.stringify(wrong).includes('wrong'.repeat(1) + '"'), 'the password is not echoed');

  await world.fake.configUpdated(ACCOUNT);
  await world.hub.idle();
  world.xiaomi.captcha = true;
  const captcha = await world.fake.action('import_from_cloud', {});
  assert.match(captcha.data.message.en, /captcha/);

  world.xiaomi.down = true;
  const down = await world.fake.action('import_from_cloud', {});
  assert.match(
    down.data.message.en,
    /cannot be reached \(Cannot reach account\.xiaomi\.com \(ECONNREFUSED\)\)/,
  );
});

test('add a device by address and token: the device itself gives its model', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createWorld({ devices: [plug], known: false });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);

  const bad = await world.fake.action('add_device', { ip: '192.0.2.300', token: plug.token });
  assert.match(bad.data.message.en, /IPv4 address/);
  const short = await world.fake.action('add_device', { ip: '192.0.2.11', token: 'abc' });
  assert.match(short.data.message.en, /32 hexadecimal/);
  const nobody = await world.fake.action('add_device', { ip: '192.0.2.99', token: plug.token });
  assert.match(nobody.data.message.en, /No Xiaomi device answers at 192\.0\.2\.99/);
  const wrong = await world.fake.action('add_device', {
    ip: '192.0.2.11',
    token: '0123456789abcdef0123456789abcdef',
  });
  assert.match(wrong.data.message.en, /does not accept this token/);

  const ok = await world.fake.action('add_device', {
    ip: '192.0.2.11',
    token: plug.token.toUpperCase(),
  });
  assert.match(ok.data.message.en, /chuangmi\.plug\.212a01 added \(192\.0\.2\.11\)/);
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.fake.discoveredDevices[0].external_id, deviceId(world.gladys, plug.did));
});

test('forget a device: gone from /data and from the Discovery tab', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createWorld({ devices: [plug] });
  t.after(() => world.app.stop());
  await createAll(world);
  const ack = await world.fake.action('forget_device', {
    device: deviceId(world.gladys, plug.did),
  });
  assert.match(ack.data.message.en, /is forgotten, with its token/);
  assert.equal(world.fake.discoveredDevices.length, 0);
  await world.hub.store.flush();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'xiaomi-miot.json'), 'utf8'));
  assert.deepEqual(saved.devices, {});
});
