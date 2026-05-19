import type { RegistryInstitution } from '../core/types/registry.js';
import { canonicalNameKey, normalizeHost } from './normalize.js';

export interface DedupeResult {
  institutions: RegistryInstitution[];
  removed: number;
}

/**
 * Collapse duplicate institutions within (and across the union sources of) one
 * country. Matches on native registry id, then hostname, then canonical name —
 * so a uni appearing in two registries, or a multi-campus system, becomes one
 * row. Registry hygiene from docs/country-registries.md.
 */
export function dedupeInstitutions(input: RegistryInstitution[]): DedupeResult {
  const canonical: RegistryInstitution[] = [];
  const keyToIndex = new Map<string, number>();

  for (const inst of input) {
    let matchIdx = -1;
    for (const key of dedupeKeys(inst)) {
      const idx = keyToIndex.get(key);
      if (idx !== undefined) {
        matchIdx = idx;
        break;
      }
    }

    if (matchIdx >= 0) {
      mergeInto(canonical[matchIdx]!, inst);
      for (const key of dedupeKeys(canonical[matchIdx]!)) {
        if (!keyToIndex.has(key)) keyToIndex.set(key, matchIdx);
      }
    } else {
      const idx = canonical.length;
      canonical.push({ ...inst });
      for (const key of dedupeKeys(inst)) {
        if (!keyToIndex.has(key)) keyToIndex.set(key, idx);
      }
    }
  }

  return { institutions: canonical, removed: input.length - canonical.length };
}

function dedupeKeys(inst: RegistryInstitution): string[] {
  const keys: string[] = [];
  if (inst.raw_id && inst.raw_id.length > 0) {
    keys.push(`id:${inst.country}:${inst.raw_id}`);
  }
  const host = normalizeHost(inst.official_url);
  if (host.length > 0) keys.push(`host:${host}`);
  const nameKey = canonicalNameKey(inst.name);
  if (nameKey.length > 0) keys.push(`name:${inst.country}:${nameKey}`);
  return keys;
}

/** Fold a duplicate into the canonical row, filling gaps without losing data. */
function mergeInto(target: RegistryInstitution, dup: RegistryInstitution): void {
  if (target.official_url.length === 0 && dup.official_url.length > 0) {
    target.official_url = dup.official_url;
  }
  if ((target.raw_id === null || target.raw_id.length === 0) && dup.raw_id) {
    target.raw_id = dup.raw_id;
  }
  if (target.region.length === 0 && dup.region.length > 0) {
    target.region = dup.region;
  }
}
