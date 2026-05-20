import { BlockingError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { CountryCode, Snapshot, SnapshotMeta } from '../core/types/registry.js';
import { defaultTieredFetcher, type Fetcher } from '../tools/fetcher.js';
import { dedupeInstitutions } from './dedupe.js';
import { getRegistryProvider } from './providers/index.js';
import { SnapshotStore } from './snapshot-store.js';

/**
 * The facade joining registry providers to the snapshot cache. `getSnapshot`
 * NEVER falls back to model memory — a missing snapshot is a blocking error
 * (rules/01 §1.2). This is where the iron rule is enforced in code.
 */
export class RegistryService {
  constructor(
    private readonly store: SnapshotStore = new SnapshotStore(),
    private readonly fetcher: Fetcher = defaultTieredFetcher(),
  ) {}

  /**
   * Release any long-lived resources held by the fetcher (in particular a
   * headless Chromium instance). Safe to call when the fetcher has none.
   */
  async dispose(): Promise<void> {
    const f = this.fetcher as { dispose?: () => Promise<void> };
    if (typeof f.dispose === 'function') {
      await f.dispose();
    }
  }

  /** Fetch a country's registry and cache a fresh dated snapshot. */
  async refresh(country: CountryCode): Promise<Snapshot> {
    const provider = getRegistryProvider(country);
    const result = await provider.fetch({ fetcher: this.fetcher, logger });

    const { institutions, removed } = dedupeInstitutions(result.institutions);
    if (removed > 0) {
      logger.info(`${country}: merged ${removed} duplicate row(s) across sources`);
    }

    const meta: SnapshotMeta = {
      country,
      fetched_at: new Date().toISOString(),
      sources: result.sources,
      institution_count: institutions.length,
      filter_applied: result.filterApplied,
      lower_confidence: result.lowerConfidence ?? false,
    };
    const snapshot: Snapshot = { schema_version: '1.0', meta, institutions };
    await this.store.write(snapshot);
    return snapshot;
  }

  /**
   * Read the cached snapshot for a country. Throws {@link BlockingError} when
   * none exists — the institution list is fetched, never recalled.
   */
  async getSnapshot(country: CountryCode): Promise<Snapshot> {
    const snapshot = await this.store.readLatest(country);
    if (!snapshot) {
      throw new BlockingError(`no registry snapshot cached for ${country}`, {
        hint: `run \`finder universe refresh --country ${country}\` — the institution list is never recalled from the model`,
      });
    }
    return snapshot;
  }

  async hasSnapshot(country: CountryCode): Promise<boolean> {
    return this.store.hasSnapshot(country);
  }

  /** The composite registry-source label for a country. */
  sourceLabel(country: CountryCode): string {
    return getRegistryProvider(country).sourceLabel;
  }
}
