// -----------------------------------------------------------------------------
// What some models do differently from their specification. Taken from the
// per-model settings of hass-xiaomi-miot (al-one, Apache-2.0,
// core/device_customizes.py), which come from its users' devices: only the
// few that change what this integration reads.
//
//   - chunk: the most properties the device answers in one get_properties
//     (larger requests time out or come back incomplete). Any other model
//     starts at 15 and is cut down by itself when a request fails
//     (src/miot/properties.js).
//   - waterLevelMax: the raw value of a full tank, when the specification's
//     range is not 0-100 (the Smartmi humidifiers count to 120 and use 127+
//     for "no tank").
// -----------------------------------------------------------------------------

const QUIRKS = [
  { pattern: /^deerma\.humidifier\.jsq$/, chunk: 1 },
  { pattern: /^deerma\.humidifier\.jsq5$/, chunk: 4 },
  { pattern: /^deerma\.humidifier\./, chunk: 6 },
  { pattern: /^chuangmi\.plug\.212a01$/, chunk: 7 },
  { pattern: /^cuco\.plug\.cp2$/, chunk: 1 },
  { pattern: /^cuco\.plug\.wp5m$/, chunk: 1 },
  { pattern: /^zhimi\.humidifier\.ca4$/, waterLevelMax: 120 },
];

/** The quirks of a model: `{ chunk?, waterLevelMax? }`. */
export function quirksOf(model) {
  const found = {};
  for (const quirk of QUIRKS) {
    if (typeof model === 'string' && quirk.pattern.test(model)) {
      for (const [key, value] of Object.entries(quirk)) {
        if (key !== 'pattern' && found[key] === undefined) {
          found[key] = value;
        }
      }
    }
  }
  return found;
}
