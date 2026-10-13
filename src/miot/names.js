// -----------------------------------------------------------------------------
// The names the integration gives in Gladys: feature names, device kinds and
// the labels of the MIoT value lists, in the four languages of the Gladys
// interface. Feature and device names are frozen when the user creates the
// device, in the language chosen in the configuration at that moment.
//
// The value-list labels come from the specifications in English ("Auto",
// "Level2", "Favorite"...): the common ones are translated, any other is shown
// as the specification writes it.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Feature names, by role (src/miot/translate.js). */
export const NAMES = {
  en: {
    power: 'Power',
    light: 'Light',
    mode: 'Mode',
    fanLevel: 'Fan speed',
    horizontalSwing: 'Horizontal oscillation',
    verticalSwing: 'Vertical oscillation',
    targetHumidity: 'Target humidity',
    waterLevel: 'Water level',
    waterShortage: 'Water tank empty',
    targetTemperature: 'Target temperature',
    fault: 'Fault',
    temperature: 'Temperature',
    humidity: 'Humidity',
    pm25: 'PM2.5',
    pm10: 'PM10',
    co2: 'CO2',
    illumination: 'Illuminance',
    filterLife: 'Filter life',
    filterLeft: 'Filter time left',
    battery: 'Battery',
    childLock: 'Child lock',
    electricPower: 'Power draw',
    brightness: 'Brightness',
    colorTemperature: 'Color temperature',
    color: 'Color',
  },
  fr: {
    power: 'Marche',
    light: 'Lumière',
    mode: 'Mode',
    fanLevel: 'Vitesse de ventilation',
    horizontalSwing: 'Oscillation horizontale',
    verticalSwing: 'Oscillation verticale',
    targetHumidity: 'Humidité cible',
    waterLevel: "Niveau d'eau",
    waterShortage: 'Réservoir vide',
    targetTemperature: 'Température de consigne',
    fault: 'Défaut',
    temperature: 'Température',
    humidity: 'Humidité',
    pm25: 'PM2,5',
    pm10: 'PM10',
    co2: 'CO2',
    illumination: 'Luminosité ambiante',
    filterLife: 'Durée de vie du filtre',
    filterLeft: 'Temps restant du filtre',
    battery: 'Batterie',
    childLock: 'Sécurité enfant',
    electricPower: 'Puissance consommée',
    brightness: 'Luminosité',
    colorTemperature: 'Température de couleur',
    color: 'Couleur',
  },
  de: {
    power: 'Ein/Aus',
    light: 'Licht',
    mode: 'Modus',
    fanLevel: 'Lüfterstufe',
    horizontalSwing: 'Horizontale Oszillation',
    verticalSwing: 'Vertikale Oszillation',
    targetHumidity: 'Zielfeuchtigkeit',
    waterLevel: 'Wasserstand',
    waterShortage: 'Wassertank leer',
    targetTemperature: 'Solltemperatur',
    fault: 'Störung',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    pm25: 'PM2,5',
    pm10: 'PM10',
    co2: 'CO2',
    illumination: 'Beleuchtungsstärke',
    filterLife: 'Filterlebensdauer',
    filterLeft: 'Filter-Restzeit',
    battery: 'Batterie',
    childLock: 'Kindersicherung',
    electricPower: 'Leistungsaufnahme',
    brightness: 'Helligkeit',
    colorTemperature: 'Farbtemperatur',
    color: 'Farbe',
  },
  es: {
    power: 'Encendido',
    light: 'Luz',
    mode: 'Modo',
    fanLevel: 'Velocidad del ventilador',
    horizontalSwing: 'Oscilación horizontal',
    verticalSwing: 'Oscilación vertical',
    targetHumidity: 'Humedad objetivo',
    waterLevel: 'Nivel de agua',
    waterShortage: 'Depósito vacío',
    targetTemperature: 'Temperatura de consigna',
    fault: 'Avería',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    pm25: 'PM2,5',
    pm10: 'PM10',
    co2: 'CO2',
    illumination: 'Iluminancia',
    filterLife: 'Vida útil del filtro',
    filterLeft: 'Tiempo restante del filtro',
    battery: 'Batería',
    childLock: 'Bloqueo infantil',
    electricPower: 'Consumo',
    brightness: 'Brillo',
    colorTemperature: 'Temperatura de color',
    color: 'Color',
  },
};

/** Device kinds (the device type of the specification). */
export const KIND_NAMES = {
  en: {
    'air-purifier': 'Air purifier',
    humidifier: 'Humidifier',
    dehumidifier: 'Dehumidifier',
    fan: 'Fan',
    outlet: 'Smart plug',
    switch: 'Switch',
    light: 'Light',
    'temperature-humidity-sensor': 'Temperature and humidity sensor',
    'air-monitor': 'Air quality monitor',
    heater: 'Heater',
    'air-fresh': 'Fresh air system',
    device: 'Xiaomi device',
  },
  fr: {
    'air-purifier': "Purificateur d'air",
    humidifier: 'Humidificateur',
    dehumidifier: 'Déshumidificateur',
    fan: 'Ventilateur',
    outlet: 'Prise connectée',
    switch: 'Interrupteur',
    light: 'Lampe',
    'temperature-humidity-sensor': 'Capteur de température et d’humidité',
    'air-monitor': "Moniteur de qualité de l'air",
    heater: 'Radiateur',
    'air-fresh': "Système d'air frais",
    device: 'Appareil Xiaomi',
  },
  de: {
    'air-purifier': 'Luftreiniger',
    humidifier: 'Luftbefeuchter',
    dehumidifier: 'Luftentfeuchter',
    fan: 'Ventilator',
    outlet: 'Smarte Steckdose',
    switch: 'Schalter',
    light: 'Lampe',
    'temperature-humidity-sensor': 'Temperatur- und Feuchtigkeitssensor',
    'air-monitor': 'Luftqualitätsmonitor',
    heater: 'Heizgerät',
    'air-fresh': 'Frischluftsystem',
    device: 'Xiaomi-Gerät',
  },
  es: {
    'air-purifier': 'Purificador de aire',
    humidifier: 'Humidificador',
    dehumidifier: 'Deshumidificador',
    fan: 'Ventilador',
    outlet: 'Enchufe inteligente',
    switch: 'Interruptor',
    light: 'Lámpara',
    'temperature-humidity-sensor': 'Sensor de temperatura y humedad',
    'air-monitor': 'Monitor de calidad del aire',
    heater: 'Calefactor',
    'air-fresh': 'Sistema de aire fresco',
    device: 'Dispositivo Xiaomi',
  },
};

/** Value-list labels, keyed by the lower-case English description. */
export const VALUE_LABELS = {
  en: {
    auto: 'Auto',
    sleep: 'Sleep',
    favorite: 'Favorite',
    manual: 'Manual',
    silent: 'Silent',
    low: 'Low',
    medium: 'Medium',
    middle: 'Medium',
    high: 'High',
    strong: 'Strong',
    'straight wind': 'Straight wind',
    'natural wind': 'Natural wind',
    'no faults': 'No fault',
    level: 'Level',
  },
  fr: {
    auto: 'Auto',
    sleep: 'Nuit',
    favorite: 'Favori',
    manual: 'Manuel',
    silent: 'Silencieux',
    low: 'Faible',
    medium: 'Moyen',
    middle: 'Moyen',
    high: 'Fort',
    strong: 'Puissant',
    'straight wind': 'Vent direct',
    'natural wind': 'Vent naturel',
    'no faults': 'Aucun défaut',
    level: 'Niveau',
  },
  de: {
    auto: 'Auto',
    sleep: 'Schlafen',
    favorite: 'Favorit',
    manual: 'Manuell',
    silent: 'Leise',
    low: 'Niedrig',
    medium: 'Mittel',
    middle: 'Mittel',
    high: 'Hoch',
    strong: 'Stark',
    'straight wind': 'Direkter Wind',
    'natural wind': 'Natürlicher Wind',
    'no faults': 'Keine Störung',
    level: 'Stufe',
  },
  es: {
    auto: 'Auto',
    sleep: 'Noche',
    favorite: 'Favorito',
    manual: 'Manual',
    silent: 'Silencioso',
    low: 'Bajo',
    medium: 'Medio',
    middle: 'Medio',
    high: 'Alto',
    strong: 'Potente',
    'straight wind': 'Viento directo',
    'natural wind': 'Viento natural',
    'no faults': 'Sin avería',
    level: 'Nivel',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/**
 * The label of a value-list entry: "Level2" → "Niveau 2", "Auto" → "Auto",
 * anything unknown as the specification writes it.
 */
export function valueLabel(description, language) {
  const labels = VALUE_LABELS[language] ?? VALUE_LABELS.en;
  const text = typeof description === 'string' ? description.trim() : '';
  if (text === '') {
    return null;
  }
  const lower = text.toLowerCase();
  if (labels[lower]) {
    return labels[lower];
  }
  const level = lower.match(/^(?:level|lv|gear)\s*-?\s*(\d+)$/);
  if (level) {
    return `${labels.level} ${Number(level[1])}`;
  }
  return text;
}

export function kindName(kind, language) {
  const kinds = KIND_NAMES[language] ?? KIND_NAMES.en;
  return kinds[kind] ?? kinds.device;
}
