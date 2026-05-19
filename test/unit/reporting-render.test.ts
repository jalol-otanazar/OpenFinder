import { describe, expect, it } from 'vitest';
import { renderShortlist, renderSpreadsheet } from '../../src/reporting/render.js';
import type { ProgramRecord } from '../../src/core/types/program-record.js';
import type { RecommendationTier, ScoredProgram } from '../../src/core/types/scored-program.js';

function scored(
  id: string,
  tier: RecommendationTier,
  total: number,
  verdict: ScoredProgram['eligibility']['verdict'] = 'PASS',
): ScoredProgram {
  return {
    program_id: id,
    institution_id: 'us_alpha',
    identity: { university: 'Alpha University', program: `Program ${id}`, country: 'US', degree_type: 'MSc' },
    eligibility: { verdict, reasoning: verdict === 'FAIL' ? 'GPA below minimum' : 'ok', must_confirm: [] },
    admission_chance: { bucket: 'Match', reasoning: 'ok' },
    academic_fit: { score: 4, reasoning: 'ok' },
    funding_fit: { score: 3, reasoning: 'ok' },
    location_fit: { score: 3, reasoning: 'ok' },
    visa: { score: 4, reasoning: 'ok' },
    logistics: { score: 4, reasoning: 'ok' },
    weighted_total: total,
    recommendation_tier: tier,
    summary: 'A summary, with a comma and "quotes" inside.',
  };
}

function catalogProgram(id: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id,
    institution_id: 'us_alpha',
    identity: {
      university: 'Alpha University',
      program: `Program ${id}`,
      department: null,
      country: 'US',
      city: null,
      degree_type: 'MSc',
      language: null,
      duration_months: null,
    },
    requirements: {
      min_gpa: null,
      required_background: null,
      prerequisites: [],
      gre: null,
      english_tests: { ielts: '6.5', toefl: null, duolingo: null, pte: null },
      english_waiver: null,
      reference_letters: null,
      other_documents: [],
    },
    logistics: {
      application_deadlines: ['2027-01-15'],
      intake_terms: [],
      application_fee: null,
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: {
      tuition_international: { amount: 40000, currency: 'USD', period: 'year' },
      living_cost_estimate: null,
      scholarships_for_internationals: [],
      funding_likelihood: 'partial',
      fully_funded: false,
    },
    outcomes: { field_ranking: null, post_study_work_rights: null, placement_info: null },
    provenance: { source_urls: [], last_verified: '2026-05-19', source_confidence: 'web-verified', verification_notes: '' },
  };
}

describe('renderSpreadsheet', () => {
  it('writes a header row and one CSV row per program, escaping commas and quotes', () => {
    const csv = renderSpreadsheet([scored('p1', 'Apply', 55)], [catalogProgram('p1')]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toContain('Program,University,Country');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"A summary, with a comma and ""quotes"" inside."');
    expect(lines[1]).toContain('40000 USD/year');
    expect(lines[1]).toContain('IELTS 6.5');
  });

  it('keeps an ineligible program in the sheet, flagged with the reason', () => {
    const csv = renderSpreadsheet([scored('p1', 'Do Not Apply', 12, 'FAIL')], [catalogProgram('p1')]);
    expect(csv).toContain('FAIL');
    expect(csv).toContain('GPA below minimum');
  });
});

describe('renderShortlist', () => {
  it('groups programs by tier and excludes Do Not Apply', () => {
    const md = renderShortlist([
      scored('p1', 'Priority', 80),
      scored('p2', 'Apply', 55),
      scored('p3', 'Do Not Apply', 10),
    ]);
    expect(md).toContain('### Priority (1)');
    expect(md).toContain('### Apply (1)');
    expect(md).not.toContain('### Do Not Apply');
    expect(md).toContain('_Next:_');
  });

  it('handles an empty shortlist gracefully', () => {
    const md = renderShortlist([scored('p1', 'Do Not Apply', 5)]);
    expect(md).toContain('No programs reached');
  });
});
