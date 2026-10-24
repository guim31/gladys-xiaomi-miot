// -----------------------------------------------------------------------------
// What the container writes: the life of the devices and of Gladys at the
// info level, never one line per reading, a repeated failure once, and never
// a secret (password, device tokens, Xiaomi session) at any level. Also: the
// hub reads the devices by its own timer, without onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FakeMiio, PLUG, PURIFIER, createAll, createWorld, featureId } from './helpers/world.js';

const PASSWORD = 'correct horse';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

test('logs: normal readings, with changes, write nothing at the info level', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const world = await createdWorld(t, { devices: [purifier] });
  const lines = await capture(t, async () => {
    for (const pm25 of [10, 20, 30, 30]) {
      purifier.values['3.4'] = pm25;
      await world.hub.pollAll();
    }
    await world.hub.rediscover();
    await world.hub.idle();
  });
  assert.equal(world.fake.lastState(featureId(world.gladys, purifier.did, '3-4')), 30);
  assert.deepEqual(lines, []);
});

test('logs: Gladys refusing the states is said once, and its return once', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const world = await createdWorld(t, { devices: [purifier] });
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const pm25 of [11, 12, 13, 14]) {
      purifier.values['3.4'] = pm25;
      await world.hub.pollAll();
    }
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(
    failing[0],
    /\[WARN\].*Gladys does not take the Xiaomi updates: Gladys is restarting/,
  );

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.pollAll();
    await world.hub.pollAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Xiaomi updates again/);
});

test('logs: a device switched off at the wall is one line, its return one line', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createdWorld(t, { devices: [plug], scan: false });
  plug.online = false;
  const lost = await capture(t, async () => {
    for (let poll = 0; poll < 5; poll += 1) {
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  assert.equal(lost.length, 1, lost.join('\n'));
  assert.match(lost[0], /\[INFO\].*no longer answers at 192\.0\.2\.11/);
  plug.online = true;
  const back = await capture(t, async () => {
    await world.hub.pollAll();
    await world.hub.pollAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*answers again at 192\.0\.2\.11/);
});

test('logs: a token that changed (device paired again) is said once', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createdWorld(t, { devices: [plug] });
  plug.token = 'ffeeddccbbaa99887766554433221100';
  const lines = await capture(t, async () => {
    for (let poll = 0; poll < 3; poll += 1) {
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  assert.equal(lines.filter((line) => /refuses its token/.test(line)).length, 1, lines.join('\n'));
  assert.ok(lines.every((line) => !line.includes(plug.token)));
});

test('logs: a device deaf to MIoT but answering miIO.info is not said to refuse its token', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createdWorld(t, { devices: [plug] });
  plug.legacy = true;
  const lines = await capture(t, async () => {
    for (let poll = 0; poll < 3; poll += 1) {
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  const said = lines.filter((line) => /only speaks the older miIO protocol/.test(line));
  assert.equal(said.length, 1, lines.join('\n'));
  assert.ok(
    lines.every((line) => !/refuses its token/.test(line)),
    lines.join('\n'),
  );
  const ack = await world.fake.action('diagnose', {});
  assert.match(ack.data.message.en, /older miIO protocol only, not supported yet/);
  assert.match(ack.data.message.fr, /ancien protocole miIO seul/);
});

test('logs: a user command is one info line; a core without the scan is said once', async (t) => {
  const plug = new FakeMiio(PLUG, '192.0.2.11');
  const world = await createdWorld(t, { devices: [plug] });
  const [device] = world.fake.discoveredDevices;
  const power = device.features.find((feature) => feature.external_id.endsWith(':2-1'));
  const command = await capture(t, () => world.fake.setValue(device, power, 1));
  assert.equal(command.length, 1, command.join('\n'));
  assert.match(command[0], /\[INFO\].*Power → 1/);

  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network_discovery not declared');
  });
  const refused = await capture(t, async () => {
    for (let round = 0; round < 3; round += 1) {
      await world.hub.rediscover();
    }
  });
  assert.equal(refused.length, 1, refused.join('\n'));
  assert.match(refused[0], /\[WARN\].*Xiaomi discovery through Gladys failed/);
});

test('logs: no secret of the configuration or of the devices, even at the debug level', async (t) => {
  const purifier = new FakeMiio(PURIFIER, '192.0.2.10');
  const lines = await capture(
    t,
    async () => {
      const world = await createWorld({
        devices: [purifier],
        known: false,
        config: { username: 'user@example.com', password: PASSWORD, language: 'en' },
        account: { twoStep: true, code: '654321' },
      });
      t.after(() => world.app.stop());
      await world.hub.idle();
      await world.fake.action('import_from_cloud', {});
      await world.fake.action('import_from_cloud', { verification_code: '654321' });
      await createAll(world);
      await world.fake.action('add_device', { ip: purifier.host, token: purifier.token });
      await world.fake.action('add_device', {
        ip: purifier.host,
        token: '0123456789abcdef0123456789abcdef',
      });
      await world.hub.pollAll();
      await world.fake.action('diagnose', {});
      await world.hub.idle();
    },
    'debug',
  );
  assert.ok(lines.length > 0, 'the debug level writes something');
  const text = lines.join('\n');
  for (const secret of [
    PASSWORD,
    purifier.token,
    '0123456789abcdef0123456789abcdef',
    'service-token',
    'pass-token',
    Buffer.from('ssecurity-of-tst').toString('base64'),
    '654321',
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" appears in the logs`);
  }
});

test('polling: the hub reads by its own timer, without any onPoll from the core', async (t) => {
  // Only the intervals are simulated: the UDP exchanges keep their real timers.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const plug = new FakeMiio(PLUG, '192.0.2.11', { values: { 2.1: false } });
  const world = await createdWorld(t, { devices: [plug], timers: true });
  const polls = t.mock.method(world.hub, 'poll');
  const onPoll = t.mock.method(world.hub, 'pollFromCore');

  plug.values['2.1'] = true;
  t.mock.timers.tick(29_000);
  await world.hub.idle();
  assert.equal(polls.mock.callCount(), 0, 'not before the interval');
  t.mock.timers.tick(1_000);
  await world.hub.idle();
  assert.equal(polls.mock.callCount(), 1);
  assert.equal(onPoll.mock.callCount(), 0, 'the core never asked');
  assert.equal(world.fake.lastState(featureId(world.gladys, plug.did, '2-1')), 1);
});
