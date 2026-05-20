import { RegistryError } from '../../core/errors.js';
import type {
  FetchTier,
  RegistryInstitution,
  RegistrySource,
} from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * South Korea: the Korean Council for University Education (KCUE) and the
 * Korean Educational Development Institute (KEDI) each maintain a list of
 * recognised universities. Their official pages are in Korean and frequently
 * change layout; we default to two reliably-fetchable Wikipedia mirrors and
 * let the env override point at the live KCUE/KEDI URL when desired.
 */
interface KrSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  keywords: string[];
}

const KR_SUB_SOURCES: KrSubSource[] = [
  {
    label: 'KCUE-recognised universities (Wikipedia cross-check)',
    envVar: 'FINDER_KR_KCUE_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_and_colleges_in_South_Korea',
    registrySource: 'KCUE (Wikipedia cross-check)',
    keywords: ['university', 'institute of technology', 'institute of science', 'kaist', 'unist', 'postech'],
  },
  {
    label: 'KEDI universities (Wikipedia cross-check)',
    envVar: 'FINDER_KR_KEDI_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_national_universities_in_South_Korea',
    registrySource: 'KEDI (Wikipedia cross-check)',
    keywords: ['university', 'institute', 'national', 'normal'],
  },
];

/** Korea registry — union of KCUE + KEDI cross-checks. */
export class KoreaUnionProvider implements RegistryProvider {
  readonly country = 'Korea' as const;
  readonly sourceLabel = 'KCUE + KEDI cross-checks';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('Korea: fetching KCUE + KEDI institution lists…');

    const settled = await Promise.allSettled(KR_SUB_SOURCES.map((sub) => fetchSub(sub, ctx)));

    const institutions: RegistryInstitution[] = [];
    const sources: RegistrySource[] = [];
    let succeeded = 0;

    settled.forEach((outcome, i) => {
      const sub = KR_SUB_SOURCES[i]!;
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
        ctx.logger.warn(`Korea sub-source "${sub.label}" failed — degraded: ${reason}`);
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
      throw new RegistryError('every Korea registry sub-source failed', {
        hint: 'check connectivity, or set FINDER_KR_KCUE_URL / FINDER_KR_KEDI_URL',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'National, private, and special-purpose universities',
      lowerConfidence: true,
    };
  }
}

async function fetchSub(
  sub: KrSubSource,
  ctx: RegistryFetchContext,
): Promise<{ institutions: RegistryInstitution[]; tierUsed: FetchTier }> {
  const url = process.env[sub.envVar] ?? sub.defaultUrl;
  const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
  if (!res.ok) {
    throw new RegistryError(`${sub.label} download failed (HTTP ${res.status})`);
  }
  const institutions = parseHtmlList(res.text(), {
    country: 'Korea',
    registrySource: sub.registrySource,
    keywords: sub.keywords,
    pageUrl: url,
  });
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions, tierUsed: res.tierUsed };
}
