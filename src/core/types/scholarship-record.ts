import { z } from 'zod';
import { ProgramProvenanceSchema } from './program-record.js';

/**
 * The scholarship-record contract (schemas/scholarship-record.md). A funding
 * source — government, university, or third-party. Scholarships are SEPARATE
 * entities from programs: one scheme can fund a student at many institutions,
 * and eligibility is nationality-gated independently of any program. Written by
 * `enrichment`'s scholarship pass; consumed by `scoring` (funding dimension).
 */

export const FunderTypeSchema = z.enum([
  'national-government',
  'university',
  'intergovernmental',
  'private',
  'research-council',
]);
export type FunderType = z.infer<typeof FunderTypeSchema>;

export const ScholarshipTypeSchema = z.enum(['full', 'partial', 'tuition-only', 'fee-discount']);
export type ScholarshipType = z.infer<typeof ScholarshipTypeSchema>;

export const ScholarshipEligibilitySchema = z.object({
  /** The single most common disqualifier — matched against the student's nationality. */
  nationalities: z.array(z.string()).default([]),
  countries_of_study: z.array(z.string()).default([]),
  degree_levels: z.array(z.string()).default([]),
  other_conditions: z.array(z.string()).default([]),
});

export const ScholarshipValueSchema = z.object({
  covers: z.array(z.string()).default([]),
  amount_note: z.string().nullable().default(null),
});

export const ScholarshipApplicationSchema = z.object({
  deadline: z.string().nullable().default(null),
  portal: z.string().nullable().default(null),
  /** If true, awarded with the offer; if false, a separate application/timeline. */
  linked_to_program_admission: z.boolean().nullable().default(null),
});

/** One scholarship — see schemas/scholarship-record.md. */
export const ScholarshipRecordSchema = z.object({
  schema_version: z.literal('1.0'),
  /** Stable slug of the name. */
  id: z.string().min(1),
  name: z.string().min(1),
  funder: z.string(),
  funder_type: FunderTypeSchema,
  type: ScholarshipTypeSchema,
  eligibility: ScholarshipEligibilitySchema,
  value: ScholarshipValueSchema,
  application: ScholarshipApplicationSchema,
  provenance: ProgramProvenanceSchema,
});
export type ScholarshipRecord = z.infer<typeof ScholarshipRecordSchema>;

/** One scholarship-pass shard written to `scholarships/<task-id>.json`. */
export const ScholarshipShardSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  generated: z.string(),
  scholarships: z.array(ScholarshipRecordSchema),
});
export type ScholarshipShard = z.infer<typeof ScholarshipShardSchema>;

/** The merged, deduplicated `scholarships.json`. */
export const ScholarshipFileSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  generated: z.string(),
  scholarship_count: z.number().int().nonnegative(),
  scholarships: z.array(ScholarshipRecordSchema),
});
export type ScholarshipFile = z.infer<typeof ScholarshipFileSchema>;
