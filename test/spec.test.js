// -----------------------------------------------------------------------------
// MIoT specifications: fetched once from (the fake) miot-spec.org and kept in
// /data; and their translation to Gladys features, value by value.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecRepository, reduceInstances } from '../src/miot/spec.js';
import { parseUrn, translateSpec } from '../src/miot/translate.js';
import { valueLabel } from '../src/miot/names.js';
import { quirksOf } from '../src/miot/quirks.js';
import { FIXTURES } from './helpers/fakeMiio.js';
import { createSpecServer } from './helpers/fakeServers.js';

const translate = (model, language = 'en') =>
  translateSpec(FIXTURES[model].spec, { model, language });
const byKey = (translation, key) => translation.features.find((feature) => feature.key === key);

test('a specification is downloaded once, then read from /data, even offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gladys-miot-specs-'));
  const server = createSpecServer();
  const first = new SpecRepository({ directory, fetch: server.fetch });
  const spec = await first.get('zhimi.airp.mb5');
  assert.equal(
    spec.type,
    FIXTURES['zhimi.airp.mb5'].spec.type,
    'the released URN, not the debug one',
  );
  await first.get('zhimi.airp.mb5');
  assert.equal(server.calls.length, 2, 'the model list, then the specification');

  server.down = true;
  const second = new SpecRepository({ directory, fetch: server.fetch });
  assert.deepEqual(await second.get('zhimi.airp.mb5'), spec);
  // Another model needs the network: the saved list knows it, the spec fails.
  await assert.rejects(second.get('cuco.plug.cp2'), (err) => err.kind === 'network');
  server.down = false;
  await assert.rejects(second.get('acme.unknown.v1'), (err) => err.kind === 'unknown-model');
});

test('the model list keeps one URN per model: released first, then the highest version', () => {
  assert.deepEqual(
    reduceInstances([
      { model: 'a.b.c', version: 2, status: 'debug', type: 'urn:x:device:a:1:a-c:2' },
      { model: 'a.b.c', version: 1, status: 'released', type: 'urn:x:device:a:1:a-c:1' },
      { model: 'a.b.c', version: 3, status: 'released', type: 'urn:x:device:a:1:a-c:3' },
      { model: 'd.e.f', type: 'urn:x:device:d:1:d-f:1' },
      { nothing: true },
    ]),
    { 'a.b.c': 'urn:x:device:a:1:a-c:3', 'd.e.f': 'urn:x:device:d:1:d-f:1' },
  );
  assert.deepEqual(parseUrn('urn:miot-spec-v2:service:air-purifier:00007811:zhimi-mb5:1'), {
    namespace: 'miot-spec-v2',
    name: 'air-purifier',
  });
});

test('purifier: power, mode list, fan level list, PM2.5, filter; vendor services left out', () => {
  const purifier = translate('zhimi.airp.mb5', 'fr');
  assert.equal(purifier.kind, 'air-purifier');
  const mode = byKey(purifier, '2-4');
  assert.deepEqual(
    mode.supported_options.map((option) => option.label),
    ['Auto', 'Nuit', 'Favori', 'Manuel'],
  );
  assert.deepEqual(mode.decode(2), { text: '2' });
  assert.equal(mode.encode('2'), 2);
  assert.throws(() => mode.encode('7'));
  assert.deepEqual(byKey(purifier, '2-2').decode(0), { text: 'Aucun défaut' });
  assert.deepEqual(byKey(purifier, '2-2').decode(4), { text: 'No Filter' });
  assert.equal(byKey(purifier, '3-7').decode(21.46), 21.5, 'rounded to the specification step');
  assert.equal(byKey(purifier, '4-1').category, 'hepa-filter-monitoring');
  assert.deepEqual(
    purifier.ignored.map((entry) => entry.service),
    ['alarm', 'custom-service', 'filter-time', 'aqi', 'rfid', 'screen', 'device-display-unit'],
  );
  const power = byKey(purifier, '2-1');
  assert.equal(power.encode(1), true, 'a bool property gets a boolean');
  assert.equal(power.decode(true), 1);
  assert.equal(power.decode('nonsense'), null);
});

test('humidifier: target humidity as a 5 % list, water level scaled (Smartmi counts to 120)', () => {
  const smartmi = translate('zhimi.humidifier.ca4');
  assert.equal(quirksOf('zhimi.humidifier.ca4').waterLevelMax, 120);
  const level = byKey(smartmi, '2-7');
  assert.equal(level.decode(120), 100);
  assert.equal(level.decode(60), 50);
  assert.equal(level.decode(127), null, '127: the tank is out');
  const target = byKey(smartmi, '2-6');
  assert.deepEqual(
    target.supported_options.map((option) => option.value),
    ['30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'],
  );
  assert.equal(target.encode('45'), 45);

  const deerma = translate('deerma.humidifier.jsq4');
  assert.equal(byKey(deerma, '7-1').role, 'waterShortage', 'a vendor property, known');
  assert.equal(byKey(deerma, '7-1').decode(true), 1);
});

test('fan, light, plug, dual switch, air monitor', () => {
  const fan = translate('dmaker.fan.p5');
  const speed = byKey(fan, '2-4');
  assert.deepEqual([speed.category, speed.type, speed.min, speed.max], ['fan', 'speed', 1, 4]);
  assert.equal(speed.encode(9), 4, 'clamped to the range');
  assert.equal(byKey(fan, '2-2').type, 'rock-setting');

  const light = translate('yeelink.light.color4');
  assert.deepEqual(
    light.features.map((feature) => `${feature.category}/${feature.type}`),
    ['light/binary', 'light/brightness', 'light/temperature', 'light/color'],
  );
  assert.equal(byKey(light, '2-3').min, 1700);

  const plug = translate('chuangmi.plug.212a01');
  assert.deepEqual(
    plug.features.map((feature) => `${feature.key} ${feature.type}`),
    ['2-1 binary', '5-6 power'],
  );

  const dual = translate('yeelink.switch.sw1', 'fr');
  assert.deepEqual(
    dual.features.map((feature) => feature.name),
    ['Marche 1', 'Marche 2'],
  );

  const monitor = translate('cgllc.airm.cgs2', 'de');
  assert.deepEqual(
    monitor.features.map((feature) => feature.name),
    ['Luftfeuchtigkeit', 'PM2,5', 'PM10', 'Temperatur', 'CO2', 'Batterie'],
  );
  assert.equal(byKey(monitor, '3-8').decode(612.4), 612);
});

test('a heater is read only; a spec without services gives nothing', () => {
  const heater = translate('zhimi.heater.mc2');
  for (const key of ['2-1', '2-5']) {
    assert.equal(byKey(heater, key).read_only, true, key);
  }
  assert.deepEqual(
    translateSpec({ type: 'urn:miot-spec-v2:device:x:0:y:1' }, { language: 'en' }).features,
    [],
  );
});

test('value labels: the common ones translated, "LevelN" numbered, others as written', () => {
  assert.equal(valueLabel('Level2', 'fr'), 'Niveau 2');
  assert.equal(valueLabel('level 3', 'de'), 'Stufe 3');
  assert.equal(valueLabel('Sleep', 'es'), 'Noche');
  assert.equal(valueLabel('Clothes Drying', 'fr'), 'Clothes Drying');
  assert.equal(valueLabel('', 'fr'), null);
});
