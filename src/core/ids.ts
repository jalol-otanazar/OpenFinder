import type { CountryCode } from './types/registry.js';

/** Short, stable per-country prefix for institution ids. */
const COUNTRY_PREFIX: Record<CountryCode, string> = {
  UK: 'uk',
  US: 'us',
  Canada: 'ca',
  Australia: 'au',
  Germany: 'de',
  Netherlands: 'nl',
};

/** Characters that NFKD normalization does not decompose but we still want folded. */
const SPECIAL_FOLDS: Array<[RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ/g, 'd'],
  [/ł/g, 'l'],
  [/&/g, ' and '],
];

/**
 * Lower-case, accent-folded, underscore-collapsed slug. Critical that this is
 * deterministic and accent-aware — German "Universität" must slug identically
 * across runs and across registry sources.
 */
export function slug(input: string): string {
  let s = input.toLowerCase();
  for (const [pattern, replacement] of SPECIAL_FOLDS) s = s.replace(pattern, replacement);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // strip combining diacritics
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s;
}

/** Stable institution id: `<country-prefix>_<slug(name)>` (schemas/universe-entry.md). */
export function makeInstitutionId(country: CountryCode, name: string): string {
  return `${COUNTRY_PREFIX[country]}_${slug(name)}`;
}

/**
 * Deterministically disambiguate an id that collided with another institution,
 * by appending a region slug. Collisions must be logged by the caller, never
 * resolved silently.
 */
export function disambiguateId(baseId: string, region: string): string {
  const regionSlug = slug(region);
  return regionSlug ? `${baseId}__${regionSlug}` : baseId;
}

/** Stable program id: `<institution_id>_<slug(program)>` (schemas/program-record.md). */
export function makeProgramId(institutionId: string, programName: string): string {
  return `${institutionId}_${slug(programName)}`;
}
