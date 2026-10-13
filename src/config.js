// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { REGIONS } from './cloud/client.js';
import { LANGUAGES } from './miot/names.js';

export { LANGUAGES };

// Seconds between two reads of every device (`poll_interval` options).
export const POLL_INTERVALS = [15, 30, 60, 120];

export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  region: 'de',
  poll_interval: '30',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const interval = Number(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  const username = text(source.username);
  // A password may start or end with a space: kept as typed.
  const password = typeof source.password === 'string' ? source.password : '';
  return {
    username,
    password,
    hasCredentials: username !== '' && password !== '',
    region: REGIONS.includes(source.region) ? source.region : DEFAULT_CONFIG.region,
    pollSeconds: POLL_INTERVALS.includes(interval)
      ? interval
      : Number(DEFAULT_CONFIG.poll_interval),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/**
 * The `poll_frequency` published with the devices: the Gladys value closest
 * to the configured pace, never longer than a minute. Gladys only uses it as
 * a fallback (see src/poller.js): the container reads the devices itself.
 */
export function pollFrequencyMs(pollSeconds) {
  const allowed = Object.values(DEVICE_POLL_FREQUENCIES).sort((a, b) => a - b);
  const wanted = Math.min(pollSeconds * 1000, DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
  return allowed.reduce((best, value) =>
    Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best,
  );
}
