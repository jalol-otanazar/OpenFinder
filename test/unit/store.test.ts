import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../../src/storage/store.js';

describe('FileStore.writeText', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-store-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a text artifact and creates missing parent directories', async () => {
    const path = join(dir, 'runs', 'r1', 'report', 'report.md');
    await store.writeText(path, '# Report\n\nHello.\n');
    expect(await readFile(path, 'utf-8')).toBe('# Report\n\nHello.\n');
  });

  it('overwrites an existing file and leaves no temp file behind', async () => {
    const path = join(dir, 'out.csv');
    await store.writeText(path, 'first');
    await store.writeText(path, 'second');
    expect(await readFile(path, 'utf-8')).toBe('second');
    expect(await store.exists(`${path}.tmp`)).toBe(false);
  });
});
