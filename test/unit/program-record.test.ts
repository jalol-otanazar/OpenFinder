import { describe, expect, it } from 'vitest';
import {
  CatalogFileSchema,
  CatalogShardSchema,
  ProgramRecordSchema,
  type ProgramRecord,
} from '../../src/core/types/program-record.js';

/** A catalog-stage stub: identity + provenance, enrichment sections still null. */
function stubRecord(): ProgramRecord {
  return {
    schema_version: '1.0',
    id: 'uk_university_of_sheffield_msc_in_artificial_intelligence',
    institution_id: 'uk_university_of_sheffield',
    identity: {
      university: 'University of Sheffield',
      program: 'MSc in Artificial Intelligence',
      department: 'Department of Computer Science',
      country: 'UK',
      city: 'Sheffield',
      degree_type: 'MSc',
      language: 'English',
      duration_months: 12,
    },
    requirements: null,
    logistics: null,
    cost_and_funding: null,
    outcomes: null,
    provenance: {
      source_urls: ['https://www.sheffield.ac.uk/postgraduate/taught/courses'],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: 'Fetched from the official postgraduate catalog.',
    },
  };
}

describe('ProgramRecordSchema', () => {
  it('accepts a catalog-stage stub with null enrichment sections', () => {
    const parsed = ProgramRecordSchema.parse(stubRecord());
    expect(parsed.requirements).toBeNull();
    expect(parsed.identity.program).toBe('MSc in Artificial Intelligence');
  });

  it('round-trips through JSON unchanged', () => {
    const original = stubRecord();
    const round = ProgramRecordSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(round).toEqual(original);
  });

  it('accepts a fully enriched record', () => {
    const enriched: ProgramRecord = {
      ...stubRecord(),
      requirements: {
        min_gpa: { raw: '2:2 UK honours', us_4_0_equivalent: 2.7 },
        required_background: 'CS / Math / Engineering',
        prerequisites: ['programming'],
        gre: 'not_required',
        english_tests: { ielts: '6.5', toefl: '88', duolingo: '120', pte: '61' },
        english_waiver: { available: true, basis: 'EMI', confidence: 'web-verified' },
        reference_letters: 2,
        other_documents: ['CV'],
      },
      logistics: {
        application_deadlines: ['2027-05'],
        intake_terms: ['September'],
        application_fee: '0 GBP',
        application_portal: 'https://example.edu/apply',
        decision_timeline: '4-8 weeks',
      },
      cost_and_funding: {
        tuition_international: { amount: 26590, currency: 'GBP', period: 'year' },
        living_cost_estimate: null,
        scholarships_for_internationals: [],
        funding_likelihood: 'partial',
        fully_funded: false,
      },
      outcomes: {
        field_ranking: 'Top 15 UK',
        post_study_work_rights: 'Graduate Route — 2 years',
        placement_info: null,
      },
    };
    expect(() => ProgramRecordSchema.parse(enriched)).not.toThrow();
  });

  it('rejects a record missing the required program name', () => {
    const bad = stubRecord();
    (bad.identity as { program?: string }).program = '';
    expect(ProgramRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('defaults verification_notes to an empty string', () => {
    const r = stubRecord();
    const provenance = {
      source_urls: r.provenance.source_urls,
      last_verified: r.provenance.last_verified,
      source_confidence: r.provenance.source_confidence,
    };
    const parsed = ProgramRecordSchema.parse({ ...r, provenance });
    expect(parsed.provenance.verification_notes).toBe('');
  });
});

describe('CatalogShardSchema / CatalogFileSchema', () => {
  it('accepts a shard of stub records', () => {
    const shard = {
      schema_version: '1.0' as const,
      run_id: 'r1',
      batch_id: 'catalog-UK-001',
      generated: '2026-05-19',
      programs: [stubRecord()],
    };
    expect(() => CatalogShardSchema.parse(shard)).not.toThrow();
  });

  it('accepts a merged catalog file with a program count', () => {
    const file = {
      schema_version: '1.0' as const,
      run_id: 'r1',
      generated: '2026-05-19',
      program_count: 1,
      programs: [stubRecord()],
    };
    expect(() => CatalogFileSchema.parse(file)).not.toThrow();
  });
});
