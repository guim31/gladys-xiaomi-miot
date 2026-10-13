// -----------------------------------------------------------------------------
// The "Air quality" widget: a content the core renders exactly as sent
// (validateWidgetContent), tiles bound to features the device really has,
// and buttons that drive the device.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { TEXT } from '../src/widgets.js';
import {
  FakeMiio,
  HEATER,
  HUMIDIFIER,
  PLUG,
  PURIFIER,
  allDevices,
  createAll,
  createWorld,
  deviceId,
} from './helpers/world.js';

async function created(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const widget = (world, settings, language = 'en') =>
  world.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });

test('every device gives a valid content, bound to features it has, in four languages', async (t) => {
  const world = await created(t, { devices: allDevices() });
  for (const device of world.fake.discoveredDevices) {
    const featureIds = new Set(device.features.map((feature) => feature.external_id));
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await widget(world, { device: device.external_id }, language);
      assert.equal(ack.success, true, ack.error);
      const { content } = ack.data;
      assert.deepEqual(validateWidgetContent(content), [], `${device.name} (${language})`);
      for (const component of content.components) {
        if (component.device_feature) {
          assert.ok(
            featureIds.has(component.device_feature),
            `${device.name}: ${component.device_feature}`,
          );
        }
        if (component.type === 'button') {
          // The running mode is told by the icon, never by the style (#3153).
          assert.equal(component.style, 'secondary');
        }
      }
      const keys = content.components.filter((c) => c.action).map((c) => c.action.key);
      assert.equal(new Set(keys).size, keys.length, 'action keys are unique');
    }
  }
});

test('a purifier: PM2.5, temperature, humidity, filter gauge, state, power and modes', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10', { values: { 2.1: true, 2.4: 0 } });
  const world = await created(t, { devices: [purifier] });
  const device = deviceId(world.gladys, purifier.did);
  const { content: data } = (await widget(world, { device }, 'fr')).data;
  const types = data.components.map((component) => component.type);
  assert.deepEqual(types, [
    'value',
    'value',
    'value',
    'gauge',
    'status',
    'button',
    'button',
    'button',
  ]);
  const [pm25] = data.components;
  assert.equal(pm25.label, 'PM2,5');
  const status = data.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['État', 'En marche'],
      ['Mode', 'Auto'],
      ['Vitesse de ventilation', 'Niveau 1'],
    ],
  );
  const buttons = data.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => [button.label, button.icon]),
    [
      ['Éteindre', 'power'],
      ['Auto', 'check-circle'],
      ['Nuit', 'play'],
    ],
  );

  // Tap "Sleep", then the power button.
  const mode = await world.fake.widgetAction(
    WIDGET_KEY,
    'mode_2',
    { value: '1' },
    { settings: { device } },
  );
  assert.equal(mode.success, true, mode.error);
  assert.equal(purifier.values['2.4'], 1);
  assert.deepEqual(mode.data, {
    message: { en: 'Mode: Sleep', fr: 'Mode : Nuit', de: 'Modus: Schlafen', es: 'Modo: Noche' },
  });
  const off = await world.fake.widgetAction(WIDGET_KEY, 'power', {}, { settings: { device } });
  assert.equal(off.success, true);
  assert.equal(purifier.values['2.1'], false);
  assert.deepEqual(off.data, { message: TEXT.switchedOff });
});

test('a heater has no power button; a plug shows its state only', async (t) => {
  const heater = new FakeMiio(HEATER, '192.0.2.12');
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await created(t, { devices: [heater, plug] });
  const heaterContent = (await widget(world, { device: deviceId(world.gladys, heater.did) })).data
    .content;
  assert.ok(!heaterContent.components.some((component) => component.type === 'button'));
  const refused = await world.fake.widgetAction(
    WIDGET_KEY,
    'power',
    {},
    {
      settings: { device: deviceId(world.gladys, heater.did) },
    },
  );
  assert.equal(refused.success, false);
  const plugContent = (await widget(world, { device: deviceId(world.gladys, plug.did) })).data
    .content;
  assert.deepEqual(
    plugContent.components.map((component) => component.type),
    ['status', 'button'],
  );
});

test('a humidifier shows its water level; a device not chosen or unknown says so', async (t) => {
  const humidifier = new FakeMiio('zhimi.humidifier.ca4', '192.0.2.13', { values: { 2.7: 60 } });
  const other = new FakeMiio(HUMIDIFIER, '192.0.2.14');
  const world = await created(t, { devices: [humidifier, other] });
  const { content: data } = (
    await widget(world, { device: deviceId(world.gladys, humidifier.did) })
  ).data;
  assert.ok(data.components.some((component) => component.label === 'Water level'));

  const none = await widget(world, {});
  assert.equal(none.data.content.components[0].text, TEXT.pick.en);
  const unknown = await widget(world, { device: deviceId(world.gladys, 999) });
  assert.equal(unknown.data.content.components[0].text, TEXT.unknown.en);
});

test('a device that stops answering says it in the status', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await created(t, { devices: [plug], scan: false });
  plug.online = false;
  await world.hub.pollAll();
  await world.hub.pollAll();
  await world.hub.idle();
  const { content: data } = (await widget(world, { device: deviceId(world.gladys, plug.did) }))
    .data;
  const status = data.components.find((component) => component.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'State',
    icon: 'wifi-off',
    value: 'not answering',
    color: 'danger',
  });
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
});
