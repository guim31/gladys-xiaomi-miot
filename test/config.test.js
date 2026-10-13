import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, pollFrequencyMs } from '../src/config.js';

test('normalizeConfig: the defaults, then the user values', () => {
  assert.deepEqual(normalizeConfig(), {
    username: '',
    password: '',
    hasCredentials: false,
    region: DEFAULT_CONFIG.region,
    pollSeconds: 30,
    language: 'fr',
  });
  const config = normalizeConfig({
    username: ' user@example.com ',
    password: ' spaced ',
    region: 'us',
    poll_interval: '60',
    language: 'de',
  });
  assert.equal(config.username, 'user@example.com');
  assert.equal(config.password, ' spaced ', 'a password is kept as typed');
  assert.equal(config.hasCredentials, true);
  assert.equal(config.region, 'us');
  assert.equal(config.pollSeconds, 60);
  assert.equal(config.language, 'de');
});

test('normalizeConfig: unknown values fall back to the defaults', () => {
  const config = normalizeConfig({ region: 'mars', poll_interval: '7', language: 'it' });
  assert.equal(config.region, 'de');
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig(null).hasCredentials, false);
});

test('the published poll frequency is a Gladys one, a minute at most', () => {
  assert.equal(pollFrequencyMs(15), 15000);
  assert.equal(pollFrequencyMs(30), 30000);
  assert.equal(pollFrequencyMs(60), 60000);
  assert.equal(pollFrequencyMs(120), 60000);
});
