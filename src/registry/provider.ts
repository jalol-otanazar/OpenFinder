import type { Logger } from '../core/logger.js';
import type { CountryCode, RegistryInstitution, RegistrySource } from '../core/types/registry.js';
import type { Fetcher } from '../tools/fetcher.js';

/** Dependencies injected into a provider — never constructed by the provider itself. */
export interface RegistryFetchContext {
  fetcher: Fetcher;
  logger: Logger;
}

/** What a provider returns from one fetch. */
export interface RegistryFetchResult {
  institutions: RegistryInstitution[];
  /** Provenance for every (sub-)source consulted. */
  sources: RegistrySource[];
  /** The institution-type filter applied — recorded so the coverage denominator is honest. */
  filterApplied: string;
  /** True when the universe rests on a union of independent lists, not an official register. */
  lowerConfidence?: boolean;
}

/**
 * One country's registry. Providers are pure fetch + transform — they do not
 * cache, do not write files, and never know about `universe.json`. The model is
 * never consulted: the institution list is always fetched (rules/01 §1.2).
 */
export interface RegistryProvider {
  readonly country: CountryCode;
  /** Composite human label for `registry_source` on universe rows. */
  readonly sourceLabel: string;
  fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult>;
}
