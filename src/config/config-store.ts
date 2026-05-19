import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigError } from '../core/errors.js';
import { type FinderConfig, FinderConfigSchema, emptyConfig } from '../core/types/config.js';
import { configFilePath } from './paths.js';

/**
 * Loads and persists the FInder config (profiles + role chains). Secrets live
 * only in this one file, written with owner-only permissions.
 */
export interface ConfigStore {
  /** The absolute path of the config file. */
  path(): string;
  /** Load the config, or a fresh empty one if the file does not exist yet. */
  load(): Promise<FinderConfig>;
  /** Validate and atomically persist the config. */
  save(config: FinderConfig): Promise<void>;
}

export class FileConfigStore implements ConfigStore {
  private readonly file: string;

  constructor(file = configFilePath()) {
    this.file = file;
  }

  path(): string {
    return this.file;
  }

  async load(): Promise<FinderConfig> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig();
      throw new ConfigError(`could not read config at ${this.file}`, { cause: err });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`config at ${this.file} is not valid JSON`, {
        cause: err,
        hint: 'fix the file by hand, or delete it and re-run `finder setup`',
      });
    }
    const result = FinderConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(`config at ${this.file} is malformed: ${result.error.message}`, {
        hint: 'delete it and re-run `finder setup`',
      });
    }
    return result.data;
  }

  async save(config: FinderConfig): Promise<void> {
    const result = FinderConfigSchema.safeParse(config);
    if (!result.success) {
      throw new ConfigError(`refusing to save malformed config: ${result.error.message}`);
    }
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    // mode 0o600 — owner read/write only. Honored on POSIX; harmless on Windows.
    await writeFile(tmp, `${JSON.stringify(result.data, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await rename(tmp, this.file);
  }
}
