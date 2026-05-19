import { describe, expect, it } from 'vitest';
import {
  PRESET_NAMES,
  admissionScore,
  normalizeWeights,
  presetFor,
  recommendationTier,
  weightedTotal,
} from '../../src/scoring/weighting.js';

describe('presetFor', () => {
  it('selects a known preset by name', () => {
    expect(presetFor('phd-academia').name).toBe('phd-academia');
    expect(presetFor('phd-academia').weights.academic).toBe(35);
  });

  it('lets an override win over the profile preset', () => {
    expect(presetFor('phd-academia', 'cheapest-fastest').name).toBe('cheapest-fastest');
  });

  it('falls back to balanced-default for null / unknown', () => {
    expect(presetFor(null).name).toBe('balanced-default');
    expect(presetFor('made-up').name).toBe('balanced-default');
  });

  it('exposes the known preset names', () => {
    expect(PRESET_NAMES).toContain('immigrate-settle');
    expect(PRESET_NAMES).toHaveLength(4);
  });
});

describe('normalizeWeights', () => {
  it('rescales so the six dimensions sum to 100', () => {
    const w = normalizeWeights({
      funding: 1,
      location: 1,
      admission: 1,
      visa: 1,
      logistics: 1,
      academic: 1,
    });
    const sum = w.funding + w.location + w.admission + w.visa + w.logistics + w.academic;
    expect(sum).toBeCloseTo(100, 0); // 1-decimal rounding can drift sub-1 from 100
  });

  it('returns a balanced default when all weights are zero', () => {
    const w = normalizeWeights({
      funding: 0,
      location: 0,
      admission: 0,
      visa: 0,
      logistics: 0,
      academic: 0,
    });
    expect(w.funding).toBeGreaterThan(0);
  });
});

describe('admissionScore', () => {
  it('maps buckets to 0–5 values', () => {
    expect(admissionScore('Safety')).toBe(5);
    expect(admissionScore('Match')).toBe(3);
    expect(admissionScore('Reach')).toBe(1);
  });
});

describe('weightedTotal', () => {
  const weights = presetFor('program-as-vehicle').weights;

  it('is 100 when every dimension is maxed', () => {
    expect(
      weightedTotal(
        { funding: 5, location: 5, admission: 5, visa: 5, logistics: 5, academic: 5 },
        weights,
      ),
    ).toBe(100);
  });

  it('is 0 when every dimension is zero', () => {
    expect(
      weightedTotal(
        { funding: 0, location: 0, admission: 0, visa: 0, logistics: 0, academic: 0 },
        weights,
      ),
    ).toBe(0);
  });

  it('weights a single maxed dimension by its share', () => {
    // program-as-vehicle gives funding 35% of the weight.
    expect(
      weightedTotal(
        { funding: 5, location: 0, admission: 0, visa: 0, logistics: 0, academic: 0 },
        weights,
      ),
    ).toBe(35);
  });
});

describe('recommendationTier', () => {
  it('never recommends an ineligible program', () => {
    expect(recommendationTier('FAIL', 95)).toBe('Do Not Apply');
  });

  it('bands an eligible program by its weighted total', () => {
    expect(recommendationTier('PASS', 75)).toBe('Priority');
    expect(recommendationTier('PASS', 55)).toBe('Apply');
    expect(recommendationTier('PASS', 35)).toBe('Backup');
    expect(recommendationTier('PASS', 10)).toBe('Do Not Apply');
    expect(recommendationTier('UNCERTAIN', 72)).toBe('Priority');
  });
});
