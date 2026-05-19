import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmScoringWorker, type ScoringBatch } from '../../src/scoring/worker.js';
import { presetFor } from '../../src/scoring/weighting.js';
import { ScoringShardSchema, type WeightSet } from '../../src/core/types/scored-program.js';
import type { ProgramRecord } from '../../src/core/types/program-record.js';
import { emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm } from '../helpers/catalog-stubs.js';

const CARD = {
  eligibility: { verdict: 'PASS', reasoning: 'Meets the GPA and English bar.', must_confirm: [] },
  admission_chance: { bucket: 'Match', reasoning: 'Profile is near the typical cohort.' },
  academic_fit: { score: 4, reasoning: 'Strong CS coursework.' },
  funding_fit: { score: 5, reasoning: 'Fully funded.' },
  location_fit: { score: 5, reasoning: 'Bay Area — the goal location.' },
  visa: { score: 5, reasoning: 'F-1 with STEM OPT.' },
  logistics: { score: 4, reasoning: 'Documents are assemblable in time.' },
  summary: 'A strong match for your goal. Apply early for funding.',
};

function enrichedProgram(id: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id,
    institution_id: 'us_alpha_university',
    identity: {
      university: 'Alpha University',
      program: 'MSc Computer Science',
      department: 'CS',
      country: 'US',
      city: 'Alphatown',
      degree_type: 'MSc',
      language: 'English',
      duration_months: 12,
    },
    requirements: {
      min_gpa: { raw: '3.0', us_4_0_equivalent: 3.0 },
      required_background: 'CS',
      prerequisites: [],
      gre: 'optional',
      english_tests: null,
      english_waiver: null,
      reference_letters: 2,
      other_documents: [],
    },
    logistics: {
      application_deadlines: ['2027-01-15'],
      intake_terms: ['Fall'],
      application_fee: null,
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: {
      tuition_international: null,
      living_cost_estimate: null,
      scholarships_for_internationals: [],
      funding_likelihood: 'partial',
      fully_funded: false,
    },
    outcomes: { field_ranking: null, post_study_work_rights: null, placement_info: null },
    provenance: {
      source_urls: ['https://alpha.edu'],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: '',
    },
  };
}

describe('LlmScoringWorker', () => {
  let dir: string;
  let store: FileStore;
  const weights: WeightSet = presetFor('program-as-vehicle').weights;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-scoring-worker-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function batch(programs: ProgramRecord[], budget = 25): ScoringBatch {
    return {
      runId: 'r1',
      batchId: 'scoring-US-001',
      country: 'US',
      programs,
      profile: emptyStudentProfile('2026-05-19'),
      scholarships: [],
      weights,
      llmCallBudget: budget,
      shardPath: join(dir, 'scoring', 'scoring-US-001.json'),
    };
  }

  it('scores a program and computes the weighted total + tier deterministically', async () => {
    const worker = new LlmScoringWorker({ llm: new StubLlm(() => JSON.stringify(CARD)), store });
    const result = await worker.run(batch([enrichedProgram('us_alpha_university_cs')]));

    expect(result.programIds).toEqual(['us_alpha_university_cs']);
    expect(result.llmCallsUsed).toBe(1);

    const shard = await store.readJson(result.shardPath, ScoringShardSchema);
    const card = shard.programs[0]!;
    // program-as-vehicle: funding35*1 + location30*1 + admission15*(3/5) + visa10*1 + logistics10*(4/5) + academic0
    expect(card.weighted_total).toBe(92);
    expect(card.recommendation_tier).toBe('Priority');
    expect(card.eligibility.verdict).toBe('PASS');
    expect(card.funding_fit.score).toBe(5);
    expect(card.identity.university).toBe('Alpha University');
  });

  it('coerces a partial scorecard into a valid record with safe defaults', async () => {
    const worker = new LlmScoringWorker({
      llm: new StubLlm(() => JSON.stringify({ academic_fit: { score: 3 } })),
      store,
    });
    const result = await worker.run(batch([enrichedProgram('us_alpha_university_cs')]));
    const shard = await store.readJson(result.shardPath, ScoringShardSchema);
    const card = shard.programs[0]!;
    expect(card.eligibility.verdict).toBe('UNCERTAIN');
    expect(card.admission_chance.bucket).toBe('Reach');
    expect(card.funding_fit.score).toBe(0);
  });

  it('never recommends a program that fails eligibility', async () => {
    const failCard = { ...CARD, eligibility: { verdict: 'FAIL', reasoning: 'GPA below the minimum.' } };
    const worker = new LlmScoringWorker({ llm: new StubLlm(() => JSON.stringify(failCard)), store });
    const result = await worker.run(batch([enrichedProgram('us_alpha_university_cs')]));
    const shard = await store.readJson(result.shardPath, ScoringShardSchema);
    expect(shard.programs[0]!.recommendation_tier).toBe('Do Not Apply');
  });

  it('stops at the LLM-call budget and defers the rest of the batch', async () => {
    const worker = new LlmScoringWorker({ llm: new StubLlm(() => JSON.stringify(CARD)), store });
    const result = await worker.run(
      batch([enrichedProgram('us_alpha_university_cs'), enrichedProgram('us_alpha_university_ml')], 1),
    );
    expect(result.programIds).toHaveLength(1);
    expect(result.budgetExhausted).toBe(true);
  });
});
