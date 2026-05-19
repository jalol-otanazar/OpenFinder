import { z } from 'zod';
import { CountryCodeSchema } from './registry.js';

/**
 * The scored-program contract (skills/scoring.skill.md, docs/scoring-model.md).
 * The `scoring` skill turns the profile-agnostic catalog into a per-student
 * ranked assessment: every program gets a 7-dimension scorecard, a weighted
 * total, and a recommendation tier, written to `results_scored.json`.
 */

/** Eligibility hard gate — `UNCERTAIN` when data is incomplete (rule 04.3). */
export const EligibilityVerdictSchema = z.enum(['PASS', 'FAIL', 'UNCERTAIN']);
export type EligibilityVerdict = z.infer<typeof EligibilityVerdictSchema>;

/** Admission chance — buckets, never fake percentages (rule 04.2). */
export const AdmissionBucketSchema = z.enum(['Reach', 'Match', 'Safety']);
export type AdmissionBucket = z.infer<typeof AdmissionBucketSchema>;

export const RecommendationTierSchema = z.enum(['Priority', 'Apply', 'Backup', 'Do Not Apply']);
export type RecommendationTier = z.infer<typeof RecommendationTierSchema>;

/** One 0–5 dimension score with its written reasoning. */
export const DimensionScoreSchema = z.object({
  score: z.number().int().min(0).max(5),
  reasoning: z.string(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

/** Minimal program identity snapshot — lets reporting read this file standalone. */
export const ScoredIdentitySchema = z.object({
  university: z.string(),
  program: z.string(),
  country: CountryCodeSchema,
  degree_type: z.string().nullable(),
});

export const EligibilityScoreSchema = z.object({
  verdict: EligibilityVerdictSchema,
  reasoning: z.string(),
  /** What the student must confirm — populated for `UNCERTAIN`. */
  must_confirm: z.array(z.string()).default([]),
});

export const AdmissionScoreSchema = z.object({
  bucket: AdmissionBucketSchema,
  reasoning: z.string(),
});

/** One program scored against one student — see docs/scoring-model.md. */
export const ScoredProgramSchema = z.object({
  program_id: z.string().min(1),
  institution_id: z.string().min(1),
  identity: ScoredIdentitySchema,
  eligibility: EligibilityScoreSchema,
  admission_chance: AdmissionScoreSchema,
  academic_fit: DimensionScoreSchema,
  funding_fit: DimensionScoreSchema,
  location_fit: DimensionScoreSchema,
  visa: DimensionScoreSchema,
  logistics: DimensionScoreSchema,
  /** Goal-weighted 0–100 total — computed by FInder code, not the LLM. */
  weighted_total: z.number().min(0).max(100),
  recommendation_tier: RecommendationTierSchema,
  /** Two-sentence plain-language summary addressed to the student. */
  summary: z.string(),
});
export type ScoredProgram = z.infer<typeof ScoredProgramSchema>;

/** The six goal-weighting dimensions (docs/scoring-model.md preset table). */
export const WeightSetSchema = z.object({
  funding: z.number().min(0),
  location: z.number().min(0),
  admission: z.number().min(0),
  visa: z.number().min(0),
  logistics: z.number().min(0),
  academic: z.number().min(0),
});
export type WeightSet = z.infer<typeof WeightSetSchema>;

/** The weighting actually applied to this run, recorded for transparency. */
export const ScoringWeightingSchema = z.object({
  /** Preset name, or `balanced-default` when the profile sets no scoring_profile. */
  profile: z.string(),
  weights: WeightSetSchema,
  rationale: z.string(),
});
export type ScoringWeighting = z.infer<typeof ScoringWeightingSchema>;

/** One worker-batch shard written to `scoring/<batch-id>.json`. */
export const ScoringShardSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  batch_id: z.string().min(1),
  generated: z.string(),
  programs: z.array(ScoredProgramSchema),
});
export type ScoringShard = z.infer<typeof ScoringShardSchema>;

/** The merged `results_scored.json`, sorted by `weighted_total` descending. */
export const ResultsScoredFileSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  generated: z.string(),
  /** Hash of the profile this scoring used — a change forces a full re-score. */
  profile_hash: z.string(),
  weighting: ScoringWeightingSchema,
  scored_count: z.number().int().nonnegative(),
  programs: z.array(ScoredProgramSchema),
});
export type ResultsScoredFile = z.infer<typeof ResultsScoredFileSchema>;
