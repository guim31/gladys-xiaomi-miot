// -----------------------------------------------------------------------------
// The Xiaomi MIoT hub: knows the devices (Xiaomi account, typed by hand),
// fetches their specifications, reads them at the configured pace, publishes
// their devices and states to Gladys, runs the commands and fires the
// maintenance trigger.
//
// Polling only: a miIO device pushes nothing on the LAN. The container reads
// every added device itself (one grouped get_properties), every 30 s by
// default; the core's onPoll is a fallback, skipped when the timer has just
// read the device (GladysAssistant/Gladys#3198: the core may never poll).
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { CloudError, XiaomiCloud } from './cloud/client.js';
import { isVacuum, normalizeIp, sortCloudDevices } from './cloud/devices.js';
import { buildDevice, deviceIds, deviceName } from './devices.js';
import { HELLO, MIIO_PORT, normalizeToken, parseHelloReply } from './miio/protocol.js';
import { DEFAULT_CHUNK, propertyKey, readProperties, writeProperty } from './miot/properties.js';
import { quirksOf } from './miot/quirks.js';
import { SpecRepository } from './miot/spec.js';
import { READ_ONLY_KINDS, parseUrn, translateSpec } from './miot/translate.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, localized } from './texts.js';

const logger = createLogger({ name: 'xiaomi-miot' });

export const WIDGET_KEY = 'air_quality';
export const TRIGGER = 'maintenance_needed';
/** Why a device needs the user (the trigger's `reason` filter). */
export const REASONS = {
  FILTER: 'filter',
  WATER: 'water',
  FAULT: 'fault',
};
/** Filter life at or under which the filter alert starts. */
export const FILTER_ALERT_PERCENT = 10;

export const HUB_TIMINGS = {
  // A discovery broadcast through the core, to follow the DHCP changes.
  rediscoveryMs: 15 * 60_000,
  // A device that stops answering asks for one sooner, at most this often.
  lostRediscoveryMs: 60_000,
  // Polls in a row without answer before a device is "unreachable".
  unreachableAfter: 2,
  // An unchanged value is sent again this often, so Gladys never shows it
  // as stale (the front says "no recent value" after 48 h).
  heartbeatMs: 6 * 3600_000,
};

const POLL_CONCURRENCY = 4;
const SCAN_TIMEOUT_SECONDS = 3;
// Roles whose change changes what the widget shows in words.
const WIDGET_ROLES = new Set(['power', 'mode', 'fanLevel', 'fault']);

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');
const describe = (err) => {
  const code = err?.cause?.code;
  return code && !String(err.message).includes(code) ? `${err.message} (${code})` : err.message;
};

/** Run `task` on every item, `limit` at a time: `[{ value } | { error }]`. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class MiotHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} options.transport MiioTransport
   * @param {object} [options.specs] SpecRepository
   * @param {object} [options.cloud] XiaomiCloud
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, transport, specs, cloud, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.transport = transport;
    this.specs = specs ?? new SpecRepository({ directory: store.specDirectory });
    this.cloud = cloud ?? new XiaomiCloud();
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<string, object>} device records, by did */
    this.records = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.polling = null;
    this.discovering = null;
    this.lastLostScan = 0;
    this.lastScan = { status: 'not-run', unknown: [] };
    this.verificationPending = false;
    this.stopped = false;
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.loadSpecs();
    await this.discover();
    await this.publishDevices();
    await this.pollAll();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    this.startTimers();
    if (config.hasCredentials && this.records.size === 0) {
      // An account and no device yet (first start): import them now.
      this.track(this.importFromCloud({}, { background: true }));
    }
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    if (previous && previous.language !== config.language) {
      for (const record of this.records.values()) {
        record.translation = null;
      }
    }
    await this.publishDevices();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    const credentialsChanged =
      !previous ||
      previous.username !== config.username ||
      previous.password !== config.password ||
      previous.region !== config.region;
    if (config.hasCredentials && credentialsChanged) {
      // New account details: import at once, the result goes to the logs and
      // to the connection status (the action says the same in full).
      this.track(this.importFromCloud({}, { background: true }));
    }
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    this.pollTimer = setInterval(() => this.track(this.pollAll()), this.config.pollSeconds * 1000);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscover()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    await this.idle();
    this.transport.close();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the Xiaomi updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Xiaomi updates again');
  }

  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  createRecord({ did, model, host, token, name = null, source = 'manual', chunk = null }) {
    return {
      did: String(did),
      model,
      host,
      token,
      name,
      source,
      chunk,
      spec: null,
      specError: null,
      translation: null,
      values: {},
      reachable: null,
      failures: 0,
      tokenRefused: false,
      lastPolledAt: 0,
      commandSeq: 0,
      alerts: new Set(),
      published: {},
    };
  }

  async restore() {
    const data = await this.store.load();
    for (const saved of Object.values(data.devices ?? {})) {
      const host = normalizeIp(saved?.host);
      const token = normalizeToken(saved?.token);
      if (!saved || !/^\d+$/.test(String(saved.did ?? '')) || !host || !token || !saved.model) {
        continue;
      }
      const record = this.createRecord({ ...saved, host, token });
      for (const reason of data.alerts?.[record.did] ?? []) {
        record.alerts.add(reason);
      }
      this.records.set(record.did, record);
    }
  }

  save() {
    const devices = {};
    const alerts = {};
    for (const record of this.records.values()) {
      devices[record.did] = {
        did: record.did,
        model: record.model,
        host: record.host,
        token: record.token,
        name: record.name,
        source: record.source,
        chunk: record.chunk,
      };
      if (record.alerts.size > 0) {
        alerts[record.did] = [...record.alerts];
      }
    }
    return this.store.save({ version: 1, devices, alerts });
  }

  // --- Specifications --------------------------------------------------------

  /** Fetch the specifications still missing (one fetch per model). */
  async loadSpecs(records = [...this.records.values()]) {
    await mapLimit(
      records.filter((record) => !record.spec),
      4,
      (record) => this.loadSpec(record),
    );
  }

  async loadSpec(record) {
    try {
      record.spec = await this.specs.get(record.model);
      record.specError = null;
      record.translation = null;
      this.problems.recover(`spec:${record.model}`, `Specification of ${record.model} loaded`);
    } catch (err) {
      record.specError = err.kind ?? 'network';
      // One line per model, then the next rediscovery tries again.
      this.problems.fail(
        err.kind === 'network' ? 'spec:network' : `spec:${record.model}`,
        `No specification for ${record.model}: ${err.message}`,
      );
    }
  }

  translationOf(record) {
    if (!record.spec) {
      return null;
    }
    if (!record.translation || record.translation.language !== this.config.language) {
      record.translation = {
        language: this.config.language,
        ...translateSpec(record.spec, { model: record.model, language: this.config.language }),
      };
    }
    return record.translation;
  }

  kindOf(record) {
    return parseUrn(record.spec?.type).name || 'device';
  }

  // --- Discovery -------------------------------------------------------------

  discover() {
    this.discovering ??= this.scan().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  /**
   * A hello broadcast through the Gladys core (the container cannot reach
   * the LAN in broadcast): every miIO device answers with its device id,
   * which gives the current address of the known ones.
   */
  async scan() {
    let replies;
    try {
      replies = await this.gladys.scanNetwork('udp-active-broadcast', {
        port: MIIO_PORT,
        payload: HELLO,
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      this.problems.recover('scan', 'Xiaomi discovery through Gladys works again');
    } catch (err) {
      // 403: a core without mediated discovery; 429/409: a scan ran less
      // than 10 s ago. The known addresses still work.
      if (err.status === 429 || err.status === 409) {
        logger.debug(`Xiaomi discovery busy: ${describe(err)}`);
        this.lastScan = { ...this.lastScan, status: 'busy' };
      } else {
        this.problems.fail('scan', `Xiaomi discovery through Gladys failed: ${describe(err)}`);
        this.lastScan = { status: 'unavailable', unknown: [] };
      }
      return 0;
    }
    const found = new Map();
    for (const reply of Array.isArray(replies) ? replies : []) {
      const host = normalizeIp(reply?.source_ip);
      const hello = parseHelloReply(Buffer.from(String(reply?.payload_base64 ?? ''), 'base64'));
      if (host && hello) {
        found.set(String(hello.deviceId), host);
      }
    }
    const unknown = [];
    let moved = false;
    for (const [did, host] of found) {
      const record = this.records.get(did);
      if (!record) {
        unknown.push(host);
      } else if (record.host !== host) {
        logger.info(`${this.label(record)} moved from ${record.host} to ${host}`);
        this.transport.forget(record.host);
        record.host = host;
        record.failures = 0;
        moved = true;
      }
    }
    this.lastScan = { status: 'ok', unknown: unknown.sort() };
    if (moved) {
      await this.save();
    }
    return found.size;
  }

  async rediscover() {
    await this.loadSpecs();
    await this.discover();
    // New devices, and new addresses (DHCP) for the params of the created
    // devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [];
    for (const record of this.records.values()) {
      const translation = this.translationOf(record);
      if (translation && translation.features.length > 0) {
        devices.push(buildDevice(this.gladys, record, translation, this.config));
      }
    }
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      throw new Error(`Unknown Xiaomi device ${externalId}`);
    }
    return record;
  }

  createdDevice(record) {
    const id = deviceIds(this.gladys, record.did).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id) ?? null;
  }

  isCreated(record) {
    return this.createdDevice(record) !== null;
  }

  label(record) {
    const translation = this.translationOf(record);
    return translation ? `${deviceName(record, translation)} (${record.model})` : record.model;
  }

  target(record) {
    const id = Number(record.did);
    return {
      host: record.host,
      token: record.token,
      deviceId: Number.isSafeInteger(id) && id <= 0xffffffff ? id : undefined,
    };
  }

  // --- States ----------------------------------------------------------------

  /** The value a feature shows now (decoded reading), or undefined. */
  featureValue(record, feature) {
    const reading = record.values[propertyKey(feature.siid, feature.piid)];
    if (!reading || reading.code !== 0) {
      return undefined;
    }
    const value = feature.decode(reading.value);
    return value === null ? undefined : value;
  }

  /**
   * Publish what changed for one device, if the user created it (Gladys
   * caps states at 300 a minute and re-evaluates scenes on each one).
   * Resolves with the roles that changed.
   */
  async publishStates(record) {
    const translation = this.translationOf(record);
    if (!translation || !this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.did);
    const states = [];
    const changed = [];
    for (const feature of translation.features) {
      const value = this.featureValue(record, feature);
      if (value === undefined) {
        continue;
      }
      states.push(
        typeof value === 'object'
          ? { device_feature_external_id: ids.feature(feature.key), text: value.text }
          : { device_feature_external_id: ids.feature(feature.key), state: value },
      );
      if (!sameValue(record.published[feature.key], value)) {
        changed.push(feature.role);
      }
    }
    // The SDK sends only the values that changed since its last publication,
    // and the unchanged ones again after the heartbeat.
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const feature of translation.features) {
      const value = this.featureValue(record, feature);
      if (value !== undefined) {
        record.published[feature.key] = value;
      }
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Read it now, send everything again.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    await this.refresh(record);
    await this.publishStates(record);
    await this.publishTransports([record]);
    this.requestWidgetRefresh();
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.did).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()];
    if (this.verificationPending) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.verification);
    } else if (records.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noDevice);
    } else if (records.every((record) => record.reachable === false)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Polling ---------------------------------------------------------------

  /** Read every device the user added (the timer's job). */
  pollAll() {
    this.polling ??= (async () => {
      const records = [...this.records.values()].filter(
        (record) => record.spec && this.isCreated(record),
      );
      const results = await mapLimit(records, POLL_CONCURRENCY, (record) => this.poll(record));
      const errors = results.filter((result) => result.error).map((result) => result.error);
      errors.forEach((err) => this.backgroundFailed(err));
      if (errors.length === 0) {
        this.gladysRecovered();
      }
    })().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** Read one device and publish what changed. */
  async poll(record) {
    const ok = await this.refresh(record);
    if (!ok) {
      return;
    }
    const changed = await this.publishStates(record);
    await this.checkAlerts(record);
    if (changed.some((role) => WIDGET_ROLES.has(role))) {
      this.requestWidgetRefresh();
    }
  }

  /**
   * The core's onPoll (fallback): reads the device unless the timer did it
   * less than 90 % of a period ago.
   */
  async pollFromCore(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record?.spec) {
      return;
    }
    if (this.now() - record.lastPolledAt < this.config.pollSeconds * 900) {
      logger.debug(
        `${this.label(record)} read ${this.now() - record.lastPolledAt} ms ago, skipped`,
      );
      return;
    }
    await this.poll(record);
  }

  /**
   * One grouped read of the translated properties. Resolves true when the
   * device answered (its readings are in `record.values`).
   */
  async refresh(record) {
    const translation = this.translationOf(record);
    if (!translation || translation.features.length === 0) {
      return false;
    }
    record.lastPolledAt = this.now();
    const seq = record.commandSeq;
    const properties = [];
    const seen = new Set();
    for (const { siid, piid } of translation.features) {
      const key = propertyKey(siid, piid);
      if (!seen.has(key)) {
        seen.add(key);
        properties.push({ siid, piid });
      }
    }
    const chunk = record.chunk ?? quirksOf(record.model).chunk ?? DEFAULT_CHUNK;
    let result;
    try {
      result = await readProperties(this.transport, this.target(record), record.did, properties, {
        chunk,
      });
    } catch (err) {
      await this.failed(record, err);
      return false;
    }
    if (result.chunk !== chunk) {
      // Kept for the next polls, and across restarts.
      logger.debug(`${this.label(record)} reads ${result.chunk} properties at a time`);
      record.chunk = result.chunk;
      this.track(this.save());
    }
    if (seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this reading may predate it.
      return false;
    }
    for (const [key, reading] of result.readings) {
      record.values[key] = reading;
    }
    await this.answered(record);
    return true;
  }

  async answered(record) {
    record.failures = 0;
    const wasRefused = record.tokenRefused;
    record.tokenRefused = false;
    this.problems.recover(`read:${record.did}`, `${this.label(record)} reads again`);
    if (record.reachable !== true || wasRefused) {
      const back = record.reachable === false;
      record.reachable = true;
      if (back) {
        logger.info(`${this.label(record)} answers again at ${record.host}`);
      }
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
  }

  /** A read without answer, or refused. */
  async failed(record, err) {
    if (this.stopped || err?.kind === 'closed') {
      return;
    }
    if (err?.kind === 'no-answer' || err?.kind === 'token') {
      // The device says hello, never answers: its token changed (reset,
      // paired again). Said once; the import action brings the new one.
      record.tokenRefused = true;
      this.problems.fail(
        `read:${record.did}`,
        `${this.label(record)} answers at ${record.host} but refuses its token: import the devices again`,
      );
    } else if (!err?.unreachable) {
      this.problems.fail(
        `read:${record.did}`,
        `Cannot read ${this.label(record)}: ${err?.message}`,
      );
    }
    record.failures += 1;
    if (record.failures < this.timings.unreachableAfter || record.reachable === false) {
      return;
    }
    record.reachable = false;
    logger.info(`${this.label(record)} no longer answers at ${record.host}`);
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    if (err?.unreachable && this.now() - this.lastLostScan > this.timings.lostRediscoveryMs) {
      // Maybe a new address (DHCP): look for it now.
      this.lastLostScan = this.now();
      this.track(this.discover());
    }
  }

  // --- Maintenance trigger -----------------------------------------------------

  /** The reasons a device needs the user now, with a detail for each. */
  activeAlerts(record) {
    const translation = this.translationOf(record);
    const active = new Map();
    for (const feature of translation?.features ?? []) {
      const value = this.featureValue(record, feature);
      if (
        feature.role === 'filterLife' &&
        typeof value === 'number' &&
        value <= FILTER_ALERT_PERCENT
      ) {
        active.set(REASONS.FILTER, `${value} %`);
      } else if (feature.role === 'waterShortage' && value === 1) {
        active.set(REASONS.WATER, feature.name);
      } else if (feature.role === 'waterLevel' && value === 0) {
        active.set(REASONS.WATER, '0 %');
      } else if (feature.role === 'fault') {
        const raw = record.values[propertyKey(feature.siid, feature.piid)]?.value;
        const healthy = raw === undefined || raw === null || raw === 0 || raw === '' || raw === '0';
        if (!healthy && value) {
          active.set(REASONS.FAULT, value.text);
        }
      }
    }
    return active;
  }

  /**
   * Fire the trigger once when a reason starts; it clears when the reading
   * says so (filter replaced, tank filled, fault gone). Kept in /data: a
   * restart does not fire again.
   */
  async checkAlerts(record) {
    if (!this.isCreated(record)) {
      return;
    }
    const active = this.activeAlerts(record);
    let changed = false;
    for (const [reason, detail] of active) {
      if (!record.alerts.has(reason)) {
        record.alerts.add(reason);
        changed = true;
        logger.info(`${this.label(record)} needs attention: ${reason} (${detail})`);
        const device = this.createdDevice(record);
        this.track(
          this.gladys.publishSceneEvent(TRIGGER, {
            device: device.external_id,
            device_name: device.name ?? deviceName(record, this.translationOf(record)),
            reason,
            detail: String(detail).slice(0, 200),
          }),
        );
      }
    }
    for (const reason of [...record.alerts]) {
      if (!active.has(reason)) {
        record.alerts.delete(reason);
        changed = true;
      }
    }
    if (changed) {
      await this.save();
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A Gladys command on a feature of one of the devices. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const spec = this.translationOf(record)?.features.find((entry) => entry.key === key);
    if (!spec || spec.read_only || typeof spec.encode !== 'function') {
      throw new Error(`${feature?.external_id} cannot be changed from Gladys`);
    }
    logger.info(`${this.label(record)}: ${spec.name} → ${value}`);
    await this.write(record, spec, spec.encode(value));
  }

  /** Write one property and show the new value at once. */
  async write(record, { siid, piid }, raw) {
    record.commandSeq += 1;
    try {
      await writeProperty(this.transport, this.target(record), record.did, { siid, piid }, raw, {
        timeoutMs: this.transport.timings.commandTimeoutMs,
      });
    } catch (err) {
      if (err.unreachable) {
        await this.failed(record, err);
        throw new Error(`${this.label(record)} does not answer at ${record.host}`, { cause: err });
      }
      throw err;
    }
    record.values[propertyKey(siid, piid)] = { code: 0, value: raw };
    await this.answered(record);
    const changed = await this.publishStates(record);
    if (changed.some((role) => WIDGET_ROLES.has(role))) {
      this.requestWidgetRefresh();
    }
  }

  /**
   * The "Set a MIoT property" scene action: any writable property of the
   * specification, translated or not.
   * @returns {Promise<unknown>} the raw value written
   */
  async setProperty(deviceExternalId, property, value) {
    const record = this.require(deviceExternalId);
    if (!record.spec) {
      throw new Error(`No specification for ${record.model}`);
    }
    const match = String(property ?? '')
      .trim()
      .match(/^(\d+)\s*[.:-]\s*(\d+)$/);
    if (!match) {
      throw new Error(`"${property}" is not a property: write it <siid>.<piid>, e.g. 2.1`);
    }
    const [siid, piid] = [Number(match[1]), Number(match[2])];
    const service = record.spec.services?.find((entry) => entry.iid === siid);
    const prop = service?.properties?.find((entry) => entry.iid === piid);
    if (!prop) {
      throw new Error(`${record.model} has no property ${siid}.${piid}`);
    }
    if (!prop.access?.includes('write')) {
      throw new Error(`${record.model}: ${siid}.${piid} is read only`);
    }
    if (READ_ONLY_KINDS.has(this.kindOf(record)) || parseUrn(service.type).name === 'heater') {
      // Same rule as the features: a heater is never driven from Gladys.
      throw new Error(`${record.model} is a heater: Gladys does not drive it`);
    }
    const raw = coerce(prop, value);
    logger.info(`${this.label(record)}: property ${siid}.${piid} → ${JSON.stringify(raw)}`);
    await this.write(record, { siid, piid }, raw);
    return raw;
  }

  // --- Configuration actions ---------------------------------------------------

  /**
   * Import the devices of the Xiaomi account (manifest action, and at once
   * when the account details change).
   * @param {{ code?: string }} fields
   * @returns {Promise<object>} the message, in four languages
   */
  async importFromCloud({ code } = {}, { background = false } = {}) {
    const config = this.config;
    if (!config.hasCredentials) {
      return localized((text) => text.notConfigured);
    }
    let entries;
    try {
      const session = await this.cloud.login(
        { username: config.username, password: config.password },
        { code: typeof code === 'string' && code.trim() ? code.trim() : undefined },
      );
      entries = await this.cloud.listDevices(session, config.region);
    } catch (err) {
      if (!(err instanceof CloudError)) {
        throw err;
      }
      this.verificationPending = err.kind === 'verification';
      await this.publishConnectionStatus();
      const level = background ? 'warn' : 'info';
      logger[level](`Xiaomi account import failed: ${err.message}`);
      switch (err.kind) {
        case 'verification':
          return localized((text) => text.verification(err.verifyUrl));
        case 'bad-code':
          return localized((text) => text.badCode);
        case 'captcha':
          return localized((text) => text.captcha);
        case 'credentials':
          return localized((text) => text.credentials);
        case 'network':
          return localized((text) => text.unreachable(err.message));
        default:
          return localized((text) => text.refused(err.message));
      }
    }
    this.verificationPending = false;
    const { devices, counts } = sortCloudDevices(entries);
    const imported = [];
    for (const device of devices) {
      const known = this.records.get(device.did);
      if (known) {
        if (known.host !== device.host || known.token !== device.token) {
          this.transport.forget(known.host);
        }
        Object.assign(known, {
          model: device.model,
          host: device.host,
          token: device.token,
          name: device.name ?? known.name,
          source: 'cloud',
        });
        known.tokenRefused = false;
        imported.push(known);
      } else {
        const record = this.createRecord({ ...device, source: 'cloud' });
        this.records.set(record.did, record);
        imported.push(record);
      }
    }
    logger.info(
      `Xiaomi account: ${devices.length} device(s) imported, ${counts.vacuum} vacuum(s), ` +
        `${counts['no-address']} without address, ${counts['no-token']} without token left out`,
    );
    await this.save();
    await this.loadSpecs(imported);
    await this.publishDevices();
    await this.publishConnectionStatus();
    return localized((text, language) => {
      const lines = [];
      if (imported.length === 0) {
        lines.push(text.noneImported(config.region));
      } else {
        lines.push(
          text.imported(
            imported.length,
            imported.map((record) => this.nameIn(record, language)),
          ),
        );
      }
      if (counts.vacuum + counts['no-address'] + counts['no-token'] > 0) {
        lines.push(text.leftOut(counts.vacuum, counts['no-address'], counts['no-token']));
      }
      if (imported.length > 0) {
        lines.push(text.nextStep);
      }
      return lines.join('\n');
    });
  }

  nameIn(record, language) {
    if (record.name) {
      return record.name;
    }
    return record.spec
      ? deviceName(record, translateSpec(record.spec, { model: record.model, language }))
      : record.model;
  }

  /**
   * Add a device by its address and token (manifest action): the model is
   * asked to the device itself (`miIO.info`), which also proves the token.
   */
  async addDevice({ ip, token }) {
    const host = normalizeIp(ip);
    if (!host) {
      return localized((text) => text.invalidIp);
    }
    const hex = normalizeToken(token);
    if (!hex) {
      return localized((text) => text.invalidToken);
    }
    let hello;
    try {
      hello = await this.transport.hello(host);
    } catch {
      return localized((text) => text.noAnswerAt(host));
    }
    let info;
    try {
      info = await this.transport.request(
        { host, token: hex, deviceId: hello.deviceId },
        'miIO.info',
      );
    } catch (err) {
      if (err.kind === 'no-answer' || err.kind === 'token') {
        return localized((text) => text.wrongToken(host));
      }
      return localized((text) => text.noAnswerAt(host));
    }
    const model = typeof info?.model === 'string' ? info.model : null;
    if (!model) {
      return localized((text) => text.wrongToken(host));
    }
    if (isVacuum(model)) {
      return localized((text) => text.vacuum(model));
    }
    const did = String(hello.deviceId);
    const known = this.records.get(did);
    const record = known ?? this.createRecord({ did, model, host, token: hex });
    Object.assign(record, { model, host, token: hex, tokenRefused: false });
    this.records.set(did, record);
    logger.info(`${model} (${did}) added by hand at ${host}`);
    await this.save();
    await this.loadSpec(record);
    await this.publishDevices();
    await this.publishConnectionStatus();
    return localized((text) =>
      record.spec ? text.added(model, host) : `${text.added(model, host)} ${text.noSpec(model)}`,
    );
  }

  /** Forget a device and its token (manifest action). */
  async forgetDevice(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      return localized((text) => text.unknownDevice);
    }
    const name = this.createdDevice(record)?.name ?? this.label(record);
    this.records.delete(record.did);
    this.transport.forget(record.host);
    logger.info(`${this.label(record)} forgotten`);
    await this.save();
    await this.publishDevices();
    await this.publishConnectionStatus();
    return localized((text) => text.forgotten(name));
  }

  /** What the diagnosis action reports, in every language. */
  async diagnose() {
    await this.loadSpecs();
    await this.discover();
    return localized((text, language) => {
      const lines = [];
      if (this.records.size === 0) {
        lines.push(text.diagnosisEmpty);
      }
      for (const record of this.records.values()) {
        const state = record.tokenRefused
          ? text.tokenRefused
          : record.reachable === false
            ? text.noAnswer
            : record.reachable === true
              ? text.answers
              : null;
        const parts = [
          `${this.createdDevice(record)?.name ?? this.nameIn(record, language)}: ${record.model}, ${record.host}`,
        ];
        if (state) {
          parts.push(state);
        }
        if (!record.spec) {
          parts.push(text.specMissing);
        } else {
          const translation = translateSpec(record.spec, { model: record.model, language });
          parts.push(text.features(translation.features.length));
          if (translation.ignored.length > 0) {
            parts.push(
              text.ignored(translation.ignored.map(({ siid, service }) => `${siid} ${service}`)),
            );
          }
        }
        lines.push(`• ${parts.join(' · ')}`);
      }
      if (this.lastScan.status === 'unavailable') {
        lines.push(text.scanUnavailable);
      } else if (this.lastScan.unknown.length > 0) {
        lines.push(text.unknownOnNetwork(this.lastScan.unknown));
      }
      return lines.join('\n');
    });
  }
}

/** A typed value (scene action, text field) in the format of a property. */
export function coerce(prop, value) {
  const text = String(value ?? '').trim();
  if (prop.format === 'bool') {
    if (/^(1|true|on|yes)$/i.test(text)) {
      return true;
    }
    if (/^(0|false|off|no)$/i.test(text)) {
      return false;
    }
    throw new Error(`"${value}" is not a boolean (true/false)`);
  }
  if (prop.format === 'string') {
    return text;
  }
  const number = Number(text.replace(',', '.'));
  if (text === '' || !Number.isFinite(number)) {
    throw new Error(`"${value}" is not a number`);
  }
  if (/^u?int\d+$/.test(prop.format ?? '') && !Number.isInteger(number)) {
    throw new Error(`"${value}" is not an integer`);
  }
  const range = prop['value-range'];
  if (Array.isArray(range) && (number < range[0] || number > range[1])) {
    throw new Error(`${number} is out of the range ${range[0]}-${range[1]}`);
  }
  const list = prop['value-list'];
  if (Array.isArray(list) && list.length > 0 && !list.some((entry) => entry.value === number)) {
    throw new Error(`${number} is not one of ${list.map((entry) => entry.value).join(', ')}`);
  }
  return number;
}
