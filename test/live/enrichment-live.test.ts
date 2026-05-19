import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEnrichment } from '../../src/enrichment/build-enrichment.js';
import {
  CatalogFileSchema,
  type CatalogFile,
  type ProgramRecord,
} from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { ScholarshipFileSchema } from '../../src/core/types/scholarship-record.js';
import { type UniverseFile, UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';

/**
 * Opt-in live smoke test — real LLM + real fetch + real search enrichment of
 * one program. Skipped unless `FINDER_LIVE_SMOKE=1`; needs a configured
 * `worker` role (`finder setup`) and network. Asserts the pipeline runs and
 * produces valid state — not specific facts, which vary with the live web.
 */
const LIVE = process.env['FINDER_LIVE_SMOKE'] === '1' || process.env['FINDER_LIVE_SMOKE'] === 'true';

const INSTITUTION_ID = 'us_massachusetts_institute_of_technology';

function manifest(runId: string): RunManifest {
  const now = '2026-05-19T00:00:00.000Z';
  return {
    schema_version: '1.0',
    run_id: runId,
    created: now,
    updated: now,
    scope: {
      fields: ['Computer Science'],
      countries: ['US'],
      intake: 'Fall 2027',
      profile_ref: 'student-profile.json',
    },
    files: {
      universe: 'universe.json',
      catalog_shards_dir: 'catalog/',
      catalog_merged: 'catalog.json',
      scholarships: 'scholarships.json',
      results_scored: 'results_scored.json',
    },
    stage_status: {
      intake: 'pending',
      universe: 'complete',
      catalog: 'complete',
      enrichment: 'pending',
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 1, default_batch_size: 1 },
    log: [],
  };
}

function program(): ProgramRecord {
  return {
    schema_version: '1.0',
    id: `${INSTITUTION_ID}_computer_science`,
    institution_id: INSTITUTION_ID,
    identity: {
      university: 'Massachusetts Institute of Technology',
      program: 'Computer Science',
      department: 'EECS',
      country: 'US',
      city: 'Cambridge',
      degree_type: null,
      language: 'English',
      duration_months: null,
    },
    requirements: null,
    logistics: null,
    cost_and_funding: null,
    outcomes: null,
    provenance: {
      source_urls: ['https://www.mit.edu'],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: 'catalog stub',
    },
  };
}

function catalogFile(runId: string): CatalogFile {
  return {
    schema_version: '1.0',
    run_id: runId,
    generated: '2026-05-19',
    program_count: 1,
    programs: [program()],
  };
}

function universe(runId: string): UniverseFile {
  return {
    schema_version: '1.0',
    run_id: runId,
    generated: '2026-05-19',
    registry_sources: { US: 'NCES IPEDS' },
    institutions: [
      {
        id: INSTITUTION_ID,
        name: 'Massachusetts Institute of Technology',
        country: 'US',
        region: 'MA',
        registry_source: 'NCES IPEDS',
        official_url: 'https://www.mit.edu',
        status: 'checked',
        programs_found: 1,
        last_checked: '2026-05-19',
        checked_by_batch: 'catalog-US-001',
        notes: '',
      },
    ],
  };
}

describe.skipIf(!LIVE)('enrichment live smoke', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-enrich-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    'enriches a real program with the live LLM, fetcher, and search client',
    async () => {
      const store = new FileStore(join(dir, 'runs'));
      const runDir = store.resolveRunDir('live-run');
      await store.writeJson(join(runDir, 'run-manifest.json'), manifest('live-run'), RunManifestSchema);
      await store.writeJson(join(runDir, 'catalog.json'), catalogFile('live-run'), CatalogFileSchema);
      await store.writeJson(join(runDir, 'universe.json'), universe('live-run'), UniverseFileSchema);

      const result = await buildEnrichment('live-run');

      expect(result.skipped).toBe(false);
      expect(result.complete).toBe(true);

      const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
      const enriched = catalog.programs[0]!;
      expect(enriched.requirements).not.toBeNull();
      expect(enriched.logistics).not.toBeNull();
      expect(enriched.cost_and_funding).not.toBeNull();
      expect(enriched.outcomes).not.toBeNull();

      const scholarships = await store.readJson(join(runDir, 'scholarships.json'), ScholarshipFileSchema);
      expect(scholarships.scholarship_count).toBe(scholarships.scholarships.length);
    },
    240_000,
  );
});
