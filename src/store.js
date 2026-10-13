// -----------------------------------------------------------------------------
// Persistence under /data (the only writable path of the container):
//
//   /data/xiaomi-miot.json   the devices known (did, model, address, TOKEN,
//                            name, where they come from, the chunk size that
//                            works) and the maintenance alerts in progress
//   /data/specs/             the MIoT specifications (src/miot/spec.js)
//
// The tokens give control of the devices on the LAN: the file is written
// with mode 0600 and never logged. Writes are coalesced and atomic
// (temporary file + rename): a crash never leaves half a JSON file.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ProblemLog } from './problems.js';

const logger = createLogger({ name: 'miot-store' });
const FILE_NAME = 'xiaomi-miot.json';

export const DATA_DIR = process.env.XIAOMI_MIOT_DATA_DIR || '/data';

export class Store {
  constructor(directory = DATA_DIR) {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.specDirectory = join(directory, 'specs');
    this.pending = null;
    this.writing = null;
    this.latest = null;
    // A volume that refuses writes is said once, not at every change.
    this.problems = new ProblemLog(logger);
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  save(data) {
    this.latest = data;
    if (!this.pending) {
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
          this.problems.recover('write', `${this.path} is written again`);
        } catch (err) {
          this.problems.fail('write', `Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
