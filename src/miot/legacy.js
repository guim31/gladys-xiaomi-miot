// -----------------------------------------------------------------------------
// Models that do not speak MIoT on the LAN. miot-spec.org describes them, but
// they ignore get_properties and set_properties and keep the older miIO
// methods: `get_prop` with property names, then one method per change
// (`set_power`, `set_bright`...). The device stays silent, as it does for a
// wrong token.
//
// The list comes from hass-xiaomi-miot (al-one, Apache-2.0,
// core/miio2miot_specs.py), built from its users' devices: only the Yeelight
// lights are taken here. Their table maps the same four properties of the
// `light` service on every model, whatever their order in the specification,
// so the mapping goes by property type (checked against miot-spec.org for
// each model, 24/10/2026). The rest of the service (night light, scenes,
// background light) is not translated anyway.
//
// Yeelight answers `get_prop` with strings ("on", "80", "4000") and `""` for
// a property it does not have, and every setter with ["ok"].
// -----------------------------------------------------------------------------

import { propertyKey } from './properties.js';
import { parseUrn } from './translate.js';

const family = (prefix, numbers) => numbers.map((number) => `${prefix}${number}`);

const LEGACY_LIGHTS = new Set([
  ...family('yeelink.light.bslamp', [1, 2, 3]),
  'yeelink.light.ceil27',
  ...family(
    'yeelink.light.ceiling',
    Array.from({ length: 24 }, (_, index) => index + 1),
  ),
  ...family('yeelink.light.color', [1, 2, 3, 4, 5, 7, 8]),
  ...family('yeelink.light.lamp', [1, 2, 3, 4, 5, 7, 9, 10, 15]),
  ...family('yeelink.light.mono', [1, 4, 5]),
  ...family('yeelink.light.panel', [1, 3]),
  ...family('yeelink.light.strip', [1, 2, 4, 6, 8]),
  ...family('yilai.light.ceiling', [1, 2, 3]),
]);

const readNumber = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
};

const readOnOff = (raw) => {
  if (raw === 'on') {
    return true;
  }
  return raw === 'off' ? false : null;
};

/** Property of the `light` service → miIO property name and setter. */
const LIGHT = {
  on: {
    prop: 'power',
    read: readOnOff,
    write: (value) => ['set_power', [value ? 'on' : 'off']],
  },
  brightness: { prop: 'bright', write: (value) => ['set_bright', [value]] },
  // set_ct_abx takes the effect and its duration, always.
  'color-temperature': { prop: 'ct', write: (value) => ['set_ct_abx', [value, 'smooth', 500]] },
  color: { prop: 'rgb', write: (value) => ['set_rgb', [value]] },
};

/**
 * The miIO mapping of a model that only speaks the older protocol:
 * `"siid.piid"` → `{ prop, read?, write? }`, or null for a MIoT device.
 * @param {string} model
 * @param {object} spec its miot-spec.org instance
 */
export function legacyMapping(model, spec) {
  if (!LEGACY_LIGHTS.has(model) || !Array.isArray(spec?.services)) {
    return null;
  }
  const mapping = new Map();
  for (const service of spec.services) {
    const { namespace, name } = parseUrn(service?.type);
    if (namespace !== 'miot-spec-v2' || name !== 'light') {
      continue;
    }
    for (const prop of service.properties ?? []) {
      const entry = LIGHT[parseUrn(prop?.type).name];
      if (entry && Number.isInteger(prop.iid)) {
        mapping.set(propertyKey(service.iid, prop.iid), entry);
      }
    }
  }
  return mapping;
}

/**
 * Read properties with one `get_prop`, in the shape of readProperties: a
 * property the mapping does not know reads as -4003 (no such property), one
 * the device leaves empty as -1.
 * @returns {Promise<{ readings: Map<string, { code: number, value: unknown }> }>}
 */
export async function readLegacy(transport, target, mapping, properties) {
  const readings = new Map();
  const asked = [];
  for (const { siid, piid } of properties) {
    const key = propertyKey(siid, piid);
    const entry = mapping.get(key);
    if (entry) {
      asked.push({ key, entry });
    } else {
      readings.set(key, { code: -4003, value: undefined });
    }
  }
  if (asked.length === 0) {
    return { readings };
  }
  const result = await transport.request(
    target,
    'get_prop',
    asked.map(({ entry }) => entry.prop),
  );
  asked.forEach(({ key, entry }, index) => {
    const value = (entry.read ?? readNumber)(Array.isArray(result) ? result[index] : undefined);
    readings.set(key, value === null ? { code: -1, value: undefined } : { code: 0, value });
  });
  return { readings };
}

/**
 * Write one property with its miIO method.
 * @returns {Promise<number>} 0
 * @throws an Error with `code` -4002 when the property has no miIO method
 */
export async function writeLegacy(transport, target, mapping, { siid, piid }, value, options) {
  const entry = mapping.get(propertyKey(siid, piid));
  if (!entry?.write) {
    const err = new Error(
      `${propertyKey(siid, piid)} cannot be changed over the older miIO protocol`,
    );
    err.code = -4002;
    throw err;
  }
  const [method, params] = entry.write(value);
  // A refusal comes back as a device error (MiioError) from the transport.
  await transport.request(target, method, params, options);
  return 0;
}
