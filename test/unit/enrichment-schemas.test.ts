import { describe, expect, it } from 'vitest';
import {
  ScholarshipFileSchema,
  ScholarshipRecordSchema,
  ScholarshipShardSchema,
  type ScholarshipRecord,
} from '../../src/core/types/scholarship-record.js';
import {
  StudentProfileSchema,
  emptyStudentProfile,
} from '../../src/core/types/student-profile.js';

describe('StudentProfileSchema', () => {
  it('emptyStudentProfile produces a schema-valid all-empty profile', () => {
    const profile = emptyStudentProfile('2026-05-19');
    expect(profile.identity.nationality).toBeNull();
    expect(profile.preferences.target_countries).toEqual([]);
    expect(profile.tests.gre.status).toBeNull();
    expect(() => StudentProfileSchema.parse(profile)).not.toThrow();
  });

  it('validates a minimal partial profile by filling defaults', () => {
    const parsed = StudentProfileSchema.parse({
      schema_version: '1.0',
      created: '2026-05-19',
      last_updated: '2026-05-19',
    });
    expect(parsed.identity.languages).toEqual([]);
    expect(parsed.real_goal.scoring_profile).toBeNull();
  });

  it('round-trips a seeded profile through JSON unchanged', () => {
    const profile = emptyStudentProfile('2026-05-19');
    profile.identity.nationality = 'Uzbek';
    profile.preferences.target_countries = ['US', 'UK'];
    const round = StudentProfileSchema.parse(JSON.parse(JSON.stringify(profile)));
    expect(round).toEqual(profile);
  });

  it('rejects an unknown scoring_profile', () => {
    const profile = emptyStudentProfile('2026-05-19');
    const bad = { ...profile, real_goal: { ...profile.real_goal, scoring_profile: 'invented' } };
    expect(StudentProfileSchema.safeParse(bad).success).toBe(false);
  });
});

function scholarship(): ScholarshipRecord {
  return {
    schema_version: '1.0',
    id: 'el_yurt_umidi_foundation_scholarship',
    name: 'El-Yurt Umidi Foundation Scholarship',
    funder: 'Government of Uzbekistan',
    funder_type: 'national-government',
    type: 'full',
    eligibility: {
      nationalities: ['Uzbek'],
      countries_of_study: ['US', 'UK', 'Canada'],
      degree_levels: ["Master's", 'PhD'],
      other_conditions: ['Uzbek citizen'],
    },
    value: { covers: ['tuition', 'living stipend'], amount_note: 'Full coverage' },
    application: {
      deadline: 'Annual cycle — verify at source',
      portal: 'https://eyuf.uz',
      linked_to_program_admission: false,
    },
    provenance: {
      source_urls: ['https://eyuf.uz'],
      last_verified: '2026-05-19',
      source_confidence: 'model-knowledge',
      verification_notes: 'Cycle must be web-verified before final output.',
    },
  };
}

describe('ScholarshipRecordSchema', () => {
  it('round-trips a full scholarship record', () => {
    const original = scholarship();
    expect(ScholarshipRecordSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('rejects an unknown funder_type', () => {
    const bad = { ...scholarship(), funder_type: 'crowdfunding' };
    expect(ScholarshipRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a shard and a merged file', () => {
    expect(() =>
      ScholarshipShardSchema.parse({
        schema_version: '1.0',
        run_id: 'r1',
        task_id: 'scholarships-US',
        generated: '2026-05-19',
        scholarships: [scholarship()],
      }),
    ).not.toThrow();
    expect(() =>
      ScholarshipFileSchema.parse({
        schema_version: '1.0',
        run_id: 'r1',
        generated: '2026-05-19',
        scholarship_count: 1,
        scholarships: [scholarship()],
      }),
    ).not.toThrow();
  });
});
