import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../src/config/config-store.js';
import { maskSecret } from '../../src/config/redact.js';
import type { FinderConfig } from '../../src/core/types/config.js';

describe('maskSecret', () => {
  it('masks the middle of a long key', () => {
    const masked = maskSecret('gsk_1234567890abcd');
    expect(masked.startsWith('gsk_12')).toBe(true);
    expect(masked.endsWith('abcd')).toBe(true);
    expect(masked).not.toContain('7890');
  });

  it('fully masks short keys and reports empties', () => {
    expect(maskSecret('short')).toBe('••••••');
    expect(maskSecret('')).toBe('(not set)');
  });
});

describe('FileConfigStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-cfg-'));
    file = join(dir, 'config.json');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty config when the file does not exist', async () => {
    const config = await new FileConfigStore(file).load();
    expect(config.profiles).toEqual({});
    expect(config.roles.worker).toEqual([]);
  });

  it('round-trips profiles and role chains', async () => {
    const store = new FileConfigStore(file);
    const config: FinderConfig = {
      schema_version: '1.0',
      profiles: {
        groq: { provider: 'groq', label: 'Groq free', api_key: 'gsk_secret', base_url: null },
      },
      roles: {
        orchestrator: [{ profile: 'groq', model: 'llama-3.3-70b' }],
        worker: [{ profile: 'groq', model: 'llama-3.3-70b' }],
      },
    };
    await store.save(config);

    const loaded = await new FileConfigStore(file).load();
    expect(loaded).toEqual(config);
  });
});
