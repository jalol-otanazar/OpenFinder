import { z } from 'zod';
import { CountryCodeSchema } from './registry.js';

/**
 * Processing status of an institution. A run is complete only when zero entries
 * remain `unchecked` (rules/01 §1.3). `no-programs` and `unreachable` both count
 * as processed for coverage math (docs/coverage-methodology.md).
 */
export const InstitutionStatusSchema = z.enum([
  'unchecked',
  'checked',
  'no-programs',
  'unreachable',
]);
export type InstitutionStatus = z.infer<typeof InstitutionStatusSchema>;

/** One institution row in `universe.json` (schemas/universe-entry.md). */
export const UniverseEntrySchema = z.object({
  /** Stable slug `<country>_<institution>`. */
  id: z.string().min(1),
  name: z.string().min(1),
  country: CountryCodeSchema,
  /** State / province / nation. */
  region: z.string(),
  /** Which registry this row came from — provenance for the universe itself. */
  registry_source: z.string().min(1),
  /** Official domain — the trusted root for catalog/enrichment fetches. */
  official_url: z.string(),
  status: InstitutionStatusSchema,
  /** In-scope programs found; null until checked. */
  programs_found: z.number().int().nonnegative().nullable(),
  /** When catalog last processed this entry. */
  last_checked: z.string().nullable(),
  /** Which worker batch handled it — supports resumability. */
  checked_by_batch: z.string().nullable(),
  notes: z.string().default(''),
});
export type UniverseEntry = z.infer<typeof UniverseEntrySchema>;

/** The complete `universe.json` document. */
export const UniverseFileSchema = z.object({
  schema_version: z.literal('1.0'),
  run_id: z.string().min(1),
  /** ISO date the universe was generated. */
  generated: z.string(),
  /** country -> registry source label. */
  registry_sources: z.record(z.string(), z.string()),
  institutions: z.array(UniverseEntrySchema),
});
export type UniverseFile = z.infer<typeof UniverseFileSchema>;
