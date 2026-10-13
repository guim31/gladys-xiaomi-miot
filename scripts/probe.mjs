#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of the real services, from a machine with the network (the
// development sessions cannot reach account.xiaomi.com nor miot-spec.org):
//
//   XIAOMI_USERNAME=... XIAOMI_PASSWORD=... XIAOMI_REGION=de node scripts/probe.mjs
//
// Optional:
//   PROBE_LOCAL=1      also read each device on the LAN (get_properties only:
//                      nothing is ever written)
//   MIOT_MODELS=a,b    only fetch and translate these specifications (no
//                      account needed then)
//
// It logs in like the integration (two-step verification asked on the
// terminal when Xiaomi wants it), lists the devices, sorts them, fetches and
// translates their specifications. It prints models, counts and features,
// never a password, a token, a session cookie, a device id or an address
// (the last digits only).
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CloudError, XiaomiCloud } from '../src/cloud/client.js';
import { sortCloudDevices } from '../src/cloud/devices.js';
import { MiioTransport } from '../src/miio/transport.js';
import { readProperties, propertyKey } from '../src/miot/properties.js';
import { SpecRepository } from '../src/miot/spec.js';
import { translateSpec } from '../src/miot/translate.js';

const env = process.env;
const mask = (value) => `…${String(value).slice(-2)}`;

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function cloudDevices() {
  if (!env.XIAOMI_USERNAME || !env.XIAOMI_PASSWORD) {
    return [];
  }
  const cloud = new XiaomiCloud();
  const credentials = { username: env.XIAOMI_USERNAME, password: env.XIAOMI_PASSWORD };
  let session;
  try {
    session = await cloud.login(credentials);
  } catch (err) {
    if (!(err instanceof CloudError) || err.kind !== 'verification') {
      throw err;
    }
    console.log('Two-step verification asked by Xiaomi. Open this link, ask for the code,');
    console.log('do NOT type it on the page:');
    console.log(`  ${err.verifyUrl}`);
    const code = await ask('Code received: ');
    session = await cloud.login(credentials, { code });
  }
  console.log('Login: OK (service token received)');
  const entries = await cloud.listDevices(session, env.XIAOMI_REGION || 'de');
  const { devices, counts } = sortCloudDevices(entries);
  console.log(`Account: ${entries.length} entries →`, counts);
  const fields = new Set(entries.flatMap((entry) => Object.keys(entry ?? {})));
  console.log(`Fields of an entry: ${[...fields].sort().join(', ')}`);
  return devices;
}

async function main() {
  const specs = new SpecRepository({ directory: mkdtempSync(join(tmpdir(), 'miot-probe-')) });
  const devices = env.MIOT_MODELS
    ? env.MIOT_MODELS.split(',').map((model) => ({ model: model.trim() }))
    : await cloudDevices();
  const transport = new MiioTransport();
  for (const device of devices) {
    console.log(`\n== ${device.model}${device.host ? ` (address ${mask(device.host)})` : ''}`);
    let spec;
    try {
      spec = await specs.get(device.model);
    } catch (err) {
      console.log(`   specification: ${err.message}`);
      continue;
    }
    const translation = translateSpec(spec, { model: device.model, language: 'en' });
    console.log(`   ${translation.kind}: ${translation.features.length} feature(s)`);
    for (const feature of translation.features) {
      console.log(
        `   ${feature.key.padEnd(6)} ${feature.name} (${feature.category}/${feature.type})`,
      );
    }
    if (translation.ignored.length > 0) {
      console.log(
        `   left out: ${translation.ignored.map((s) => `${s.siid} ${s.service}`).join(', ')}`,
      );
    }
    if (env.PROBE_LOCAL === '1' && device.host && device.token) {
      try {
        const { readings, chunk } = await readProperties(
          transport,
          { host: device.host, token: device.token },
          device.did,
          translation.features.map(({ siid, piid }) => ({ siid, piid })),
        );
        console.log(`   local read: OK, ${chunk} properties per request`);
        for (const feature of translation.features) {
          const reading = readings.get(propertyKey(feature.siid, feature.piid));
          const value =
            reading?.code === 0 ? feature.decode(reading.value) : `code ${reading?.code}`;
          console.log(`   ${feature.key.padEnd(6)} = ${JSON.stringify(value)}`);
        }
      } catch (err) {
        console.log(
          `   local read: ${err.kind ?? 'error'} (${err.message.replace(device.host, mask(device.host))})`,
        );
      }
    }
  }
  transport.close();
}

main().catch((err) => {
  console.error(`Probe failed: ${err.message}`);
  process.exit(1);
});
