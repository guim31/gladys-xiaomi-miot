// -----------------------------------------------------------------------------
// miIO over UDP: one request, one reply, encrypted with the device token.
//
// - A device needs its own id and its stamp in every request: a "hello" is
//   sent first and its answer kept (the "session") while the device keeps
//   answering; a failure forgets it, the next request says hello again.
// - One socket per exchange, bound on an ephemeral port: the reply comes back
//   to it in unicast, which crosses the Docker bridge NAT (only broadcast does
//   not). Nothing else can arrive there, and a late reply of a previous
//   exchange finds its socket closed.
// - UDP loses datagrams: an unanswered request is sent again (with a new id)
//   until the deadline. One exchange at a time per device: a small Wi-Fi
//   chip answers one request at a time, and two would cross.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import {
  HELLO,
  MIIO_PORT,
  decodePacket,
  encodePacket,
  parseHelloReply,
  parsePayload,
} from './protocol.js';

export const TRANSPORT_TIMINGS = {
  // Total wait for a reading; a command gets a little more.
  timeoutMs: 5_000,
  commandTimeoutMs: 6_000,
  // Wait for one copy of a request before sending it again.
  attemptMs: 1_500,
  // A session older than this says hello again (stamps drift, devices reboot).
  sessionMs: 10 * 60_000,
};

export class MiioError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {'offline'|'no-answer'|'token'|'device-error'|'moved'|'socket'|'closed'} [details.kind]
   * @param {number} [details.code] the device error code
   */
  constructor(message, { kind = 'device-error', code } = {}) {
    super(message);
    this.name = 'MiioError';
    this.kind = kind;
    this.code = code;
  }

  /** The device did not answer at all: off, unplugged, or another address. */
  get unreachable() {
    return this.kind === 'offline' || this.kind === 'socket' || this.kind === 'moved';
  }
}

export class MiioTransport {
  /**
   * @param {object} [options]
   * @param {() => object} [options.createSocket] test seam: a dgram-like socket
   * @param {number} [options.port] destination port of the devices
   * @param {object} [options.timings] TRANSPORT_TIMINGS overrides
   * @param {() => number} [options.now] milliseconds clock
   * @param {object} [options.logger]
   */
  constructor({ createSocket, port = MIIO_PORT, timings, now = () => Date.now(), logger } = {}) {
    this.createSocket = createSocket ?? (() => dgram.createSocket('udp4'));
    this.port = port;
    this.timings = { ...TRANSPORT_TIMINGS, ...timings };
    this.now = now;
    this.logger = logger;
    /** @type {Map<string, { deviceId: number, offset: number, at: number }>} by host */
    this.sessions = new Map();
    /** @type {Map<string, Promise>} tail of the exchanges of each host */
    this.queues = new Map();
    /** @type {Map<string, number>} last message id, by host */
    this.ids = new Map();
    /** @type {Set<object>} open sockets, closed on stop */
    this.sockets = new Set();
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const socket of this.sockets) {
      try {
        socket.emit?.('close');
        socket.close();
      } catch {
        // Already closed.
      }
    }
    this.sockets.clear();
  }

  /** Forget the session of a host (its device was replaced, or moved). */
  forget(host) {
    this.sessions.delete(host);
  }

  nextId(host) {
    const previous = this.ids.get(host) ?? Math.floor(Math.random() * 9_000) + 1;
    const id = previous >= 2_147_483_000 ? 1 : previous + 1;
    this.ids.set(host, id);
    return id;
  }

  /**
   * Send one JSON-RPC request and resolve with its `result`.
   * @param {object} target
   * @param {string} target.host IPv4 address
   * @param {string} target.token hex token
   * @param {number} [target.deviceId] the expected device id: an address now
   *   answered by another device fails with kind `moved`
   * @param {string} method e.g. 'get_properties'
   * @param {Array|object} [params]
   * @param {{ timeoutMs?: number }} [options]
   */
  request(target, method, params = [], options = {}) {
    const { host } = target;
    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous.then(() => this.exchange(target, method, params, options));
    const tail = run.catch(() => {});
    this.queues.set(host, tail);
    tail.then(() => {
      if (this.queues.get(host) === tail) {
        this.queues.delete(host);
      }
    });
    return run;
  }

  /**
   * Say hello to an address: `{ deviceId, stamp, token }` of whatever device
   * answers there (diagnosis, manual addition).
   */
  hello(host, { timeoutMs = this.timings.timeoutMs } = {}) {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous.then(() =>
      this.withSocket(async (channel) => {
        const reply = await this.handshake(channel, host, this.now() + timeoutMs);
        return reply;
      }),
    );
    this.queues.set(
      host,
      run.catch(() => {}),
    );
    return run;
  }

  async exchange({ host, token, deviceId }, method, params, { timeoutMs } = {}) {
    if (this.closed) {
      throw new MiioError('The integration is stopping', { kind: 'closed' });
    }
    const deadline = this.now() + (timeoutMs ?? this.timings.timeoutMs);
    try {
      return await this.withSocket(async (channel) => {
        let session = this.sessions.get(host);
        if (!session || this.now() - session.at > this.timings.sessionMs) {
          const reply = await this.handshake(channel, host, deadline);
          session = {
            deviceId: reply.deviceId,
            offset: reply.stamp - Math.floor(this.now() / 1000),
            at: this.now(),
          };
          this.sessions.set(host, session);
        }
        if (deviceId !== undefined && session.deviceId !== deviceId) {
          throw new MiioError(`${host} is now another device (${session.deviceId})`, {
            kind: 'moved',
          });
        }
        return await this.call(channel, { host, token, session }, method, params, deadline);
      });
    } catch (err) {
      // Whatever failed, the next request starts with a fresh hello.
      this.sessions.delete(host);
      throw err;
    }
  }

  /** Open a socket for one exchange, close it after. */
  async withSocket(fn) {
    const socket = this.createSocket();
    this.sockets.add(socket);
    const inbox = [];
    let wake = null;
    // Closing the transport wakes an exchange waiting for its reply.
    socket.once('close', () => wake?.());
    socket.on('message', (message, remote) => {
      inbox.push({ message, remote });
      wake?.();
    });
    socket.on('error', (err) => this.logger?.debug(`UDP socket error: ${err.message}`));
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) =>
          reject(new MiioError(`Cannot open a UDP socket: ${err.message}`, { kind: 'socket' }));
        socket.once('error', onError);
        socket.bind(0, () => {
          socket.off?.('error', onError);
          socket.unref?.();
          resolve();
        });
      });
      const channel = {
        send: (data, host) =>
          new Promise((resolve) => {
            socket.send(data, this.port, host, (err) => {
              if (err) {
                this.logger?.debug(`Cannot send to ${host}: ${err.message}`);
              }
              resolve();
            });
          }),
        /** Next datagram from `host` before `until` (ms), or null. */
        receive: async (host, until) => {
          for (;;) {
            const index = inbox.findIndex((entry) => entry.remote?.address === host);
            if (index >= 0) {
              return inbox.splice(index, 1)[0].message;
            }
            const wait = until - this.now();
            if (wait <= 0 || this.closed) {
              return null;
            }
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, wait);
              wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
            wake = null;
          }
        },
      };
      return await fn(channel);
    } finally {
      this.sockets.delete(socket);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  async handshake(channel, host, deadline) {
    while (this.now() < deadline && !this.closed) {
      await channel.send(HELLO, host);
      const until = Math.min(deadline, this.now() + this.timings.attemptMs);
      for (;;) {
        const message = await channel.receive(host, until);
        if (!message) {
          break;
        }
        const reply = parseHelloReply(message);
        if (reply) {
          return reply;
        }
      }
    }
    if (this.closed) {
      throw new MiioError('The integration is stopping', { kind: 'closed' });
    }
    throw new MiioError(`${host} does not answer`, { kind: 'offline' });
  }

  async call(channel, { host, token, session }, method, params, deadline) {
    let undecryptable = false;
    while (this.now() < deadline && !this.closed) {
      const id = this.nextId(host);
      const payload = Buffer.from(`${JSON.stringify({ id, method, params })}\0`);
      const stamp = Math.floor(this.now() / 1000) + session.offset;
      await channel.send(encodePacket({ token, deviceId: session.deviceId, stamp, payload }), host);
      const until = Math.min(deadline, this.now() + this.timings.attemptMs);
      for (;;) {
        const message = await channel.receive(host, until);
        if (!message) {
          break;
        }
        let reply;
        try {
          reply = parsePayload(decodePacket(token, message).payload);
        } catch {
          // A hello echo, or a token that does not decrypt the answer.
          undecryptable = message.length > 32;
          continue;
        }
        if (reply === null) {
          // Some firmwares answer an empty payload when they are busy.
          continue;
        }
        if (reply.id !== id) {
          continue;
        }
        if (reply.error) {
          const code = reply.error.code;
          throw new MiioError(
            `${host} answered ${method} with error ${code}: ${reply.error.message ?? ''}`.trim(),
            { kind: 'device-error', code },
          );
        }
        return reply.result;
      }
    }
    if (this.closed) {
      throw new MiioError('The integration is stopping', { kind: 'closed' });
    }
    if (undecryptable) {
      throw new MiioError(`${host} answers, but its token does not decrypt the reply`, {
        kind: 'token',
      });
    }
    // The device said hello but ignored the request: most often a wrong
    // token (an encrypted request it cannot read is dropped silently).
    throw new MiioError(`${host} does not answer ${method} (wrong token?)`, {
      kind: 'no-answer',
    });
  }
}
