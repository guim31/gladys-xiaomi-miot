// -----------------------------------------------------------------------------
// Which devices of the Xiaomi account this integration takes: the Wi-Fi
// devices with a local address and a token. Left out, and counted for the
// user:
//   - the robot vacuums: other integrations of the store already drive them
//     (Xiaomi Home for the vacuums of the Mi Home app, Roborock, Dreame);
//   - the Bluetooth and Zigbee devices, and the sub-devices of a gateway:
//     they have no address of their own, nothing local to talk to;
//   - a device the cloud lists without a token (shared by another account).
// -----------------------------------------------------------------------------

import { normalizeToken } from '../miio/protocol.js';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** @returns {string|null} a dotted IPv4 address, or null */
export function normalizeIp(value) {
  const match = typeof value === 'string' ? value.trim().match(IPV4) : null;
  if (!match || !match.slice(1).every((part) => Number(part) <= 255)) {
    return null;
  }
  const ip = match.slice(1).map(Number).join('.');
  return ip === '0.0.0.0' ? null : ip;
}

/** A robot vacuum or mop, by its model name. */
export function isVacuum(model) {
  return (
    typeof model === 'string' &&
    (/\.(vacuum|sweeper|mop|vacuumcleaner)\b/.test(model) ||
      /^(roborock|rockrobo|dreame\.vacuum|viomi\.vacuum)\./.test(model))
  );
}

/**
 * @param {object} entry a raw entry of `home/device_list`
 * @returns {{ status: 'ok'|'vacuum'|'no-address'|'no-token', device?: object }}
 */
export function classifyCloudDevice(entry) {
  const did = entry?.did === undefined || entry?.did === null ? '' : String(entry.did);
  const model = typeof entry?.model === 'string' ? entry.model.trim() : '';
  if (isVacuum(model)) {
    return { status: 'vacuum' };
  }
  const host = normalizeIp(entry?.localip);
  // Bluetooth ("blt.…"), Zigbee ("lumi.…") and mesh devices have no numeric
  // miIO id, or no address of their own.
  if (!/^\d+$/.test(did) || !host || (entry.parent_id && String(entry.parent_id) !== '')) {
    return { status: 'no-address' };
  }
  const token = normalizeToken(entry?.token);
  if (!token || !model) {
    return { status: 'no-token' };
  }
  return {
    status: 'ok',
    device: {
      did,
      model,
      host,
      token,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null,
    },
  };
}

/** Sort the account's devices: `{ devices, counts }`. */
export function sortCloudDevices(entries) {
  const counts = { ok: 0, vacuum: 0, 'no-address': 0, 'no-token': 0 };
  const devices = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const { status, device } = classifyCloudDevice(entry);
    counts[status] += 1;
    if (device) {
      devices.push(device);
    }
  }
  return { devices, counts };
}
