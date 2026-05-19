import { z } from 'zod';

/** The six preloaded registry countries (docs/country-registries.md). */
export const CountryCodeSchema = z.enum([
  'UK',
  'US',
  'Canada',
  'Australia',
  'Germany',
  'Netherlands',
]);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const ALL_COUNTRIES: readonly CountryCode[] = CountryCodeSchema.options;

/**
 * Fetch tier a registry source was retrieved at. Mirrors the bundled-tools
 * tiered-fetch strategy; `bundled-fixture` marks data shipped for offline tests.
 */
export const FetchTierSchema = z.enum(['http', 'headless', 'real-browser', 'bundled-fixture']);
export type FetchTier = z.infer<typeof FetchTierSchema>;

/**
 * One institution as emitted by a registry provider — pre-normalization, before
 * it becomes a universe entry.
 */
export const RegistryInstitutionSchema = z.object({
  /** Official institution name as it appears in the registry. */
  name: z.string().min(1),
  country: CountryCodeSchema,
  /** State / province / nation — for batch slicing and location scoring. */
  region: z.string(),
  /** The institution's official domain. May be '' when the registry omits it. */
  official_url: z.string(),
  /** Which registry (sub-)source this row came from. */
  registry_source: z.string().min(1),
  /** Native registry identifier (UNITID, UKPRN, …) — used for dedupe when present. */
  raw_id: z.string().nullable().default(null),
});
export type RegistryInstitution = z.infer<typeof RegistryInstitutionSchema>;

/** Provenance for one (sub-)source contributing to a country snapshot. */
export const RegistrySourceSchema = z.object({
  name: z.string().min(1),
  url: z.string(),
  /** ISO timestamp the source was fetched ("date the fetch" hygiene). */
  fetched_at: z.string(),
  row_count: z.number().int().nonnegative(),
  tier: FetchTierSchema,
  /** Free text — e.g. "source unreachable, degraded" for a failed union member. */
  note: z.string().default(''),
});
export type RegistrySource = z.infer<typeof RegistrySourceSchema>;

/** Metadata header of a cached registry snapshot. */
export const SnapshotMetaSchema = z.object({
  country: CountryCodeSchema,
  fetched_at: z.string(),
  sources: z.array(RegistrySourceSchema),
  institution_count: z.number().int().nonnegative(),
  /** The institution-type filter applied — keeps the coverage denominator honest. */
  filter_applied: z.string(),
  /** Set when the universe rests on a union of independent lists, not an official register. */
  lower_confidence: z.boolean().default(false),
});
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;

/** A complete, dated registry snapshot for one country. */
export const SnapshotSchema = z.object({
  schema_version: z.literal('1.0'),
  meta: SnapshotMetaSchema,
  institutions: z.array(RegistryInstitutionSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
