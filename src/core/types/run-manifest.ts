import { z } from 'zod';
import { CountryCodeSchema } from './registry.js';

/** Per-stage lifecycle state. */
export const StageStatusSchema = z.enum(['pending', 'in-progress', 'complete', 'failed']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/** The frozen definition of a run. */
export const RunScopeSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  countries: z.array(CountryCodeSchema).min(1),
  /** Intended intake term, e.g. "Fall 2027". */
  intake: z.string(),
  /** Path to the profile this run uses. */
  profile_ref: z.string().default('student-profile.json'),
});
export type RunScope = z.infer<typeof RunScopeSchema>;

/** Canonical artifact paths, so any skill finds prior state via the manifest. */
export const RunFilesSchema = z.object({
  universe: z.string().default('universe.json'),
  catalog_shards_dir: z.string().default('catalog/'),
  catalog_merged: z.string().default('catalog.json'),
  scholarships: z.string().default('scholarships.json'),
  results_scored: z.string().default('results_scored.json'),
});
export type RunFiles = z.infer<typeof RunFilesSchema>;

/** Per-stage status for the six pipeline skills. */
export const StageStatusMapSchema = z.object({
  intake: StageStatusSchema,
  universe: StageStatusSchema,
  catalog: StageStatusSchema,
  enrichment: StageStatusSchema,
  scoring: StageStatusSchema,
  reporting: StageStatusSchema,
});
export type StageStatusMap = z.infer<typeof StageStatusMapSchema>;

/** Per-country coverage — mirrored from universe.json, computed never typed. */
export const CoverageEntrySchema = z.object({
  total: z.number().int().nonnegative(),
  checked: z.number().int().nonnegative(),
  ratio: z.number().min(0).max(1),
});
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

/** One dispatched worker batch (catalog / enrichment). */
export const BatchRecordSchema = z.object({
  batch_id: z.string().min(1),
  stage: z.string().min(1),
  country: CountryCodeSchema,
  institution_ids: z.array(z.string()),
  status: StageStatusSchema,
  tool_calls_used: z.number().int().nonnegative().nullable(),
  tool_call_budget: z.number().int().positive(),
  shard_file: z.string(),
  started: z.string().nullable(),
  finished: z.string().nullable(),
});
export type BatchRecord = z.infer<typeof BatchRecordSchema>;

/** Bounded-concurrency settings (rules/03). */
export const ConcurrencySchema = z.object({
  max_parallel_workers: z.number().int().positive().default(2),
  default_batch_size: z.number().int().positive().default(8),
});
export type Concurrency = z.infer<typeof ConcurrencySchema>;

/** The control file for a single search run (schemas/run-manifest.md). */
export const RunManifestSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  created: z.string(),
  updated: z.string(),
  scope: RunScopeSchema,
  files: RunFilesSchema,
  stage_status: StageStatusMapSchema,
  coverage: z.record(z.string(), CoverageEntrySchema).default({}),
  batches: z.array(BatchRecordSchema).default([]),
  concurrency: ConcurrencySchema,
  log: z.array(z.string()).default([]),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;
