// -----------------------------------------------------------------------------
// From a MIoT specification to Gladys features, without coding each model:
// the standard services of miot-spec-v2 are translated, property by property.
// The approach (not the code) follows hass-xiaomi-miot (al-one, Apache-2.0),
// which maps the standard MIoT services to Home Assistant entities.
//
//   service                         properties translated
//   air-purifier, humidifier,       on, mode, fan-level, fault,
//   dehumidifier, fan, air-fresh    target-humidity, water-level,
//                                   horizontal-/vertical-swing
//   switch, outlet                  on (one feature per switch service)
//   light                           on, brightness, color-temperature, color
//   heater                          on, target-temperature: READ ONLY (below)
//   environment, air-monitor,       temperature, relative-humidity,
//   temperature-humidity-sensor     pm2.5-density, pm10-density, co2-density,
//   (and the services above)        illumination
//   filter                          filter-life-level, filter-left-time
//   battery                         battery-level
//   physical-controls-locked        physical-controls-locked
//   any standard service            electric-power (W)
//   any service (vendor too)        water-shortage(-fault)
//
// Everything else (vendor services, screen, buzzer, timers...) is left out
// and listed by the diagnosis action; the "Set a MIoT property" scene action
// still reaches it.
//
// A heater is never switched from Gladys: it would then be driven by any
// scene, dashboard or voice assistant like a light, and a wrong command can
// heat an empty room or start a device standing too close to something
// (maintainer's rule). It is shown, not driven.
//
// Feature keys are `<siid>-<piid>`: part of the external ids, permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { kindName, namesFor, valueLabel } from './names.js';
import { quirksOf } from './quirks.js';

/** Parts of a MIoT URN: `urn:<namespace>:<what>:<name>:<id>:<model>:<version>`. */
export function parseUrn(urn) {
  const parts = typeof urn === 'string' ? urn.split(':') : [];
  return { namespace: parts[1] ?? '', name: parts[3] ?? '' };
}

const STANDARD = 'miot-spec-v2';
const PRIMARY = new Set([
  'air-purifier',
  'humidifier',
  'dehumidifier',
  'fan',
  'switch',
  'outlet',
  'light',
  'heater',
  'air-fresh',
]);
const AIR_TREATMENT = new Set(['air-purifier', 'humidifier', 'dehumidifier', 'fan', 'air-fresh']);
const SENSING = new Set([
  'environment',
  'air-monitor',
  'temperature-humidity-sensor',
  ...AIR_TREATMENT,
  'heater',
]);
// Services with nothing to show: said nowhere, not even in the diagnosis.
const QUIET = new Set(['device-information']);
// Device kinds with no command at all from Gladys.
export const READ_ONLY_KINDS = new Set(['heater']);

const readable = (prop) => Array.isArray(prop.access) && prop.access.includes('read');
const writable = (prop) => Array.isArray(prop.access) && prop.access.includes('write');
const isInteger = (format) => /^u?int\d+$/.test(format ?? '');
const valueList = (prop) => (Array.isArray(prop['value-list']) ? prop['value-list'] : null);
const valueRange = (prop) => {
  const range = prop['value-range'];
  return Array.isArray(range) && range.length >= 2 && range.every((n) => Number.isFinite(n))
    ? { min: range[0], max: range[1], step: range[2] > 0 ? range[2] : 1 }
    : null;
};
const decimalsOf = (step) => {
  const text = String(step);
  return text.includes('.') ? Math.min(text.split('.')[1].length, 4) : 0;
};
const round = (value, step) => Number(value.toFixed(decimalsOf(step ?? 1)));

/** A numeric reading, or null. */
const asNumber = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
};

const asBinary = (raw) => {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') {
    return 1;
  }
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') {
    return 0;
  }
  return null;
};

/** The raw value to send for a Gladys number, in the property's format. */
function encodeNumber(prop, value) {
  const number = asNumber(value);
  if (number === null) {
    throw new Error(`Not a number: ${value}`);
  }
  const range = valueRange(prop);
  let result = number;
  if (range) {
    result = Math.min(range.max, Math.max(range.min, result));
    result = range.min + Math.round((result - range.min) / range.step) * range.step;
    result = round(result, range.step);
  }
  return isInteger(prop.format) ? Math.round(result) : result;
}

const encodeBinary = (prop) => (value) => {
  const on = Number(value) >= 1;
  return prop.format === 'bool' ? on : on ? 1 : 0;
};

/** Options of a value list: `[{ value: '0', label: 'Auto' }]`. */
function listOptions(prop, language) {
  return valueList(prop)
    .filter((entry) => entry && entry.value !== undefined && entry.value !== null)
    .map((entry) => ({
      value: String(entry.value),
      label: valueLabel(entry.description, language) ?? String(entry.value),
    }));
}

/** Options of a percentage setpoint: every 5 % (or the range step if wider). */
function rangeOptions(range, suffix) {
  const step = Math.max(range.step, (range.max - range.min) / range.step > 20 ? 5 : range.step);
  const options = [];
  for (let value = range.min; value <= range.max + 1e-9; value += step) {
    options.push(round(value, range.step));
  }
  if (options[options.length - 1] !== range.max) {
    options.push(range.max);
  }
  return options.map((value) => ({ value: String(value), label: `${value}${suffix}` }));
}

function selectFeature(prop, options) {
  const values = new Set(options.map((option) => option.value));
  return {
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.SELECT,
    min: 0,
    max: 0,
    supported_options: options.map((option, index) => ({ ...option, sort_order: index })),
    decode: (raw) =>
      raw === undefined || raw === null || raw === '' ? null : { text: String(raw) },
    encode: (value) => {
      const text = String(value);
      if (!values.has(text)) {
        throw new Error(`Unknown option ${text}`);
      }
      return prop.format === 'string' ? text : Number(text);
    },
  };
}

function textFeature(decodeText) {
  return {
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true,
    decode: (raw) => {
      const text = decodeText(raw);
      return text ? { text: String(text).slice(0, 200) } : null;
    },
  };
}

function numberFeature(category, type, { unit, min, max, ratio = 1, step = 1 }) {
  return {
    category,
    type,
    unit,
    min,
    max,
    read_only: true,
    decode: (raw) => {
      const number = asNumber(raw);
      return number === null ? null : round(number * ratio, ratio === 1 ? step : 1);
    },
  };
}

/** A sensor of the environment family, from its property name. */
function sensorFeature(name, prop) {
  const range = valueRange(prop);
  const step = range?.step ?? 1;
  switch (name) {
    case 'temperature':
      if (prop.unit && prop.unit !== 'celsius') {
        return null;
      }
      return {
        role: 'temperature',
        ...numberFeature(CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.CELSIUS,
          min: range?.min ?? -40,
          max: range?.max ?? 100,
          step,
        }),
      };
    case 'relative-humidity':
      return {
        role: 'humidity',
        ...numberFeature(CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
          step,
        }),
      };
    case 'pm2.5-density':
      return {
        role: 'pm25',
        ...numberFeature(CATEGORIES.PM25_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.MICROGRAM_PER_CUBIC_METER,
          min: 0,
          max: range?.max ?? 1000,
          step,
        }),
      };
    case 'pm10-density':
      return {
        role: 'pm10',
        ...numberFeature(CATEGORIES.PM10_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.MICROGRAM_PER_CUBIC_METER,
          min: 0,
          max: range?.max ?? 1000,
          step,
        }),
      };
    case 'co2-density':
      return {
        role: 'co2',
        ...numberFeature(CATEGORIES.CO2_SENSOR, TYPES.SENSOR.INTEGER, {
          unit: UNITS.PPM,
          min: 0,
          max: range?.max ?? 10000,
        }),
        decode: (raw) => {
          const number = asNumber(raw);
          return number === null ? null : Math.round(number);
        },
      };
    case 'illumination':
      if (prop.unit && prop.unit !== 'lux') {
        return null;
      }
      return {
        role: 'illumination',
        ...numberFeature(CATEGORIES.LIGHT_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.LUX,
          min: 0,
          max: range?.max ?? 100000,
          step,
        }),
      };
    default:
      return null;
  }
}

/**
 * The Gladys feature of one MIoT property, or null when it is not translated.
 * @param {object} context `{ kind, service, serviceName, standard, prop, name, language, quirks }`
 */
function translateProperty({ kind, serviceName, standard, prop, name, language, quirks }) {
  const range = valueRange(prop);
  const list = valueList(prop);
  const canWrite = writable(prop) && !READ_ONLY_KINDS.has(kind) && serviceName !== 'heater';

  // Any namespace: the empty water tank of the humidifiers (deerma...).
  if ((name === 'water-shortage' || name === 'water-shortage-fault') && prop.format === 'bool') {
    return {
      role: 'waterShortage',
      category: CATEGORIES.INPUT,
      type: TYPES.INPUT.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      decode: asBinary,
    };
  }
  if (!standard) {
    return null;
  }

  if (PRIMARY.has(serviceName)) {
    if (name === 'on' && prop.format === 'bool') {
      const isLight = serviceName === 'light';
      return {
        role: isLight ? 'light' : 'power',
        category: isLight ? CATEGORIES.LIGHT : CATEGORIES.SWITCH,
        type: isLight ? TYPES.LIGHT.BINARY : TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: !canWrite,
        decode: asBinary,
        encode: encodeBinary(prop),
      };
    }
    if (name === 'fault') {
      const labels = new Map((list ?? []).map((entry) => [entry.value, entry.description]));
      return {
        role: 'fault',
        ...textFeature((raw) => {
          const number = asNumber(raw);
          if (number === 0) {
            return valueLabel('No Faults', language);
          }
          if (raw === undefined || raw === null || raw === '') {
            return null;
          }
          return valueLabel(labels.get(number) ?? labels.get(raw), language) ?? String(raw);
        }),
      };
    }
  }

  if (AIR_TREATMENT.has(serviceName) || serviceName === 'heater') {
    if (name === 'mode' && list) {
      const options = listOptions(prop, language);
      if (canWrite) {
        return { role: 'mode', ...selectFeature(prop, options) };
      }
      const labels = new Map(options.map((option) => [option.value, option.label]));
      return { role: 'mode', ...textFeature((raw) => labels.get(String(raw)) ?? null) };
    }
    if (name === 'fan-level' && serviceName !== 'heater') {
      if (list && canWrite) {
        return { role: 'fanLevel', ...selectFeature(prop, listOptions(prop, language)) };
      }
      if (range && range.step === 1 && range.max - range.min <= 100) {
        return {
          role: 'fanLevel',
          category: CATEGORIES.FAN,
          type: TYPES.FAN.SPEED,
          min: range.min,
          max: range.max,
          read_only: !canWrite,
          decode: (raw) => asNumber(raw),
          encode: (value) => encodeNumber(prop, value),
        };
      }
      return null;
    }
    if (
      name === 'target-humidity' &&
      (serviceName === 'humidifier' || serviceName === 'dehumidifier')
    ) {
      const options = list ? listOptions(prop, language) : range ? rangeOptions(range, ' %') : null;
      if (!options || !canWrite) {
        return null;
      }
      return { role: 'targetHumidity', ...selectFeature(prop, options) };
    }
    if (name === 'water-level' && serviceName === 'humidifier' && range) {
      const full = quirks.waterLevelMax ?? (range.max <= 100 ? 100 : null);
      if (!full) {
        return null;
      }
      return {
        role: 'waterLevel',
        category: CATEGORIES.LEVEL_SENSOR,
        type: TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: true,
        decode: (raw) => {
          const number = asNumber(raw);
          // Above the full mark (127 on the Smartmi): the tank is out.
          if (number === null || number > full + 5) {
            return null;
          }
          return Math.max(0, Math.min(100, Math.round((number * 100) / full)));
        },
      };
    }
    if (name === 'horizontal-swing' && prop.format === 'bool' && serviceName === 'fan') {
      // FAN_ROCK_SETTING: 0 off, 1 left-right (the bounds keep the list to these two).
      return {
        role: 'horizontalSwing',
        category: CATEGORIES.FAN,
        type: TYPES.FAN.ROCK_SETTING,
        min: 0,
        max: 1,
        read_only: !canWrite,
        decode: asBinary,
        encode: encodeBinary(prop),
      };
    }
    if (name === 'vertical-swing' && prop.format === 'bool' && serviceName === 'fan') {
      // A rock setting reaching "up-down" (2) would also offer "left-right".
      return {
        role: 'verticalSwing',
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: !canWrite,
        decode: asBinary,
        encode: encodeBinary(prop),
      };
    }
  }

  if (serviceName === 'heater' && name === 'target-temperature' && range) {
    return {
      role: 'targetTemperature',
      ...numberFeature(CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.TARGET_TEMPERATURE, {
        unit: UNITS.CELSIUS,
        min: range.min,
        max: range.max,
        step: range.step,
      }),
    };
  }

  if (SENSING.has(serviceName)) {
    const sensor = sensorFeature(name, prop);
    if (sensor) {
      return sensor;
    }
  }

  if (serviceName === 'filter') {
    if (name === 'filter-life-level') {
      return {
        role: 'filterLife',
        ...numberFeature(
          CATEGORIES.HEPA_FILTER_MONITORING,
          TYPES.FILTER_MONITORING.FILTER_LIFE_REMAINING,
          {
            unit: UNITS.PERCENT,
            min: 0,
            max: 100,
          },
        ),
      };
    }
    if (name === 'filter-left-time' && ['days', 'hours'].includes(prop.unit)) {
      return {
        role: 'filterLeft',
        ...numberFeature(CATEGORIES.DURATION, TYPES.DURATION.INTEGER, {
          unit: prop.unit === 'days' ? UNITS.DAYS : UNITS.HOURS,
          min: 0,
          max: range?.max ?? 10000,
        }),
      };
    }
  }

  if (serviceName === 'battery' && name === 'battery-level') {
    return {
      role: 'battery',
      ...numberFeature(CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER, {
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    };
  }

  if (
    serviceName === 'physical-controls-locked' &&
    name === 'physical-controls-locked' &&
    prop.format === 'bool'
  ) {
    return {
      role: 'childLock',
      category: CATEGORIES.CHILD_LOCK,
      type: TYPES.CHILD_LOCK.BINARY,
      min: 0,
      max: 1,
      read_only: !writable(prop),
      decode: asBinary,
      encode: encodeBinary(prop),
    };
  }

  if (name === 'electric-power' && (!prop.unit || prop.unit === 'watt' || prop.unit === 'none')) {
    return {
      role: 'electricPower',
      ...numberFeature(CATEGORIES.SWITCH, TYPES.SWITCH.POWER, {
        unit: UNITS.WATT,
        min: 0,
        max: range?.max ?? 10000,
        step: range?.step ?? 1,
      }),
    };
  }

  if (serviceName === 'light' && range) {
    const lightFeature = (role, type, extra) => ({
      role,
      category: CATEGORIES.LIGHT,
      type,
      min: range.min,
      max: range.max,
      read_only: !canWrite,
      decode: (raw) => {
        const number = asNumber(raw);
        return number === null ? null : Math.round(number);
      },
      encode: (value) => encodeNumber(prop, value),
      ...extra,
    });
    if (name === 'brightness') {
      return lightFeature('brightness', TYPES.LIGHT.BRIGHTNESS, {
        unit: prop.unit === 'percentage' ? UNITS.PERCENT : undefined,
      });
    }
    if (name === 'color-temperature' && prop.unit === 'kelvin') {
      return lightFeature('colorTemperature', TYPES.LIGHT.TEMPERATURE, { unit: UNITS.KELVIN });
    }
    if (name === 'color') {
      return lightFeature('color', TYPES.LIGHT.COLOR, { min: 0, max: 0xffffff });
    }
  }

  return null;
}

/**
 * Translate a specification.
 * @param {object} spec the miot-spec.org instance
 * @param {object} options
 * @param {string} options.model
 * @param {string} options.language feature names (frozen at creation)
 * @returns {{ kind: string, kindName: string, features: Array<object>, ignored: Array<{ siid: number, service: string }> }}
 */
export function translateSpec(spec, { model, language }) {
  const kind = parseUrn(spec?.type).name || 'device';
  const quirks = quirksOf(model);
  const names = namesFor(language);
  const features = [];
  const ignored = [];
  for (const service of Array.isArray(spec?.services) ? spec.services : []) {
    if (!Number.isInteger(service?.iid)) {
      continue;
    }
    const { namespace, name: serviceName } = parseUrn(service.type);
    let translated = 0;
    for (const prop of Array.isArray(service.properties) ? service.properties : []) {
      if (!Number.isInteger(prop?.iid) || !readable(prop)) {
        continue;
      }
      const { name } = parseUrn(prop.type);
      const feature = translateProperty({
        kind,
        serviceName,
        standard: namespace === STANDARD,
        prop,
        name,
        language,
        quirks,
      });
      if (!feature) {
        continue;
      }
      translated += 1;
      features.push({
        key: `${service.iid}-${prop.iid}`,
        siid: service.iid,
        piid: prop.iid,
        prop,
        name: names[feature.role],
        read_only: feature.read_only ?? !feature.encode,
        has_feedback: true,
        keep_history: true,
        ...feature,
      });
    }
    if (translated === 0 && !QUIET.has(serviceName)) {
      ignored.push({ siid: service.iid, service: serviceName || service.type });
    }
  }
  // Two features of the same name on one device (a dual switch, two
  // temperatures): number them, in the order of the specification.
  const counts = new Map();
  features.forEach((feature) => counts.set(feature.name, (counts.get(feature.name) ?? 0) + 1));
  const seen = new Map();
  for (const feature of features) {
    if (counts.get(feature.name) > 1) {
      const index = (seen.get(feature.name) ?? 0) + 1;
      seen.set(feature.name, index);
      feature.name = `${feature.name} ${index}`;
    }
  }
  return { kind, kindName: kindName(kind, language), features, ignored };
}
