import type {
  AdmissionBucket,
  EligibilityVerdict,
  RecommendationTier,
  WeightSet,
} from '../core/types/scored-program.js';

/**
 * The deterministic weighting machinery (docs/scoring-model.md). The LLM scores
 * the seven dimensions; this module turns those scores into a goal-weighted
 * 0–100 total and a recommendation tier — pure arithmetic, so the ranking math
 * is honest and reproducible (rule 04).
 */

/** Goal-weighting presets — each row sums to 100. */
const PRESETS: Record<string, WeightSet> = {
  'phd-academia': { funding: 25, location: 5, admission: 15, visa: 10, logistics: 10, academic: 35 },
  'immigrate-settle': { funding: 20, location: 30, admission: 15, visa: 25, logistics: 10, academic: 0 },
  'program-as-vehicle': { funding: 35, location: 30, admission: 15, visa: 10, logistics: 10, academic: 0 },
  'cheapest-fastest': { funding: 35, location: 10, admission: 25, visa: 10, logistics: 20, academic: 0 },
};

/** Applied when the profile sets no `scoring_profile` (no `intake` yet). */
const BALANCED_DEFAULT: WeightSet = {
  funding: 20,
  location: 20,
  admission: 20,
  visa: 15,
  logistics: 15,
  academic: 10,
};
const BALANCED_NAME = 'balanced-default';

/** The known preset names — used to validate the CLI `--weighting` flag. */
export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS);

export interface SelectedPreset {
  name: string;
  weights: WeightSet;
}

/** Pick the preset: an explicit override, else the profile's, else balanced. */
export function presetFor(scoringProfile: string | null, override?: string): SelectedPreset {
  const pick = (override ?? scoringProfile ?? '').trim();
  const weights = PRESETS[pick];
  if (weights) return { name: pick, weights: { ...weights } };
  return { name: BALANCED_NAME, weights: { ...BALANCED_DEFAULT } };
}

/** Re-scale a weight set so its six dimensions sum to 100. */
export function normalizeWeights(weights: WeightSet): WeightSet {
  const sum =
    weights.funding +
    weights.location +
    weights.admission +
    weights.visa +
    weights.logistics +
    weights.academic;
  if (sum <= 0) return { ...BALANCED_DEFAULT };
  const scale = 100 / sum;
  return {
    funding: round1(weights.funding * scale),
    location: round1(weights.location * scale),
    admission: round1(weights.admission * scale),
    visa: round1(weights.visa * scale),
    logistics: round1(weights.logistics * scale),
    academic: round1(weights.academic * scale),
  };
}

/** Admission bucket → a 0–5 value, so it can join the weighted total. */
export function admissionScore(bucket: AdmissionBucket): number {
  if (bucket === 'Safety') return 5;
  if (bucket === 'Match') return 3;
  return 1; // Reach
}

/** The six 0–5 dimension values that feed the weighted total. */
export interface DimensionInputs {
  funding: number;
  location: number;
  admission: number;
  visa: number;
  logistics: number;
  academic: number;
}

/** The goal-weighted 0–100 total. */
export function weightedTotal(dims: DimensionInputs, weights: WeightSet): number {
  const total =
    weights.funding * (dims.funding / 5) +
    weights.location * (dims.location / 5) +
    weights.admission * (dims.admission / 5) +
    weights.visa * (dims.visa / 5) +
    weights.logistics * (dims.logistics / 5) +
    weights.academic * (dims.academic / 5);
  return clamp(round1(total), 0, 100);
}

/** Tier from the eligibility gate + weighted total — a `FAIL` is never recommended. */
export function recommendationTier(verdict: EligibilityVerdict, total: number): RecommendationTier {
  if (verdict === 'FAIL') return 'Do Not Apply';
  if (total >= 70) return 'Priority';
  if (total >= 50) return 'Apply';
  if (total >= 30) return 'Backup';
  return 'Do Not Apply';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
