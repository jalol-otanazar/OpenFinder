import { z } from 'zod';

/**
 * The student profile contract (schemas/student-profile.md) — the durable,
 * on-disk source of truth for everything personal. It is the `intake` skill's
 * output. Every field is nullable / defaulted: FInder works on partial data,
 * and a re-run of `intake` updates the profile in place. `scoring` reads
 * `identity.nationality` (visa dimension) and `financial` (funding dimension);
 * `enrichment`'s scholarship pass reads `identity.nationality`.
 */

export const StudentIdentitySchema = z.object({
  /** Drives the visa & immigration scoring dimension and home-country scholarships. */
  nationality: z.string().nullable().default(null),
  country_of_residence: z.string().nullable().default(null),
  languages: z.array(z.string()).default([]),
});

export const StudentAcademicsSchema = z.object({
  institution: z.string().nullable().default(null),
  degree: z.string().nullable().default(null),
  year_status: z.string().nullable().default(null),
  expected_graduation: z.string().nullable().default(null),
  gpa_raw: z.string().nullable().default(null),
  gpa_us_4_0: z.number().nullable().default(null),
  gpa_notes: z.string().nullable().default(null),
  instruction_language: z.string().nullable().default(null),
  key_coursework: z.array(z.string()).default([]),
});

export const GreTestSchema = z.object({
  status: z.string().nullable().default(null),
  score: z.string().nullable().default(null),
  planned_date: z.string().nullable().default(null),
});

export const EnglishTestSchema = z.object({
  status: z.string().nullable().default(null),
  test_type: z.string().nullable().default(null),
  score: z.string().nullable().default(null),
  target: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export const StudentTestsSchema = z.object({
  gre: GreTestSchema.default({}),
  english: EnglishTestSchema.default({}),
  other: z.array(z.string()).default([]),
});

export const StudentExperienceSchema = z.object({
  research_publications: z.string().nullable().default(null),
  internships: z.string().nullable().default(null),
  projects: z.string().nullable().default(null),
  achievements: z.array(z.string()).default([]),
});

export const StudentReferencesSchema = z.object({
  count_confirmed: z.number().int().nonnegative().nullable().default(null),
  potential_sources: z.array(z.string()).default([]),
  self_assessed_strength: z.string().nullable().default(null),
});

/** How much funding the student needs — gates the funding scoring dimension. */
export const FundingNeedSchema = z.enum(['fully_funded', 'partial_ok', 'self_fund']);

export const StudentFinancialSchema = z.object({
  budget: z.string().nullable().default(null),
  funding_need: FundingNeedSchema.nullable().default(null),
  proof_of_funds_capacity: z.string().nullable().default(null),
  external_scholarships: z.array(z.string()).default([]),
});

export const StudentPreferencesSchema = z.object({
  target_countries: z.array(z.string()).default([]),
  target_intake: z.string().nullable().default(null),
  fields: z.array(z.string()).default([]),
  program_types_acceptable: z.array(z.string()).default([]),
  language_of_instruction: z.string().nullable().default(null),
  location_priority: z.string().nullable().default(null),
  deal_breakers: z.array(z.string()).default([]),
});

/** Goal preset that selects scoring weights (docs/scoring-model.md). */
export const ScoringProfileSchema = z.enum([
  'phd-academia',
  'immigrate-settle',
  'program-as-vehicle',
  'cheapest-fastest',
]);

export const RealGoalSchema = z.object({
  primary: z.string().nullable().default(null),
  degree_role: z.string().nullable().default(null),
  post_graduation_intent: z.string().nullable().default(null),
  scoring_profile: ScoringProfileSchema.nullable().default(null),
});

/** The complete `student-profile.json` document. */
export const StudentProfileSchema = z.object({
  schema_version: z.literal('1.0'),
  created: z.string(),
  last_updated: z.string(),
  identity: StudentIdentitySchema.default({}),
  academics: StudentAcademicsSchema.default({}),
  tests: StudentTestsSchema.default({}),
  experience: StudentExperienceSchema.default({}),
  references: StudentReferencesSchema.default({}),
  financial: StudentFinancialSchema.default({}),
  preferences: StudentPreferencesSchema.default({}),
  real_goal: RealGoalSchema.default({}),
  custom_notes: z.array(z.string()).default([]),
});
export type StudentProfile = z.infer<typeof StudentProfileSchema>;

/** A fresh, all-empty profile for a given date — the base `intake` seeds onto. */
export function emptyStudentProfile(date: string): StudentProfile {
  return StudentProfileSchema.parse({
    schema_version: '1.0',
    created: date,
    last_updated: date,
  });
}
