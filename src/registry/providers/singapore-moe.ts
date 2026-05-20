import { RegistryError } from '../../core/errors.js';
import type {
  FetchTier,
  RegistryInstitution,
  RegistrySource,
} from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * Singapore: the Ministry of Education lists the six autonomous universities;
 * the Committee for Private Education (CPE) registers private HEIs. The
 * universe is the union of both — small enough that the union is essentially
 * complete, but kept lowerConfidence because the CPE list rotates more often
 * than the autonomous-university list.
 */
interface SgSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  keywords: string[];
}

const SG_SUB_SOURCES: SgSubSource[] = [
  {
    label: 'MOE — autonomous universities',
    envVar: 'FINDER_SG_MOE_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_in_Singapore',
    registrySource: 'MOE Singapore (Wikipedia cross-check)',
    keywords: [
      'national university',
      'nanyang',
      'university of technology',
      'singapore management',
      'university of social sciences',
      'institute of technology',
      'singapore university',
    ],
  },
  {
    label: 'CPE-registered private HEIs',
    envVar: 'FINDER_SG_CPE_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_in_Singapore',
    registrySource: 'CPE (Wikipedia cross-check)',
    keywords: ['institute of management', 'college', 'academy', 'university'],
  },
];

/** Singapore registry — union of MOE-autonomous + CPE-registered HEIs. */
export class SingaporeMoeProvider implements RegistryProvider {
  readonly country = 'Singapore' as const;
  readonly sourceLabel = 'MOE autonomous + CPE-registered HEIs';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('Singapore: fetching MOE + CPE institution lists…');

    const settled = await Promise.allSettled(SG_SUB_SOURCES.map((sub) => fetchSub(sub, ctx)));

    const institutions: RegistryInstitution[] = [];
    const sources: RegistrySource[] = [];
    let succeeded = 0;

    settled.forEach((outcome, i) => {
      const sub = SG_SUB_SOURCES[i]!;
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
        ctx.logger.warn(`Singapore sub-source "${sub.label}" failed — degraded: ${reason}`);
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
      throw new RegistryError('every Singapore registry sub-source failed', {
        hint: 'check connectivity, or set FINDER_SG_MOE_URL / FINDER_SG_CPE_URL',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'Autonomous universities + CPE-registered private HEIs',
      lowerConfidence: true,
    };
  }
}

async function fetchSub(
  sub: SgSubSource,
  ctx: RegistryFetchContext,
): Promise<{ institutions: RegistryInstitution[]; tierUsed: FetchTier }> {
  const url = process.env[sub.envVar] ?? sub.defaultUrl;
  const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
  if (!res.ok) {
    throw new RegistryError(`${sub.label} download failed (HTTP ${res.status})`);
  }
  const institutions = parseHtmlList(res.text(), {
    country: 'Singapore',
    registrySource: sub.registrySource,
    keywords: sub.keywords,
    pageUrl: url,
  });
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions, tierUsed: res.tierUsed };
}
