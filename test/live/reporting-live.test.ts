import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReporting } from '../../src/reporting/build-reporting.js';
import { type CatalogFile, CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { ResultsScoredFileSchema, type ScoredProgram } from '../../src/core/types/scored-program.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { type UniverseFile, UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';

/**
 * Opt-in live smoke test — real reporting of a small scored run: live LLM gap
 * report + deadline calendar, and a fetch-grounded per-country visa brief.
 * Skipped unless `FINDER_LIVE_SMOKE=1`; needs a configured `worker` role and
 * network. Asserts the deliverables are produced — not their exact prose.
 */
const LIVE = process.env['FINDER_LIVE_SMOKE'] === '1' || process.env['FINDER_LIVE_SMOKE'] === 'true';

const INSTITUTION_ID = 'us_massachusetts_institute_of_technology';
const PROGRAM_ID = `${INSTITUTION_ID}_meng_cs`;

function manifest(runId: string): RunManifest {
  const now = '2026-05-19T00:00:00.000Z';
  return {
    schema_version: '1.0',
    run_id: runId,
    created: now,
    updated: now,
    scope: { fields: ['Computer Science'], countries: ['US'], intake: 'Fall 2027', profile_ref: 'student-profile.json' },
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
      scoring: 'complete',
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
    id: PROGRAM_ID,
    institution_id: INSTITUTION_ID,
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
      required_background: 'Computer Science',
      prerequisites: [],
      gre: 'not required',
      english_tests: { ielts: '7.0', toefl: '100', duolingo: null, pte: null },
      english_waiver: null,
      reference_letters: 3,
      other_documents: ['CV'],
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
      living_cost_estimate: null,
      scholarships_for_internationals: [],
      funding_likelihood: 'partial',
      fully_funded: false,
    },
    outcomes: { field_ranking: 'Top 5 US', post_study_work_rights: 'F-1 OPT / STEM OPT', placement_info: null },
    provenance: { source_urls: ['https://www.mit.edu'], last_verified: '2026-05-19', source_confidence: 'web-verified', verification_notes: '' },
  };
}

function scoredProgram(): ScoredProgram {
  return {
    program_id: PROGRAM_ID,
    institution_id: INSTITUTION_ID,
    identity: {
      university: 'Massachusetts Institute of Technology',
      program: 'Master of Engineering in Computer Science',
      country: 'US',
      degree_type: 'MEng',
    },
    eligibility: { verdict: 'UNCERTAIN', reasoning: 'GPA is close to the bar.', must_confirm: ['exact GPA conversion'] },
    admission_chance: { bucket: 'Reach', reasoning: 'Highly selective.' },
    academic_fit: { score: 5, reasoning: 'Excellent.' },
    funding_fit: { score: 2, reasoning: 'Limited funding.' },
    location_fit: { score: 4, reasoning: 'Strong tech ecosystem.' },
    visa: { score: 4, reasoning: 'F-1 with STEM OPT.' },
    logistics: { score: 3, reasoning: 'Deadline is tight.' },
    weighted_total: 58,
    recommendation_tier: 'Apply',
    summary: 'A reach worth one application slot if funding can be arranged.',
  };
}

describe.skipIf(!LIVE)('reporting live smoke', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-reporting-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    'renders the deliverables with the live LLM and a fetch-grounded visa brief',
    async () => {
      const store = new FileStore(join(dir, 'runs'));
      const runDir = store.resolveRunDir('live-run');
      await store.writeJson(join(runDir, 'run-manifest.json'), manifest('live-run'), RunManifestSchema);
      await store.writeJson(
        join(runDir, 'catalog.json'),
        { schema_version: '1.0' as const, run_id: 'live-run', generated: '2026-05-19', program_count: 1, programs: [program()] } satisfies CatalogFile,
        CatalogFileSchema,
      );
      await store.writeJson(
        join(runDir, 'universe.json'),
        {
          schema_version: '1.0' as const,
          run_id: 'live-run',
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
        } satisfies UniverseFile,
        UniverseFileSchema,
      );
      await store.writeJson(
        join(runDir, 'results_scored.json'),
        {
          schema_version: '1.0' as const,
          run_id: 'live-run',
          generated: '2026-05-19',
          profile_hash: 'live',
          weighting: {
            profile: 'program-as-vehicle',
            weights: { funding: 35, location: 30, admission: 15, visa: 10, logistics: 10, academic: 0 },
            rationale: 'preset',
          },
          scored_count: 1,
          programs: [scoredProgram()],
        },
        ResultsScoredFileSchema,
      );
      const profile = emptyStudentProfile('2026-05-19');
      profile.identity.nationality = 'Uzbek';
      await store.writeJson(join(runDir, 'student-profile.json'), profile, StudentProfileSchema);

      const result = await buildReporting('live-run');

      expect(result.skipped).toBe(false);
      const report = await readFile(join(runDir, 'report', 'report.md'), 'utf-8');
      expect(report).toContain('## Per-country briefs');
      expect(report).toContain('## Coverage report');
      const csv = await readFile(join(runDir, 'report', 'spreadsheet.csv'), 'utf-8');
      expect(csv).toContain('Master of Engineering in Computer Science');
    },
    240_000,
  );
});
