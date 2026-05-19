import { join } from 'node:path';
import { BlockingError } from '../core/errors.js';
import { disambiguateId, makeInstitutionId } from '../core/ids.js';
import { logger } from '../core/logger.js';
import type { CountryCode, RegistryInstitution, Snapshot } from '../core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../core/types/run-manifest.js';
import {
  type UniverseEntry,
  type UniverseFile,
  UniverseFileSchema,
} from '../core/types/universe.js';
import { RegistryService } from '../registry/registry-service.js';
import { FileStore, type Store } from '../storage/store.js';

/** The slice of RegistryService the universe skill needs — keeps it testable. */
export interface UniverseRegistry {
  hasSnapshot(country: CountryCode): Promise<boolean>;
  getSnapshot(country: CountryCode): Promise<Snapshot>;
  sourceLabel(country: CountryCode): string;
}

export interface BuildUniverseOptions {
  force?: boolean;
}

export interface BuildUniverseDeps {
  store?: Store;
  registry?: UniverseRegistry;
}

export interface CountryUniverseSummary {
  country: CountryCode;
  total: number;
  registrySource: string;
  snapshotDate: string;
  lowerConfidence: boolean;
}

export interface BuildUniverseResult {
  runId: string;
  universePath: string;
  countries: CountryUniverseSummary[];
  totalInstitutions: number;
  skipped: boolean;
}

/**
 * The `universe` skill (pipeline stage 2). Builds `universe.json` strictly from
 * cached registry snapshots — every entry `unchecked` — and records the true
 * registry count as each country's coverage denominator. The model is never the
 * source of the institution list.
 */
export async function buildUniverse(
  runId: string,
  options: BuildUniverseOptions = {},
  deps: BuildUniverseDeps = {},
): Promise<BuildUniverseResult> {
  const store = deps.store ?? new FileStore();
  const registry = deps.registry ?? new RegistryService();

  const runDir = store.resolveRunDir(runId);
  const manifestPath = join(runDir, 'run-manifest.json');
  if (!(await store.exists(manifestPath))) {
    throw new BlockingError(`no run manifest for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` first`,
    });
  }
  const manifest = await store.readJson(manifestPath, RunManifestSchema);
  const universePath = join(runDir, manifest.files.universe);

  if (manifest.stage_status.universe === 'complete' && !options.force) {
    return {
      runId,
      universePath,
      skipped: true,
      totalInstitutions: sumCoverage(manifest),
      countries: manifest.scope.countries.map((c) => ({
        country: c,
        total: manifest.coverage[c]?.total ?? 0,
        registrySource: '(already built)',
        snapshotDate: '',
        lowerConfidence: false,
      })),
    };
  }

  // Fail fast — and together — if any country lacks a cached snapshot.
  const missing: CountryCode[] = [];
  for (const country of manifest.scope.countries) {
    if (!(await registry.hasSnapshot(country))) missing.push(country);
  }
  if (missing.length > 0) {
    throw new BlockingError(`no registry snapshot cached for: ${missing.join(', ')}`, {
      hint: `run \`finder universe refresh --country ${missing.join(',')}\` — the institution list is fetched, never recalled`,
    });
  }

  const entries: UniverseEntry[] = [];
  const registrySources: Record<string, string> = {};
  const summaries: CountryUniverseSummary[] = [];
  const usedIds = new Set<string>();

  for (const country of manifest.scope.countries) {
    const snapshot = await registry.getSnapshot(country);
    registrySources[country] = registry.sourceLabel(country);

    for (const inst of snapshot.institutions) {
      entries.push(toUniverseEntry(inst, country, usedIds));
    }
    summaries.push({
      country,
      total: snapshot.institutions.length,
      registrySource: registry.sourceLabel(country),
      snapshotDate: snapshot.meta.fetched_at.slice(0, 10),
      lowerConfidence: snapshot.meta.lower_confidence,
    });
  }

  const universe: UniverseFile = {
    schema_version: '1.0',
    run_id: runId,
    generated: new Date().toISOString().slice(0, 10),
    registry_sources: registrySources,
    institutions: entries,
  };
  await store.writeJson(universePath, universe, UniverseFileSchema);

  const now = new Date().toISOString();
  for (const summary of summaries) {
    manifest.coverage[summary.country] = { total: summary.total, checked: 0, ratio: 0 };
  }
  manifest.stage_status.universe = 'complete';
  manifest.updated = now;
  manifest.log.push(
    `${now} universe complete — ${entries.length} institutions across ${summaries.length} countries`,
  );
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  return {
    runId,
    universePath,
    countries: summaries,
    totalInstitutions: entries.length,
    skipped: false,
  };
}

function toUniverseEntry(
  inst: RegistryInstitution,
  country: CountryCode,
  usedIds: Set<string>,
): UniverseEntry {
  const id = uniqueId(inst, country, usedIds);
  usedIds.add(id);
  return {
    id,
    name: inst.name,
    country,
    region: inst.region,
    registry_source: inst.registry_source,
    official_url: inst.official_url,
    status: 'unchecked',
    programs_found: null,
    last_checked: null,
    checked_by_batch: null,
    notes: inst.official_url.length === 0 ? 'official URL missing from registry' : '',
  };
}

/** Deterministic, collision-free id. Collisions are logged, never silent. */
function uniqueId(inst: RegistryInstitution, country: CountryCode, usedIds: Set<string>): string {
  const base = makeInstitutionId(country, inst.name);
  if (!usedIds.has(base)) return base;

  const withRegion = disambiguateId(base, inst.region);
  if (withRegion !== base && !usedIds.has(withRegion)) {
    logger.warn(`id collision on "${base}" — disambiguated to "${withRegion}" (${inst.name})`);
    return withRegion;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}__${n}`;
    if (!usedIds.has(candidate)) {
      logger.warn(`id collision on "${base}" — disambiguated to "${candidate}" (${inst.name})`);
      return candidate;
    }
  }
}

function sumCoverage(manifest: RunManifest): number {
  return Object.values(manifest.coverage).reduce((acc, c) => acc + c.total, 0);
}
