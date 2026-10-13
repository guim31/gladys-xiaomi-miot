// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake miIO devices on a fake
// UDP network, fake miot-spec.org and Xiaomi account servers, and a temporary
// /data, with the integration wired on top through registerHandlers. No timer
// runs unless asked: the tests read the devices with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { XiaomiCloud } from '../../src/cloud/client.js';
import { SpecRepository } from '../../src/miot/spec.js';
import { Store } from '../../src/store.js';
import { FakeMiio, FIXTURES, createNetwork } from './fakeMiio.js';
import { cloudEntry, createSpecServer, createXiaomiServer } from './fakeServers.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast retries: a device that does not answer fails in 120 ms.
export const FAST_TRANSPORT = {
  timeoutMs: 120,
  commandTimeoutMs: 120,
  attemptMs: 40,
};

export const PURIFIER = 'zhimi.airp.mb5';
export const HUMIDIFIER = 'deerma.humidifier.jsq4';
export const PLUG = 'chuangmi.plug.212a01';
export const HEATER = 'zhimi.heater.mc2';

/** One fake device per fixture model, at 192.0.2.10, .11... */
export function allDevices() {
  return Object.keys(FIXTURES).map((model, index) => new FakeMiio(model, `192.0.2.${10 + index}`));
}

/**
 * Write a /data file as a previous run would have: the devices with their
 * token, as if imported.
 */
export function seedData(dataDir, devices) {
  mkdirSync(dataDir, { recursive: true });
  const saved = Object.fromEntries(
    devices.map((device) => [
      String(device.did),
      {
        did: String(device.did),
        model: device.model,
        host: device.host,
        token: device.token,
        name: null,
        source: 'cloud',
        chunk: null,
      },
    ]),
  );
  writeFileSync(join(dataDir, 'xiaomi-miot.json'), JSON.stringify({ version: 1, devices: saved }));
}

/**
 * @param {object} [options]
 * @param {FakeMiio[]} [options.devices] the fake devices of the network
 * @param {boolean} [options.known] the devices are already in /data
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.scan] whether the core's discovery finds them
 * @param {object} [options.account] createXiaomiServer options
 * @param {boolean} [options.timers]
 */
export async function createWorld({
  devices = [new FakeMiio(PURIFIER, '192.0.2.10')],
  known = true,
  config = { language: 'en' },
  scan = true,
  created = [],
  account = {},
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-miot-')),
  timings = {},
  timers = false,
  specServer = createSpecServer(),
} = {}) {
  if (known) {
    seedData(dataDir, devices);
  }
  const network = createNetwork(devices);
  const xiaomi = createXiaomiServer({
    devices: devices.map((device) => cloudEntry(device)),
    ...account,
  });
  const store = new Store(dataDir);
  const gladys = createFakeGladys({
    config,
    devices: created,
    scanResults: { 'udp-active-broadcast': scan ? network.scanReplies() : [] },
  });
  const app = registerHandlers(gladys, {
    store,
    createSocket: network.createSocket,
    specs: new SpecRepository({ directory: store.specDirectory, fetch: specServer.fetch }),
    cloud: new XiaomiCloud({ fetch: xiaomi.fetch }),
    timers,
    timings,
    transportTimings: FAST_TRANSPORT,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    app,
    hub: app.hub,
    dataDir,
    xiaomi,
    specServer,
    devices,
  };
}

export const deviceId = (gladys, did) => gladys.externalIds('miot', String(did)).device;
export const featureId = (gladys, did, key) => gladys.externalIds('miot', String(did)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

export { FakeMiio, FIXTURES };
