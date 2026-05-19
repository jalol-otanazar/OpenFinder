import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIntake } from '../../src/intake/build-intake.js';
import { RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { StudentProfileSchema } from '../../src/core/types/student-profile.js';
import { FileStore } from '../../src/storage/store.js';

/**
 * Opt-in live smoke test — real LLM extraction of a profile from a paragraph
 * of student prose. Skipped unless `FINDER_LIVE_SMOKE=1`; needs a configured
 * `worker` role (`finder setup`). Asserts a valid profile + manifest are
 * produced — not exact field values, which depend on the live model.
 */
const LIVE = process.env['FINDER_LIVE_SMOKE'] === '1' || process.env['FINDER_LIVE_SMOKE'] === 'true';

const PROSE =
  'I am an Uzbek computer science undergraduate graduating in 2027. I want a fully ' +
  'funded master’s in the US or Canada — I cannot self-fund tuition. My real goal is ' +
  'to relocate and work in the tech industry; the degree is mainly a means to that.';

describe.skipIf(!LIVE)('intake live smoke', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-intake-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    'extracts a profile from prose with the live LLM',
    async () => {
      const store = new FileStore(join(dir, 'runs'));
      const result = await runIntake('live-run', { prompt: PROSE }, { store });

      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.countries.length).toBeGreaterThan(0);

      const runDir = store.resolveRunDir('live-run');
      const profile = await store.readJson(join(runDir, 'student-profile.json'), StudentProfileSchema);
      expect(profile.preferences.fields.length).toBeGreaterThan(0);

      const manifest = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
      expect(manifest.stage_status.intake).toBe('complete');
      expect(manifest.scope.countries.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
