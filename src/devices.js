// -----------------------------------------------------------------------------
// From a Xiaomi device (its record and the translation of its specification)
// to the Gladys device of the Discovery tab.
//
// One Gladys device per miIO device, keyed on its device id (`did`), the id
// the Xiaomi cloud and the device itself give (the hello answer): a device
// imported from the account and the same device typed by hand are the same
// Gladys device. The token never leaves /data: the params carry the address
// and the model only.
// -----------------------------------------------------------------------------

import { pollFrequencyMs } from './config.js';

export const DEVICE_TYPE = 'miot';

/** External ids of the Gladys device of a Xiaomi device. */
export const deviceIds = (gladys, did) => gladys.externalIds(DEVICE_TYPE, did);

/** Default name: the Mi Home name, else the kind and the end of the id. */
export function deviceName(record, translation) {
  if (record.name) {
    return record.name.slice(0, 60);
  }
  return `${translation.kindName} ${String(record.did).slice(-4)}`;
}

/**
 * @param {object} gladys
 * @param {object} record the hub's record of the device
 * @param {object} translation translateSpec() of its specification
 * @param {object} config normalized configuration
 */
export function buildDevice(gladys, record, translation, config) {
  const ids = deviceIds(gladys, record.did);
  return {
    name: deviceName(record, translation),
    external_id: ids.device,
    // Gladys polls these devices as a fallback only: the container reads
    // them itself (src/hub.js), the core skips devices whose fields it read
    // wrong at creation (GladysAssistant/Gladys#3198).
    should_poll: true,
    poll_frequency: pollFrequencyMs(config.pollSeconds),
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      { name: 'MODEL', value: record.model },
    ],
    features: translation.features.map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: true,
        keep_history: spec.keep_history !== false,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      if (spec.supported_options) {
        feature.supported_options = spec.supported_options;
      }
      return feature;
    }),
  };
}
