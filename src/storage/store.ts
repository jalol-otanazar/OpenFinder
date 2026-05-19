import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { StateError } from '../core/errors.js';

/**
 * The storage seam (architecture component 11). Run artifacts are JSON files, so
 * the seam is a narrow validated-file abstraction. A future SqliteStore /
 * PostgresStore implements the same interface; no caller changes.
 */
export interface Store {
  /** Absolute directory for a run's artifacts. */
  resolveRunDir(runId: string): string;
  exists(path: string): Promise<boolean>;
  /** Read + JSON-parse + schema-validate. Throws StateError on any failure. */
  readJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>>;
  /** Schema-validate + atomically write (temp file + rename). */
  writeJson<S extends z.ZodTypeAny>(path: string, data: z.infer<S>, schema: S): Promise<void>;
  /** Atomically write a plain-text artifact (e.g. a reporting deliverable). */
  writeText(path: string, content: string): Promise<void>;
}

/** Default Store — JSON files under `<root>/<run-id>/`. */
export class FileStore implements Store {
  private readonly root: string;

  constructor(root = 'runs') {
    this.root = resolve(root);
  }

  resolveRunDir(runId: string): string {
    return join(this.root, runId);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async readJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch (err) {
      throw new StateError(`could not read ${path}`, { cause: err });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StateError(`${path} is not valid JSON`, { cause: err });
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new StateError(`${path} does not match its schema: ${result.error.message}`);
    }
    return result.data;
  }

  async writeJson<S extends z.ZodTypeAny>(
    path: string,
    data: z.infer<S>,
    schema: S,
  ): Promise<void> {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new StateError(`refusing to write malformed ${path}: ${result.error.message}`);
    }
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(result.data, null, 2)}\n`, 'utf-8');
    await rename(tmp, path);
  }

  async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, path);
  }
}
