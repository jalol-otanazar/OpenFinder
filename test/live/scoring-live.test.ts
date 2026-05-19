import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScoring } from '../../src/scoring/build-scoring.js';
import { type CatalogFile, CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { ResultsScoredFileSchema } from '../../src/core/types/scored-program.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { FileStore } from '../../src/storage/store.js';

/**
 * Opt-in live smoke test — real LLM scoring of one program. Skipped unless
 * `FINDER_LIVE_SMOKE=1`; needs a configured `worker` role (`finder setup`).
 * Asserts the pipeline runs and produces a valid scorecard — not specific
 * verdicts, which depend on the live model's judgment.
 */
const LIVE = process.env['FINDER_LIVE_SMOKE'] === '1' || process.env['FINDER_LIVE_SMOKE'] === 'true';

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
      enrichment: 'complete',
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
    id: 'us_massachusetts_institute_of_technology_meng_cs',
    institution_id: 'us_massachusetts_institute_of_technology',
    identity: {
      university: 'Massachusetts Institute of Technology',
      program: 'Master of Engineering in Computer Science',
      department: 'EECS',
      country: 'US',
      city: 'Cambridge',
      degree_type: 'MEng',
      language: 'English',
      duration_months: 12,
    },
    requirements: {
      min_gpa: { raw: '3.5 / 4.0', us_4_0_equivalent: 3.5 },
      required_background: 'Computer Science or related',
      prerequisites: ['programming', 'algorithms'],
      gre: 'not required',
      english_tests: { ielts: '7.0', toefl: '100', duolingo: null, pte: null },
      english_waiver: null,
      reference_letters: 3,
      other_documents: ['CV', 'statement of purpose'],
    },
    logistics: {
      application_deadlines: ['2026-12-15'],
      intake_terms: ['Fall'],
      application_fee: 'USD 75',
      application_portal: null,
      decision_timeline: '8-12 weeks',
    },
    cost_and_funding: {
      tuition_international: { amount: 58000, currency: 'USD', period: 'year' },
      living_cost_estimate: { amount: 26000, currency: 'USD', period: 'year' },
      scholarships_for_internationals: [],
      funding_likelihood: 'partial',
      fully_funded: false,
    },
    outcomes: {
      field_ranking: 'Top 5 US (CS)',
      post_study_work_rights: 'F-1 OPT / STEM OPT',
      placement_info: null,
    },
    provenance: {
      source_urls: ['https://www.mit.edu'],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: 'enrichment',
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

describe.skipIf(!LIVE)('scoring live smoke', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-scoring-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    'scores a real program with the live LLM',
    async () => {
      const store = new FileStore(join(dir, 'runs'));
      const runDir = store.resolveRunDir('live-run');
      await store.writeJson(join(runDir, 'run-manifest.json'), manifest('live-run'), RunManifestSchema);
      await store.writeJson(join(runDir, 'catalog.json'), catalogFile('live-run'), CatalogFileSchema);

      const profile = emptyStudentProfile('2026-05-19');
      profile.identity.nationality = 'Uzbek';
      profile.real_goal.scoring_profile = 'program-as-vehicle';
      await store.writeJson(join(runDir, 'student-profile.json'), profile, StudentProfileSchema);

      const result = await buildScoring('live-run');

      expect(result.skipped).toBe(false);
      expect(result.complete).toBe(true);

      const results = await store.readJson(join(runDir, 'results_scored.json'), ResultsScoredFileSchema);
      expect(results.scored_count).toBe(1);
      const card = results.programs[0]!;
      expect(['PASS', 'FAIL', 'UNCERTAIN']).toContain(card.eligibility.verdict);
      expect(['Reach', 'Match', 'Safety']).toContain(card.admission_chance.bucket);
      expect(card.weighted_total).toBeGreaterThanOrEqual(0);
      expect(card.weighted_total).toBeLessThanOrEqual(100);
      expect(card.summary.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
