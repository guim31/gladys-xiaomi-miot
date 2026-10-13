// -----------------------------------------------------------------------------
// MIoT specifications: what services and properties a model has, from the
// public miot-spec.org (no account). A specification never changes for a
// given URN, so each one is fetched once and kept under /data/specs.
//
//   GET https://miot-spec.org/miot-spec-v2/instances?status=released
//     → { instances: [{ model, version, type: "urn:miot-spec-v2:device:…", status }] }
//   GET https://miot-spec.org/miot-spec-v2/instance?type=<urn>
//     → { type, description, services: [{ iid, type, properties, actions }] }
//
// The model list (a few MB) is reduced to model → URN (the released URN of
// the highest version) and kept a week: a model it does not know asks for a
// fresh one at most once a day.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SPEC_URL = 'https://miot-spec.org/miot-spec-v2';
const LIST_FILE = 'instances.json';
const LIST_MAX_AGE_MS = 7 * 24 * 3600_000;
const LIST_RETRY_MS = 24 * 3600_000;
const TIMEOUT_MS = 30_000;

export class SpecError extends Error {
  /** @param {'unknown-model'|'network'|'invalid'} kind */
  constructor(message, kind) {
    super(message);
    this.name = 'SpecError';
    this.kind = kind;
  }
}

/** The file name of a model, safe on any filesystem. */
const fileOf = (model) => `${model.replace(/[^a-z0-9._-]/gi, '_')}.json`;

/**
 * Pick, for each model, the URN to use: a released one before any other
 * status, then the highest version.
 * @param {Array} instances
 * @returns {Record<string, string>}
 */
export function reduceInstances(instances) {
  const best = new Map();
  for (const entry of Array.isArray(instances) ? instances : []) {
    if (!entry || typeof entry.model !== 'string' || typeof entry.type !== 'string') {
      continue;
    }
    const rank = [entry.status === 'released' ? 1 : 0, Number(entry.version) || 0];
    const previous = best.get(entry.model);
    if (
      !previous ||
      rank[0] > previous.rank[0] ||
      (rank[0] === previous.rank[0] && rank[1] > previous.rank[1])
    ) {
      best.set(entry.model, { rank, type: entry.type });
    }
  }
  return Object.fromEntries([...best].map(([model, { type }]) => [model, type]));
}

/** Basic shape check of a specification. */
export function isSpec(spec) {
  return (
    !!spec &&
    typeof spec === 'object' &&
    typeof spec.type === 'string' &&
    spec.type.startsWith('urn:') &&
    Array.isArray(spec.services)
  );
}

export class SpecRepository {
  /**
   * @param {object} options
   * @param {string} options.directory where the specifications are kept
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({ directory, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.directory = directory;
    this.fetch = fetchImpl;
    this.now = now;
    /** @type {Map<string, object>} specifications by model */
    this.specs = new Map();
    /** @type {Map<string, Promise>} fetches in progress, by model */
    this.loading = new Map();
    this.list = null;
    this.listTriedAt = 0;
  }

  /**
   * The specification of a model: memory, then /data, then miot-spec.org.
   * @throws SpecError
   */
  get(model) {
    const known = this.specs.get(model);
    if (known) {
      return Promise.resolve(known);
    }
    if (!this.loading.has(model)) {
      this.loading.set(
        model,
        this.load(model).finally(() => this.loading.delete(model)),
      );
    }
    return this.loading.get(model);
  }

  /** A specification already in memory (synchronous), or null. */
  peek(model) {
    return this.specs.get(model) ?? null;
  }

  async load(model) {
    const path = join(this.directory, fileOf(model));
    const saved = await readJson(path);
    if (isSpec(saved?.spec) && saved.model === model) {
      this.specs.set(model, saved.spec);
      return saved.spec;
    }
    const urn = await this.urnOf(model);
    const spec = await this.download(`${SPEC_URL}/instance?type=${encodeURIComponent(urn)}`);
    if (!isSpec(spec)) {
      throw new SpecError(
        `miot-spec.org answered an invalid specification for ${model}`,
        'invalid',
      );
    }
    await writeJson(this.directory, path, {
      model,
      urn,
      fetched_at: new Date(this.now()).toISOString(),
      spec,
    });
    this.specs.set(model, spec);
    return spec;
  }

  async urnOf(model) {
    if (!this.list) {
      const saved = await readJson(join(this.directory, LIST_FILE));
      if (saved && typeof saved.models === 'object') {
        this.list = { at: Date.parse(saved.fetched_at) || 0, models: saved.models };
      }
    }
    const stale = !this.list || this.now() - this.list.at > LIST_MAX_AGE_MS;
    const missing = !this.list?.models[model] && this.now() - this.listTriedAt > LIST_RETRY_MS;
    if (stale || missing) {
      this.listTriedAt = this.now();
      try {
        const answer = await this.download(`${SPEC_URL}/instances?status=released`);
        const models = reduceInstances(answer?.instances);
        if (Object.keys(models).length > 0) {
          this.list = { at: this.now(), models };
          await writeJson(this.directory, join(this.directory, LIST_FILE), {
            fetched_at: new Date(this.now()).toISOString(),
            models,
          });
        }
      } catch (err) {
        // An old list still serves the models it knows.
        if (!this.list?.models[model]) {
          throw err;
        }
      }
    }
    const urn = this.list?.models[model];
    if (!urn) {
      throw new SpecError(`miot-spec.org has no specification for ${model}`, 'unknown-model');
    }
    return urn;
  }

  async download(url) {
    let response;
    try {
      response = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const code = err?.cause?.code ?? err?.name ?? 'error';
      throw new SpecError(`Cannot reach miot-spec.org (${code})`, 'network');
    }
    if (!response.ok) {
      throw new SpecError(`miot-spec.org answered ${response.status}`, 'network');
    }
    try {
      return await response.json();
    } catch {
      throw new SpecError('miot-spec.org answered something that is not JSON', 'invalid');
    }
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(directory, path, data) {
  try {
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(data));
    await rename(temporary, path);
  } catch {
    // A read-only or full volume: the specification stays in memory, it is
    // downloaded again after a restart.
  }
}
