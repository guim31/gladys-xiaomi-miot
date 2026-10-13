// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `air_quality`.
//
// One air purifier, humidifier, fan or air monitor at a glance: its air
// readings as live tiles, the filter life as a gauge, its state in words,
// and one-tap buttons for the power and its first modes. The Gladys device
// box already has every control; the widget gathers what matters for the air
// of a room in one card.
//
// Budget (8 components, 2 texts, 6 tiles, 1 status, 4 buttons): a caption,
// up to four tiles, one status list, the power button and up to two mode
// buttons. The running mode is marked by its icon (`check-circle`), never by
// the button style: `primary` is invisible in dark mode.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds } from './devices.js';
import { WIDGET_KEY } from './hub.js';

const ACTIVE_ICON = 'check-circle';
const MODE_ACTION_PREFIX = 'mode_';
const POWER_ACTION = 'power';
const MAX_TILES = 4;
const MAX_MODE_BUTTONS = 2;

// The tiles, in order of interest: what the air is, then the device.
const TILE_ROLES = [
  { role: 'pm25', icon: 'wind' },
  { role: 'co2', icon: 'cloud' },
  { role: 'temperature', icon: 'thermometer' },
  { role: 'humidity', icon: 'droplet' },
  { role: 'waterLevel', icon: 'droplet' },
  { role: 'filterLife', gauge: true },
];

export const TEXT = {
  pick: {
    en: 'Choose a Xiaomi device in the settings of this widget.',
    fr: 'Choisissez un appareil Xiaomi dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets ein Xiaomi-Gerät aus.',
    es: 'Elija un dispositivo Xiaomi en la configuración de este widget.',
  },
  unknown: {
    en: 'This Xiaomi device is not known to the integration: import the devices again.',
    fr: 'Cet appareil Xiaomi est inconnu de l’intégration : importez de nouveau les appareils.',
    de: 'Dieses Xiaomi-Gerät ist der Integration unbekannt: Importiere die Geräte erneut.',
    es: 'Este dispositivo Xiaomi no es conocido por la integración: vuelva a importar los dispositivos.',
  },
  noSpec: {
    en: 'The specification of this model is not loaded yet: see the diagnosis action.',
    fr: 'La spécification de ce modèle n’est pas encore chargée : voyez l’action de diagnostic.',
    de: 'Die Spezifikation dieses Modells ist noch nicht geladen: Sieh dir die Diagnose-Aktion an.',
    es: 'La especificación de este modelo aún no está cargada: consulte la acción de diagnóstico.',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  on: { en: 'On', fr: 'En marche', de: 'Ein', es: 'Encendido' },
  off: { en: 'Off', fr: 'Arrêté', de: 'Aus', es: 'Apagado' },
  turnOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  turnOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  unreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  switchedOn: { en: 'Turned on', fr: 'Allumé', de: 'Eingeschaltet', es: 'Encendido' },
  switchedOff: { en: 'Turned off', fr: 'Éteint', de: 'Ausgeschaltet', es: 'Apagado' },
  modeSet: { en: 'Mode: ', fr: 'Mode : ', de: 'Modus: ', es: 'Modo: ' },
};

const t = (text, language) => text[language] ?? text.en;

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const byRole = (translation, role) =>
  translation.features.find((feature) => feature.role === role) ?? null;

/** The current value of a select feature, as its option. */
function currentOption(hub, record, feature) {
  const value = hub.featureValue(record, feature);
  return feature.supported_options?.find((option) => option.value === value?.text) ?? null;
}

async function get(hub, { settings, language = 'en' }) {
  const record = settings?.device ? hub.resolveDevice(settings.device) : null;
  if (!record) {
    return message(settings?.device ? TEXT.unknown : TEXT.pick, language);
  }
  const translation = hub.translationOf(record);
  if (!translation) {
    return message(TEXT.noSpec, language);
  }
  const ids = deviceIds(hub.gladys, record.did);
  const caption = [translation.kindName, record.host];
  if (record.reachable === false) {
    caption.push(t(TEXT.unreachable, language));
  }
  const components = [{ type: 'text', variant: 'caption', text: caption.join(' · ') }];

  let tiles = 0;
  for (const { role, icon, gauge } of TILE_ROLES) {
    const feature = byRole(translation, role);
    if (!feature || tiles >= MAX_TILES) {
      continue;
    }
    tiles += 1;
    components.push(
      gauge
        ? { type: 'gauge', device_feature: ids.feature(feature.key), label: feature.name }
        : { type: 'value', device_feature: ids.feature(feature.key), label: feature.name, icon },
    );
  }

  const power = byRole(translation, 'power') ?? byRole(translation, 'light');
  const lit = power ? hub.featureValue(record, power) === 1 : null;
  const items = [];
  if (power) {
    items.push({
      label: t(TEXT.state, language),
      icon: 'power',
      value: t(lit ? TEXT.on : TEXT.off, language),
      color: lit ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  for (const role of ['mode', 'fanLevel']) {
    const feature = byRole(translation, role);
    const value = feature ? hub.featureValue(record, feature) : undefined;
    const label = feature?.supported_options
      ? currentOption(hub, record, feature)?.label
      : typeof value === 'object'
        ? value.text
        : value;
    if (feature && label !== undefined && label !== null) {
      items.push({ label: feature.name, icon: 'sliders', value: String(label).slice(0, 40) });
    }
  }
  const fault = byRole(translation, 'fault');
  if (fault && record.alerts.has('fault')) {
    items.push({
      label: fault.name,
      icon: 'alert-triangle',
      value: String(hub.featureValue(record, fault)?.text ?? '').slice(0, 40) || '?',
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  if (power && !power.read_only) {
    components.push({
      type: 'button',
      label: t(lit ? TEXT.turnOff : TEXT.turnOn, language),
      icon: 'power',
      style: 'secondary',
      // The tap toggles the state the device has then, not the one shown.
      action: { key: POWER_ACTION },
    });
  }
  const mode = byRole(translation, 'mode');
  if (mode?.supported_options && !mode.read_only) {
    const active = currentOption(hub, record, mode)?.value;
    mode.supported_options.slice(0, MAX_MODE_BUTTONS).forEach((option, index) => {
      components.push({
        type: 'button',
        label: option.label.slice(0, 24),
        icon: lit && option.value === active ? ACTIVE_ICON : 'play',
        style: 'secondary',
        // Numbered keys: the core drops a button whose action key is taken.
        action: { key: `${MODE_ACTION_PREFIX}${index + 1}`, params: { value: option.value } },
      });
    });
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey, params = {}, settings }) {
  const device = settings?.device;
  if (!device) {
    throw new Error(TEXT.pick.en);
  }
  const record = hub.require(device);
  const translation = hub.translationOf(record);
  if (!translation) {
    throw new Error(TEXT.noSpec.en);
  }
  const ids = deviceIds(hub.gladys, record.did);
  const call = (feature, value) =>
    hub.setValue({ external_id: ids.device }, { external_id: ids.feature(feature.key) }, value);
  if (actionKey === POWER_ACTION) {
    const power = byRole(translation, 'power') ?? byRole(translation, 'light');
    if (!power || power.read_only) {
      throw new Error('This device has no power command');
    }
    const on = hub.featureValue(record, power) !== 1;
    await call(power, on ? 1 : 0);
    return { message: on ? TEXT.switchedOn : TEXT.switchedOff };
  }
  if (actionKey.startsWith(MODE_ACTION_PREFIX)) {
    const mode = byRole(translation, 'mode');
    const option = mode?.supported_options?.find((entry) => entry.value === String(params.value));
    if (!option || mode.read_only) {
      throw new Error(`Unknown mode ${params.value}`);
    }
    await call(mode, option.value);
    return {
      message: Object.fromEntries(
        Object.entries(TEXT.modeSet).map(([language, prefix]) => [
          language,
          `${prefix}${option.label}`,
        ]),
      ),
    };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
