import { describe, expect, it } from 'vitest';
import {
  ResultsScoredFileSchema,
  ScoredProgramSchema,
  ScoringShardSchema,
  type ScoredProgram,
} from '../../src/core/types/scored-program.js';

function scored(): ScoredProgram {
  return {
    program_id: 'uk_sheffield_msc_ai',
    institution_id: 'uk_university_of_sheffield',
    identity: {
      university: 'University of Sheffield',
      program: 'MSc in Artificial Intelligence',
      country: 'UK',
      degree_type: 'MSc',
    },
    eligibility: { verdict: 'PASS', reasoning: 'Meets the GPA and English bar.', must_confirm: [] },
    admission_chance: { bucket: 'Match', reasoning: 'Profile is near the typical cohort.' },
    academic_fit: { score: 4, reasoning: 'Strong CS coursework alignment.' },
    funding_fit: { score: 2, reasoning: 'Partial scholarship only.' },
    location_fit: { score: 3, reasoning: 'UK fallback location.' },
    visa: { score: 4, reasoning: 'Graduate Route gives two years of work rights.' },
    logistics: { score: 4, reasoning: 'Documents are assemblable before the deadline.' },
    weighted_total: 61.5,
    recommendation_tier: 'Apply',
    summary: 'A solid match for your CS background. Funding is the weak point to plan around.',
  };
}

describe('ScoredProgramSchema', () => {
  it('round-trips a full scorecard through JSON', () => {
    const original = scored();
    expect(ScoredProgramSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('rejects a dimension score outside 0–5', () => {
    const bad = { ...scored(), academic_fit: { score: 7, reasoning: 'x' } };
    expect(ScoredProgramSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown recommendation tier', () => {
    const bad = { ...scored(), recommendation_tier: 'Maybe' };
    expect(ScoredProgramSchema.safeParse(bad).success).toBe(false);
  });

  it('defaults must_confirm to an empty array', () => {
    const r = scored();
    const eligibility = { verdict: r.eligibility.verdict, reasoning: r.eligibility.reasoning };
    const parsed = ScoredProgramSchema.parse({ ...r, eligibility });
    expect(parsed.eligibility.must_confirm).toEqual([]);
  });
});

describe('ScoringShardSchema / ResultsScoredFileSchema', () => {
  it('accepts a shard of scored programs', () => {
    expect(() =>
      ScoringShardSchema.parse({
        schema_version: '1.0',
        run_id: 'r1',
        batch_id: 'scoring-UK-001',
        generated: '2026-05-19',
        programs: [scored()],
      }),
    ).not.toThrow();
  });

  it('accepts a merged results file with weighting metadata', () => {
    expect(() =>
      ResultsScoredFileSchema.parse({
        schema_version: '1.0',
        run_id: 'r1',
        generated: '2026-05-19',
        profile_hash: 'abc123',
        weighting: {
          profile: 'program-as-vehicle',
          weights: { funding: 35, location: 30, admission: 15, visa: 10, logistics: 10, academic: 0 },
          rationale: 'Goal preset, no custom notes.',
        },
        scored_count: 1,
        programs: [scored()],
      }),
    ).not.toThrow();
  });
});
