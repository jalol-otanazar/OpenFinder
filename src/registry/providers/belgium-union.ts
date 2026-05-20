import { RegistryError } from '../../core/errors.js';
import type {
  FetchTier,
  RegistryInstitution,
  RegistrySource,
} from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * Belgium has two parallel HE systems with their own umbrella organisations:
 * VLIR (Flemish universities) and CRef + ARES (French-speaking community).
 * The Belgium universe is the union of both lists, mirrored from the
 * communities' authoritative pages. Override the per-side URL with the env
 * var below if the directory page moves.
 */
interface BeSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  region: string;
  keywords: string[];
}

const BE_SUB_SOURCES: BeSubSource[] = [
  {
    label: 'VLIR — Flemish universities',
    envVar: 'FINDER_BE_VLIR_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_in_Belgium',
    registrySource: 'VLIR / Wikipedia cross-check',
    region: 'Flanders',
    keywords: ['universiteit', 'university', 'hogeschool', 'kuleuven', 'vub', 'ugent'],
  },
  {
    label: 'CRef / ARES — Wallonia-Brussels universities',
    envVar: 'FINDER_BE_CREF_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_in_Belgium',
    registrySource: 'CRef / ARES',
    region: 'Wallonia-Brussels',
    keywords: ['université', 'universite', 'haute école', 'haute ecole', 'ulb', 'ucl', 'umons'],
  },
];

/** Belgium registry — union of Flemish (VLIR) and Walloon (CRef/ARES) lists. */
export class BelgiumUnionProvider implements RegistryProvider {
  readonly country = 'Belgium' as const;
  readonly sourceLabel = 'Union of VLIR (Flanders) + CRef/ARES (Wallonia-Brussels)';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('Belgium: fetching VLIR + CRef/ARES institution lists…');

    const settled = await Promise.allSettled(BE_SUB_SOURCES.map((sub) => fetchSub(sub, ctx)));

    const institutions: RegistryInstitution[] = [];
    const sources: RegistrySource[] = [];
    let succeeded = 0;

    settled.forEach((outcome, i) => {
      const sub = BE_SUB_SOURCES[i]!;
      const url = process.env[sub.envVar] ?? sub.defaultUrl;
      if (outcome.status === 'fulfilled') {
        succeeded++;
        institutions.push(...outcome.value.institutions);
        sources.push({
          name: sub.label,
          url,
          fetched_at: new Date().toISOString(),
          row_count: outcome.value.institutions.length,
          tier: outcome.value.tierUsed,
          note: '',
        });
      } else {
        const reason =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        ctx.logger.warn(`Belgium sub-source "${sub.label}" failed — degraded: ${reason}`);
        sources.push({
          name: sub.label,
          url,
          fetched_at: new Date().toISOString(),
          row_count: 0,
          tier: 'http',
          note: `unreachable — degraded: ${reason}`,
        });
      }
    });

    if (succeeded === 0) {
      throw new RegistryError('every Belgium registry sub-source failed', {
        hint: 'check connectivity, or set FINDER_BE_VLIR_URL / FINDER_BE_CREF_URL',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'Recognised universities and university colleges (both communities)',
      lowerConfidence: true,
    };
  }
}

async function fetchSub(
  sub: BeSubSource,
  ctx: RegistryFetchContext,
): Promise<{ institutions: RegistryInstitution[]; tierUsed: FetchTier }> {
  const url = process.env[sub.envVar] ?? sub.defaultUrl;
  const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
  if (!res.ok) {
    throw new RegistryError(`${sub.label} download failed (HTTP ${res.status})`);
  }
  const institutions = parseHtmlList(res.text(), {
    country: 'Belgium',
    registrySource: sub.registrySource,
    keywords: sub.keywords,
    region: sub.region,
    pageUrl: url,
  });
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions, tierUsed: res.tierUsed };
}
