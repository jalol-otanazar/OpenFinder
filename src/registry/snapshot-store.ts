import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RegistryError } from '../core/errors.js';
import type { CountryCode } from '../core/types/registry.js';
import { type Snapshot, SnapshotSchema } from '../core/types/registry.js';

/** The dated, cached registry snapshot for one country (the chosen fetch model). */
export class SnapshotStore {
  private readonly root: string;

  constructor(root = '.finder-cache/registries') {
    this.root = resolve(root);
  }

  private countryDir(country: CountryCode): string {
    return join(this.root, country.toLowerCase());
  }

  private pointerPath(country: CountryCode): string {
    return join(this.countryDir(country), 'latest.json');
  }

  /** Persist a snapshot under its fetch date and update the `latest` pointer. */
  async write(snapshot: Snapshot): Promise<string> {
    const parsed = SnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new RegistryError(`refusing to cache malformed snapshot: ${parsed.error.message}`);
    }
    const date = parsed.data.meta.fetched_at.slice(0, 10);
    const fileName = `${date}.snapshot.json`;
    const dir = this.countryDir(parsed.data.meta.country);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, fileName);
    await atomicWrite(filePath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    await atomicWrite(
      this.pointerPath(parsed.data.meta.country),
      `${JSON.stringify({ file: fileName }, null, 2)}\n`,
    );
    return filePath;
  }

  /** Whether a cached snapshot exists for this country. */
  async hasSnapshot(country: CountryCode): Promise<boolean> {
    return (await this.readLatest(country)) !== null;
  }

  /** Read the most recent cached snapshot, or null if none has been fetched. */
  async readLatest(country: CountryCode): Promise<Snapshot | null> {
    let pointerRaw: string;
    try {
      pointerRaw = await readFile(this.pointerPath(country), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new RegistryError(`could not read snapshot pointer for ${country}`, { cause: err });
    }

    let fileName: string;
    try {
      const pointer = JSON.parse(pointerRaw) as { file?: unknown };
      if (typeof pointer.file !== 'string') throw new Error('missing "file"');
      fileName = pointer.file;
    } catch (err) {
      throw new RegistryError(`corrupt snapshot pointer for ${country}`, { cause: err });
    }

    let snapshotRaw: string;
    try {
      snapshotRaw = await readFile(join(this.countryDir(country), fileName), 'utf-8');
    } catch (err) {
      throw new RegistryError(`snapshot file "${fileName}" for ${country} is missing`, {
        cause: err,
        hint: 'run `finder universe refresh` to rebuild it',
      });
    }

    const parsed = SnapshotSchema.safeParse(JSON.parse(snapshotRaw));
    if (!parsed.success) {
      throw new RegistryError(
        `cached snapshot for ${country} is malformed: ${parsed.error.message}`,
        {
          hint: 'run `finder universe refresh` to rebuild it',
        },
      );
    }
    return parsed.data;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}
