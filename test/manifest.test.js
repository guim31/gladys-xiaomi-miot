// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REGIONS } from '../src/cloud/client.js';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { REASONS, TRIGGER, WIDGET_KEY } from '../src/hub.js';
import { MIIO_PORT } from '../src/miio/protocol.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, climate, hello discovery', () => {
  assert.equal(manifest.name, 'Xiaomi MIoT');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-xiaomi-miot:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-xiaomi-miot/main/cover.png',
  );
  // The devices are only driven on the LAN; the account is a one-time setup
  // step, not a channel to the devices (no "prefer local" toggle to offer).
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['climate', 'appliances']);
  // The port the code broadcasts on must be declared, or the core answers 403.
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [MIIO_PORT] },
  ]);
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld({ devices: [], known: false });
  t.after(() => world.app.stop());
  assert.deepEqual(keysOf(manifest.actions), [
    'import_from_cloud',
    'add_device',
    'forget_device',
    'diagnose',
  ]);
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
});

test('no secret field in an action: Gladys cannot fill one (#3154)', () => {
  for (const action of manifest.actions) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      // An action applies no default (#3155): a required field has none.
      if (field.required) {
        assert.equal(field.default, undefined, `${action.key}.${field.key}`);
      }
    }
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
  // No widget button opens a form: 5.2.0 is not needed (#3168).
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  assert.deepEqual(declared, Object.keys(SCENE_ACTIONS));
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function');
  }
  const [action] = manifest.scene_actions;
  assert.deepEqual(keysOf(action.fields), ['device', 'property', 'value']);
  assert.deepEqual(keysOf(action.outputs), ['value']);
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal(typeof WIDGETS[WIDGET_KEY].get, 'function');
  assert.equal(typeof WIDGETS[WIDGET_KEY].action, 'function');
});

test('the scene trigger is the one the hub fires, with its filters and variables', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [TRIGGER]);
  const [trigger] = manifest.scene_triggers;
  // The event data the hub sends (src/hub.js checkAlerts).
  const data = ['device', 'device_name', 'reason', 'detail'];
  for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
    assert.ok(data.includes(key), `"${key}" is in the event data`);
  }
  const reason = trigger.fields.find((field) => field.key === 'reason');
  assert.deepEqual(
    reason.options.map((option) => option.value),
    Object.values(REASONS),
  );
});

test('the select options of the configuration are the values the code accepts', () => {
  const options = (key) =>
    manifest.config_schema.find((entry) => entry.key === key).options.map((o) => o.value);
  assert.deepEqual(options('poll_interval').map(Number), POLL_INTERVALS);
  assert.deepEqual([...options('region')].sort(), [...REGIONS].sort());
  assert.deepEqual(options('language'), LANGUAGES);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration opens with a section block');
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length >= 4);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en);
  }
});
