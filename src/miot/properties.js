// -----------------------------------------------------------------------------
// MIoT properties over miIO: `get_properties` and `set_properties`, keyed by
// `siid` (service) and `piid` (property).
//
// One grouped read per device and per poll, cut in chunks: a request must stay
// under ~1 KB and some firmwares only answer a few properties at a time (Home
// Assistant's hass-xiaomi-miot keeps a per-model list, see quirks.js). A chunk
// that fails is cut in two and read again, down to one property; the size
// that worked is kept for the next polls.
//
// MIoT result codes: 0 done, 1 accepted (applied asynchronously), negative an
// error (-4001 not readable, -4002 not writable, -4003 no such property,
// -4004 internal error, -4005 bad value...).
// -----------------------------------------------------------------------------

export const DEFAULT_CHUNK = 15;
const MIN_CHUNK = 1;

/** `"2.1"`: the key of a property in the readings. */
export const propertyKey = (siid, piid) => `${siid}.${piid}`;

/**
 * Read properties. Never throws for a single bad property: its reading has
 * `code < 0`. Throws the transport error when the device does not answer at
 * all (first chunk, full size), so the caller can tell "unreachable".
 *
 * @param {object} transport MiioTransport
 * @param {object} target `{ host, token, deviceId }`
 * @param {string} did the device id, as the cloud lists it
 * @param {Array<{ siid: number, piid: number }>} properties
 * @param {object} [options]
 * @param {number} [options.chunk] properties per request
 * @returns {Promise<{ readings: Map<string, { code: number, value: unknown }>, chunk: number }>}
 */
export async function readProperties(transport, target, did, properties, { chunk } = {}) {
  let size = Math.max(MIN_CHUNK, Math.min(chunk ?? DEFAULT_CHUNK, DEFAULT_CHUNK));
  const readings = new Map();
  let pending = [...properties];
  let answered = false;
  // After a first failure, one property tells a wrong token (no answer
  // either) from a request too large (answered): then back to half size.
  let resume = null;
  while (pending.length > 0) {
    const slice = pending.slice(0, size);
    try {
      const result = await transport.request(
        target,
        'get_properties',
        slice.map(({ siid, piid }) => ({ did: String(did), siid, piid })),
      );
      answered = true;
      for (const entry of Array.isArray(result) ? result : []) {
        if (entry && Number.isInteger(entry.siid) && Number.isInteger(entry.piid)) {
          readings.set(propertyKey(entry.siid, entry.piid), {
            code: typeof entry.code === 'number' ? entry.code : 0,
            value: entry.value,
          });
        }
      }
      pending = pending.slice(slice.length);
      if (resume !== null) {
        size = resume;
        resume = null;
      }
    } catch (err) {
      if (err.kind === 'closed') {
        throw err;
      }
      if (!answered) {
        // Offline, or silent even to a single property: nothing to cut.
        if (err.unreachable || slice.length === 1) {
          throw err;
        }
        resume = Math.max(MIN_CHUNK, Math.floor(slice.length / 2));
        size = MIN_CHUNK;
        continue;
      }
      if (slice.length > 1) {
        size = Math.max(MIN_CHUNK, Math.floor(slice.length / 2));
        continue;
      }
      // One property the device will not answer: mark it, go on.
      readings.set(propertyKey(slice[0].siid, slice[0].piid), { code: -1, value: undefined });
      pending = pending.slice(1);
    }
  }
  return { readings, chunk: resume ?? size };
}

/**
 * Write one property.
 * @returns {Promise<number>} the MIoT code (0 or 1)
 * @throws an Error with `code` when the device refuses the value
 */
export async function writeProperty(transport, target, did, { siid, piid }, value, options) {
  const result = await transport.request(
    target,
    'set_properties',
    [{ did: String(did), siid, piid, value }],
    options,
  );
  const entry = Array.isArray(result) ? result[0] : null;
  const code = typeof entry?.code === 'number' ? entry.code : 0;
  if (code < 0) {
    const err = new Error(
      `The device refused ${propertyKey(siid, piid)} = ${value} (code ${code})`,
    );
    err.code = code;
    throw err;
  }
  return code;
}
