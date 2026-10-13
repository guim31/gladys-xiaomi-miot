// -----------------------------------------------------------------------------
// The hub end to end: known devices from /data, specifications from the fake
// miot-spec.org, readings from fake miIO devices, states and commands through
// the SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILTER_ALERT_PERCENT, TRIGGER } from '../src/hub.js';
import {
  FakeMiio,
  HEATER,
  HUMIDIFIER,
  PLUG,
  PURIFIER,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function created(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('known devices are published in the Discovery tab, with their translated features', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createWorld({ devices: [purifier, plug] });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.equal(devices.length, 2);
  const published = devices.find(
    (device) => device.external_id === deviceId(world.gladys, purifier.did),
  );
  assert.equal(published.name, 'Air purifier ' + String(purifier.did).slice(-4));
  assert.deepEqual(published.params, [
    { name: 'IP_ADDRESS', value: '192.0.2.10' },
    { name: 'MODEL', value: PURIFIER },
  ]);
  assert.equal(published.should_poll, true);
  assert.equal(published.poll_frequency, 30000);
  const keys = published.features.map((feature) => feature.external_id.split(':').pop());
  assert.deepEqual(keys, ['2-1', '2-2', '2-4', '2-5', '3-1', '3-4', '3-7', '4-1', '4-4', '8-1']);
  const raw = JSON.stringify(devices);
  assert.ok(!raw.includes(purifier.token) && !raw.includes(plug.token), 'no token leaves /data');
});

test('a created device is read at once and its states published; readings change, only changes go', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10', {
    values: { 2.1: true, 2.4: 2, 3.4: 12, 3.7: 21.5, 4.1: 80 },
  });
  const world = await created(t, { devices: [purifier] });
  const state = (key) => world.fake.lastState(featureId(world.gladys, purifier.did, key));
  assert.equal(state('2-1'), 1);
  assert.equal(state('2-4'), '2', 'the mode as its option value');
  assert.equal(state('3-4'), 12);
  assert.equal(state('3-7'), 21.5);
  assert.equal(state('4-1'), 80);
  assert.equal(state('2-2'), 'No fault');

  const before = world.fake.states.length;
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
  purifier.values['3.4'] = 35;
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, before + 1);
  assert.equal(state('3-4'), 35);
});

test('commands: power, mode (select), speed; the device gets the MIoT value', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const world = await created(t, { devices: [purifier] });
  const device = { external_id: deviceId(world.gladys, purifier.did) };
  const feature = (key) => ({ external_id: featureId(world.gladys, purifier.did, key) });

  assert.deepEqual(await world.fake.setValue(device, feature('2-1'), 1), { success: true });
  assert.equal(purifier.values['2.1'], true);
  assert.equal(world.fake.lastState(feature('2-1').external_id), 1);

  assert.deepEqual(await world.fake.setValue(device, feature('2-4'), '3'), { success: true });
  assert.equal(purifier.values['2.4'], 3);

  const refused = await world.fake.setValue(device, feature('2-4'), '9');
  assert.equal(refused.success, false, 'an option the device does not list');
  const readOnly = await world.fake.setValue(device, feature('3-4'), 5);
  assert.equal(readOnly.success, false);
});

test('a heater is shown, never driven: its power is read only, and so is the scene action', async (t) => {
  const heater = new FakeMiio(HEATER, '192.0.2.12', { values: { 2.1: true, 2.5: 21 } });
  const world = await created(t, { devices: [heater] });
  const [published] = world.fake.discoveredDevices;
  const power = published.features.find((f) => f.external_id.endsWith(':2-1'));
  assert.equal(power.read_only, true);
  const target = published.features.find((f) => f.external_id.endsWith(':2-5'));
  assert.equal(target.read_only, true);
  assert.equal(world.fake.lastState(power.external_id), 1);
  const ack = await world.fake.setValue(published, power, 0);
  assert.equal(ack.success, false);
  const action = await world.fake.sceneAction('set_property', {
    device: published.external_id,
    property: '2.1',
    value: 'false',
  });
  assert.equal(action.success, false);
  assert.equal(heater.values['2.1'], true);
});

test('the scene action writes any writable property, typed by the specification', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const world = await created(t, { devices: [purifier] });
  const device = deviceId(world.gladys, purifier.did);
  const ack = await world.fake.sceneAction('set_property', {
    device,
    property: '6.1',
    value: 'false',
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { value: 'false' } } });
  assert.equal(purifier.values['6.1'], false, 'the buzzer, not translated');
  const range = await world.fake.sceneAction('set_property', {
    device,
    property: '9.2',
    value: '1000',
  });
  assert.equal(range.success, true);
  assert.equal(purifier.values['9.2'], 1000);
  for (const [property, value] of [
    ['9.2', '9999'],
    ['3.4', '1'],
    ['2.1', 'maybe'],
    ['x', '1'],
  ]) {
    const refused = await world.fake.sceneAction('set_property', { device, property, value });
    assert.equal(refused.success, false, `${property} = ${value}`);
  }
});

test('maintenance trigger: once per start of a reason, kept across a restart', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10', { values: { 4.1: 50 } });
  const world = await created(t, { devices: [purifier] });
  assert.equal(world.fake.sceneEvents.length, 0);
  purifier.values['4.1'] = FILTER_ALERT_PERCENT;
  await world.hub.pollAll();
  purifier.values['4.1'] = FILTER_ALERT_PERCENT - 2;
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.length, 1);
  const [event] = world.fake.sceneEvents;
  assert.equal(event.key, TRIGGER);
  assert.deepEqual(
    { ...event.data, device_name: undefined },
    {
      device: deviceId(world.gladys, purifier.did),
      device_name: undefined,
      reason: 'filter',
      detail: `${FILTER_ALERT_PERCENT} %`,
    },
  );
  const saved = JSON.parse(await readFile(join(world.dataDir, 'xiaomi-miot.json'), 'utf8'));
  assert.deepEqual(saved.alerts, { [String(purifier.did)]: ['filter'] });

  // A fault, then fixed; the filter replaced.
  purifier.values['2.2'] = 4;
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.at(-1).data.reason, 'fault');
  assert.equal(world.fake.sceneEvents.at(-1).data.detail, 'No Filter');
  purifier.values['2.2'] = 0;
  purifier.values['4.1'] = 100;
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.length, 2);
  purifier.values['4.1'] = 5;
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.length, 3, 'a new filter running low fires again');

  // A restart with the alert in progress: no second event.
  await world.app.stop();
  const again = await createWorld({ devices: [purifier], known: false, dataDir: world.dataDir });
  t.after(() => again.app.stop());
  await createAll(again);
  await again.hub.pollAll();
  assert.equal(again.fake.sceneEvents.length, 0);
});

test('a humidifier with an empty tank fires the water reason', async (t) => {
  const humidifier = new FakeMiio(HUMIDIFIER, '192.0.2.13', { values: { 7.1: false } });
  const world = await created(t, { devices: [humidifier] });
  humidifier.values['7.1'] = true;
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.reason, 'water');
});

test('a device that stops answering is unreachable after two polls, and comes back', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11', { values: { 2.1: true } });
  const world = await created(t, { devices: [plug] });
  const id = deviceId(world.gladys, plug.did);
  const transport = () =>
    world.fake.transports.filter((entry) => entry.device_external_id === id).at(-1).transport;
  assert.equal(transport(), 'local');
  plug.online = false;
  await world.hub.pollAll();
  assert.notEqual(world.hub.records.get(String(plug.did)).reachable, false);
  await world.hub.pollAll();
  await world.hub.idle();
  assert.equal(world.hub.records.get(String(plug.did)).reachable, false);
  assert.equal(transport(), 'unreachable');
  plug.online = true;
  await world.hub.pollAll();
  assert.equal(transport(), 'local');
});

test('a device moved to another address (DHCP) is found again by the hello broadcast', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11', { values: { 2.1: true } });
  const world = await created(t, { devices: [plug] });
  plug.host = '192.0.2.50';
  world.fake.scanResults['udp-active-broadcast'] = world.network.scanReplies();
  await world.hub.rediscover();
  assert.equal(world.hub.records.get(String(plug.did)).host, '192.0.2.50');
  const [published] = world.fake.discoveredDevices;
  assert.equal(published.params[0].value, '192.0.2.50');
  plug.values['2.1'] = false;
  await world.hub.pollAll();
  assert.equal(world.fake.lastState(featureId(world.gladys, plug.did, '2-1')), 0);
  const [scan] = world.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, 54321);
});

test('the core poll is a fallback: skipped right after the timer, run when it is late', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await created(t, { devices: [plug] });
  const device = world.fake.discoveredDevices[0];
  const calls = plug.calls.length;
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(plug.calls.length, calls, 'read less than a period ago');
  world.hub.records.get(String(plug.did)).lastPolledAt = 0;
  await world.fake.poll(device);
  assert.ok(plug.calls.length > calls);
});

test('a model miot-spec.org does not know is left out, and the diagnosis says it', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const unknown = new FakeMiio(PLUG, '192.0.2.11');
  unknown.model = 'acme.plug.x1';
  const world = await createWorld({ devices: [purifier, unknown] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  const ack = await world.fake.action('diagnose', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /acme\.plug\.x1, 192\.0\.2\.11 · specification missing/);
  assert.match(
    ack.data.message.en,
    /zhimi\.airp\.mb5, 192\.0\.2\.10 · 10 feature\(s\) · left out: 6 alarm/,
  );
  assert.match(ack.data.message.fr, /spécification manquante/);
});
