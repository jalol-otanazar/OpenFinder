import { RegistryError } from '../../core/errors.js';
import type {
  FetchTier,
  RegistryInstitution,
  RegistrySource,
} from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * Japan has no clean public machine-readable register of HEIs. MEXT maintains
 * the canonical list of recognised universities (national, public, private),
 * but the page is published as HTML tables in Japanese with no plain export.
 * To stay robust we union the Wikipedia "List of universities in Japan" page
 * (which mirrors MEXT) with the JAUP (Japan Association of Private
 * Universities) member list, and mark the universe lowerConfidence.
 */
interface JpSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  keywords: string[];
}

const JP_SUB_SOURCES: JpSubSource[] = [
  {
    label: 'MEXT-recognised universities (Wikipedia cross-check)',
    envVar: 'FINDER_JP_MEXT_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_universities_in_Japan',
    registrySource: 'MEXT (Wikipedia cross-check)',
    keywords: ['university', 'institute of technology', 'kyoto', 'tokyo', 'osaka', 'tohoku', 'todai'],
  },
  {
    label: 'JAUP — private universities',
    envVar: 'FINDER_JP_JAUP_URL',
    defaultUrl: 'https://en.wikipedia.org/wiki/List_of_private_universities_and_colleges_in_Japan',
    registrySource: 'JAUP / Wikipedia cross-check',
    keywords: ['university', 'college', 'institute', 'gakuin', 'daigaku'],
  },
];

/** Japan registry — union of MEXT-recognised + JAUP cross-check. */
export class JapanUnionProvider implements RegistryProvider {
  readonly country = 'Japan' as const;
  readonly sourceLabel = 'MEXT (cross-check) + JAUP private universities';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('Japan: fetching MEXT + JAUP institution lists…');

    const settled = await Promise.allSettled(JP_SUB_SOURCES.map((sub) => fetchSub(sub, ctx)));

    const institutions: RegistryInstitution[] = [];
    const sources: RegistrySource[] = [];
    let succeeded = 0;

    settled.forEach((outcome, i) => {
      const sub = JP_SUB_SOURCES[i]!;
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
        ctx.logger.warn(`Japan sub-source "${sub.label}" failed — degraded: ${reason}`);
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
      throw new RegistryError('every Japan registry sub-source failed', {
        hint: 'check connectivity, or set FINDER_JP_MEXT_URL / FINDER_JP_JAUP_URL',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'National, public, and private universities + institutes of technology',
      lowerConfidence: true,
    };
  }
}

async function fetchSub(
  sub: JpSubSource,
  ctx: RegistryFetchContext,
): Promise<{ institutions: RegistryInstitution[]; tierUsed: FetchTier }> {
  const url = process.env[sub.envVar] ?? sub.defaultUrl;
  const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
  if (!res.ok) {
    throw new RegistryError(`${sub.label} download failed (HTTP ${res.status})`);
  }
  const institutions = parseHtmlList(res.text(), {
    country: 'Japan',
    registrySource: sub.registrySource,
    keywords: sub.keywords,
    pageUrl: url,
  });
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions, tierUsed: res.tierUsed };
}
