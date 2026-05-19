import { z } from 'zod';
import { CountryCodeSchema } from './registry.js';

/**
 * The program-record data contract (schemas/program-record.md). One graduate
 * program — the unit of the catalog. `catalog` creates each record with
 * `identity` + `institution_id` + a provenance stub; `enrichment` fills the
 * `requirements` / `logistics` / `cost_and_funding` / `outcomes` sections,
 * which are therefore `null` until then. The whole record is defined here (as
 * Phase 1 defined the whole RunManifest) so `enrichment` slots in unchanged.
 */

/** How confident a fact is — `model-knowledge` is excluded from final output (rules/02). */
export const SourceConfidenceSchema = z.enum(['web-verified', 'model-knowledge', 'community']);
export type SourceConfidence = z.infer<typeof SourceConfidenceSchema>;

/** Program identity — the stub `catalog` writes. Only `university`/`program` are required. */
export const ProgramIdentitySchema = z.object({
  university: z.string().min(1),
  program: z.string().min(1),
  department: z.string().nullable(),
  country: CountryCodeSchema,
  city: z.string().nullable(),
  /** Verbatim per institution — MS / MEng / MSc / PhD / etc. */
  degree_type: z.string().nullable(),
  language: z.string().nullable(),
  duration_months: z.number().int().positive().nullable(),
});
export type ProgramIdentity = z.infer<typeof ProgramIdentitySchema>;

/** Provenance — mandatory from record creation (rules/02-data-provenance.md). */
export const ProgramProvenanceSchema = z.object({
  source_urls: z.array(z.string()),
  /** Date the facts were confirmed against the source. */
  last_verified: z.string(),
  source_confidence: SourceConfidenceSchema,
  verification_notes: z.string().default(''),
});
export type ProgramProvenance = z.infer<typeof ProgramProvenanceSchema>;

// --- Enrichment sections: defined here, filled by the `enrichment` skill. ---

const MinGpaSchema = z.object({
  raw: z.string(),
  us_4_0_equivalent: z.number().nullable(),
});

const EnglishTestsSchema = z.object({
  ielts: z.string().nullable(),
  toefl: z.string().nullable(),
  /** Absence (null) means the Duolingo test is not accepted — a real distinction. */
  duolingo: z.string().nullable(),
  pte: z.string().nullable(),
});

const EnglishWaiverSchema = z.object({
  available: z.boolean(),
  basis: z.string(),
  confidence: SourceConfidenceSchema,
});

export const RequirementsSchema = z.object({
  min_gpa: MinGpaSchema.nullable(),
  required_background: z.string().nullable(),
  prerequisites: z.array(z.string()),
  gre: z.string().nullable(),
  english_tests: EnglishTestsSchema.nullable(),
  english_waiver: EnglishWaiverSchema.nullable(),
  reference_letters: z.number().int().nonnegative().nullable(),
  other_documents: z.array(z.string()),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const LogisticsSchema = z.object({
  application_deadlines: z.array(z.string()),
  intake_terms: z.array(z.string()),
  application_fee: z.string().nullable(),
  application_portal: z.string().nullable(),
  decision_timeline: z.string().nullable(),
});
export type Logistics = z.infer<typeof LogisticsSchema>;

const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
  period: z.string(),
});

/** Whether a funded path exists — feeds the funding scoring dimension. */
export const FundingLikelihoodSchema = z.enum(['full', 'partial', 'none', 'unknown']);
export type FundingLikelihood = z.infer<typeof FundingLikelihoodSchema>;

export const CostAndFundingSchema = z.object({
  tuition_international: MoneySchema.nullable(),
  living_cost_estimate: MoneySchema.nullable(),
  scholarships_for_internationals: z.array(z.string()),
  funding_likelihood: FundingLikelihoodSchema,
  fully_funded: z.boolean(),
});
export type CostAndFunding = z.infer<typeof CostAndFundingSchema>;

export const OutcomesSchema = z.object({
  field_ranking: z.string().nullable(),
  post_study_work_rights: z.string().nullable(),
  placement_info: z.string().nullable(),
});
export type Outcomes = z.infer<typeof OutcomesSchema>;

/** One graduate program — see schemas/program-record.md. */
export const ProgramRecordSchema = z.object({
  schema_version: z.literal('1.0'),
  /** Stable id `<institution_id>_<slug(program)>`. */
  id: z.string().min(1),
  institution_id: z.string().min(1),
  identity: ProgramIdentitySchema,
  /** Enrichment sections — null until the `enrichment` skill fills them. */
  requirements: RequirementsSchema.nullable(),
  logistics: LogisticsSchema.nullable(),
  cost_and_funding: CostAndFundingSchema.nullable(),
  outcomes: OutcomesSchema.nullable(),
  provenance: ProgramProvenanceSchema,
});
export type ProgramRecord = z.infer<typeof ProgramRecordSchema>;

/** One worker-batch shard written to `catalog/<batch-id>.json`. */
export const CatalogShardSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  batch_id: z.string().min(1),
  generated: z.string(),
  programs: z.array(ProgramRecordSchema),
});
export type CatalogShard = z.infer<typeof CatalogShardSchema>;

/** The merged, deduplicated `catalog.json`. */
export const CatalogFileSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  generated: z.string(),
  program_count: z.number().int().nonnegative(),
  programs: z.array(ProgramRecordSchema),
});
export type CatalogFile = z.infer<typeof CatalogFileSchema>;
