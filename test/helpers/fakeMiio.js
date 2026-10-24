// -----------------------------------------------------------------------------
// Fake miIO devices on a fake UDP network: `createNetwork(devices).createSocket`
// replaces `dgram.createSocket` in the transport. Each device speaks the real
// packet format (src/miio/protocol.js): it answers the hello, decrypts the
// requests with its token, ignores what it cannot decrypt (a wrong token), and
// answers miIO.info, get_properties and set_properties from its
// specification (test/fixtures/specs). A `legacy` device (the Yeelight lights
// by default) ignores get_properties and set_properties, as the real ones do,
// and answers get_prop and the Yeelight setters instead, in strings.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import {
  HELLO,
  decodePacket,
  encodePacket,
  parsePayload,
  readHeader,
} from '../../src/miio/protocol.js';

const SPEC_DIR = new URL('../fixtures/specs/', import.meta.url);

/** Every specification fixture, by model: `{ model, spec }`. */
export const FIXTURES = Object.fromEntries(
  readdirSync(SPEC_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fixture = JSON.parse(readFileSync(new URL(file, SPEC_DIR), 'utf8'));
      return [fixture.model, fixture];
    }),
);

/** A plausible value for a property: false, the bottom of its range, its first option. */
function defaultValue(prop) {
  // A new filter: the bottom of the range would start the maintenance alert.
  if (/:filter-(life-level|left-time):/.test(prop.type) && Array.isArray(prop['value-range'])) {
    return prop['value-range'][1];
  }
  if (prop.format === 'bool') {
    return false;
  }
  if (prop.format === 'string') {
    return '';
  }
  if (Array.isArray(prop['value-list']) && prop['value-list'].length > 0) {
    return prop['value-list'][0].value;
  }
  if (Array.isArray(prop['value-range'])) {
    return prop['value-range'][0];
  }
  return 0;
}

let nextDid = 100_000_001;

// Yeelight property names, by property type of the `light` service.
const YEELIGHT_NAMES = {
  on: 'power',
  brightness: 'bright',
  'color-temperature': 'ct',
  color: 'rgb',
  mode: 'color_mode',
};
const YEELIGHT_SETTERS = {
  set_power: 'power',
  set_bright: 'bright',
  set_ct_abx: 'ct',
  set_rgb: 'rgb',
};

export class FakeMiio {
  /**
   * @param {string} model a fixture model
   * @param {string} host its address on the fake network
   * @param {object} [options]
   * @param {string} [options.token] 32 hex characters
   * @param {number} [options.did]
   * @param {Record<string, unknown>} [options.values] "siid.piid" → value
   * @param {number} [options.maxChunk] get_properties larger than this go unanswered
   * @param {boolean} [options.legacy] speaks the older miIO protocol only
   */
  constructor(
    model,
    host,
    { token, did, values = {}, maxChunk = Infinity, legacy = /^yeelink\.light\./.test(model) } = {},
  ) {
    const fixture = FIXTURES[model];
    if (!fixture) {
      throw new Error(`No fixture for ${model}`);
    }
    this.model = model;
    this.spec = fixture.spec;
    this.host = host;
    this.did = did ?? nextDid++;
    this.token = token ?? this.did.toString(16).padStart(32, 'a');
    this.maxChunk = maxChunk;
    this.legacy = legacy;
    this.online = true;
    this.bootedAt = Date.now();
    this.calls = [];
    this.values = {};
    for (const service of this.spec.services) {
      for (const prop of service.properties ?? []) {
        if (prop.access?.includes('read')) {
          this.values[`${service.iid}.${prop.iid}`] = defaultValue(prop);
        }
      }
    }
    Object.assign(this.values, values);
    /** Yeelight name → "siid.piid" */
    this.names = {};
    for (const service of this.spec.services) {
      if (service.type.split(':')[3] !== 'light') {
        continue;
      }
      for (const prop of service.properties ?? []) {
        const name = YEELIGHT_NAMES[prop.type.split(':')[3]];
        if (name) {
          this.names[name] = `${service.iid}.${prop.iid}`;
        }
      }
    }
  }

  /** The older miIO methods: get_prop and the Yeelight setters. */
  answerLegacy({ method, params }) {
    if (method === 'get_prop') {
      return {
        result: params.map((name) => {
          const value = this.values[this.names[name]];
          if (value === undefined) {
            return '';
          }
          return name === 'power' ? (value ? 'on' : 'off') : String(value);
        }),
      };
    }
    const name = YEELIGHT_SETTERS[method];
    if (name && this.names[name]) {
      this.values[this.names[name]] = name === 'power' ? params[0] === 'on' : params[0];
      return { result: ['ok'] };
    }
    return undefined;
  }

  property(siid, piid) {
    const service = this.spec.services.find((entry) => entry.iid === siid);
    return service?.properties?.find((entry) => entry.iid === piid) ?? null;
  }

  stamp() {
    return Math.floor((Date.now() - this.bootedAt) / 1000) + 1000;
  }

  /** @returns {Buffer|null} the reply datagram */
  handle(packet) {
    if (!this.online) {
      return null;
    }
    if (packet.equals(HELLO)) {
      const reply = Buffer.alloc(32, 0xff);
      reply.writeUInt16BE(0x2131, 0);
      reply.writeUInt16BE(32, 2);
      reply.writeUInt32BE(0, 4);
      reply.writeUInt32BE(this.did, 8);
      reply.writeUInt32BE(this.stamp(), 12);
      return reply;
    }
    const header = readHeader(packet);
    if (!header || header.deviceId !== this.did) {
      return null;
    }
    let request;
    try {
      request = parsePayload(decodePacket(this.token, packet).payload);
    } catch {
      // A token that does not decrypt: a real device stays silent.
      return null;
    }
    this.calls.push(request);
    const result = this.answer(request);
    if (result === undefined) {
      return null;
    }
    return encodePacket({
      token: this.token,
      deviceId: this.did,
      stamp: this.stamp(),
      payload: `${JSON.stringify({ id: request.id, ...result })}\0`,
    });
  }

  answer({ method, params }) {
    if (this.legacy && method !== 'miIO.info') {
      // get_properties and set_properties go unanswered, like a wrong token.
      return this.answerLegacy({ method, params });
    }
    switch (method) {
      case 'miIO.info':
        return { result: { model: this.model, fw_ver: '1.0.0', hw_ver: 'esp32' } };
      case 'get_properties':
        if (params.length > this.maxChunk) {
          return undefined;
        }
        return {
          result: params.map(({ did, siid, piid }) =>
            `${siid}.${piid}` in this.values
              ? { did, siid, piid, code: 0, value: this.values[`${siid}.${piid}`] }
              : { did, siid, piid, code: -4003 },
          ),
        };
      case 'set_properties':
        return {
          result: params.map(({ did, siid, piid, value }) => {
            const prop = this.property(siid, piid);
            if (!prop?.access?.includes('write')) {
              return { did, siid, piid, code: -4002 };
            }
            this.values[`${siid}.${piid}`] = value;
            return { did, siid, piid, code: 0 };
          }),
        };
      default:
        return { error: { code: -9999, message: 'unknown method' } };
    }
  }

  /** What the core's discovery relays for this device. */
  scanReply() {
    return {
      source_ip: this.host,
      source_port: 54321,
      payload_base64: this.handle(HELLO).toString('base64'),
    };
  }
}

/**
 * @param {FakeMiio[]} devices
 */
export function createNetwork(devices) {
  const network = {
    devices,
    sent: 0,
    scanReplies() {
      return devices.filter((device) => device.online).map((device) => device.scanReply());
    },
    createSocket() {
      const socket = new EventEmitter();
      let open = true;
      socket.bind = (port, callback) => setImmediate(callback);
      socket.unref = () => socket;
      socket.close = () => {
        open = false;
      };
      socket.send = (data, port, host, callback) => {
        network.sent += 1;
        setImmediate(() => {
          callback?.(null);
          const device = devices.find((entry) => entry.host === host);
          const reply = device && port === 54321 ? device.handle(Buffer.from(data)) : null;
          if (reply && open) {
            setImmediate(() => open && socket.emit('message', reply, { address: host, port }));
          }
        });
      };
      return socket;
    },
  };
  return network;
}
