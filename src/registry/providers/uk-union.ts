import { RegistryError } from '../../core/errors.js';
import type { RegistryInstitution, RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { type CsvColumnSpec, parseCsvRegistry } from './csv-registry.js';

/**
 * One UK sub-source. The UK universe is a union: a UK-wide HESA list plus the
 * four nation regulators. Each is fetched independently — a dead source
 * degrades the union, it does not sink it.
 */
interface UkSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  columns: CsvColumnSpec;
  /** Applied when the source's rows have no region of their own. */
  fixedRegion?: string;
}

const COMMON_NAME = ['HE Provider', 'Provider name', "Provider's name", 'Institution', 'name'];
const COMMON_URL = ['Website', 'Web address', 'URL', 'url'];
const COMMON_ID = ['UKPRN', 'ukprn', 'Provider UKPRN'];

const UK_SUB_SOURCES: UkSubSource[] = [
  {
    label: 'HESA HE providers (UK-wide)',
    envVar: 'FINDER_UK_HESA_URL',
    defaultUrl: 'https://www.hesa.ac.uk/support/providers/he-providers.csv',
    registrySource: 'HESA',
    columns: { name: COMMON_NAME, url: COMMON_URL, region: ['Region', 'Country'], id: COMMON_ID },
  },
  {
    label: 'Office for Students Register (England)',
    envVar: 'FINDER_UK_OFS_URL',
    defaultUrl: 'https://register-api.officeforstudents.org.uk/api/download/csv',
    registrySource: 'Office for Students Register',
    columns: { name: COMMON_NAME, url: COMMON_URL, id: COMMON_ID },
    fixedRegion: 'England',
  },
  {
    label: 'Scottish Funding Council (Scotland)',
    envVar: 'FINDER_UK_SFC_URL',
    defaultUrl: 'https://www.sfc.ac.uk/data/funded-institutions.csv',
    registrySource: 'Scottish Funding Council',
    columns: { name: COMMON_NAME, url: COMMON_URL, id: COMMON_ID },
    fixedRegion: 'Scotland',
  },
  {
    label: 'Medr / HEFCW (Wales)',
    envVar: 'FINDER_UK_WALES_URL',
    defaultUrl: 'https://www.medr.cymru/data/funded-institutions.csv',
    registrySource: 'Medr (HEFCW)',
    columns: { name: COMMON_NAME, url: COMMON_URL, id: COMMON_ID },
    fixedRegion: 'Wales',
  },
  {
    label: 'Dept. for the Economy (Northern Ireland)',
    envVar: 'FINDER_UK_NI_URL',
    defaultUrl: 'https://www.economy-ni.gov.uk/data/he-institutions.csv',
    registrySource: 'Dept. for the Economy NI',
    columns: { name: COMMON_NAME, url: COMMON_URL, id: COMMON_ID },
    fixedRegion: 'Northern Ireland',
  },
];

/** UK registry — union of UK-wide HESA + the four nation regulators. */
export class UkUnionProvider implements RegistryProvider {
  readonly country = 'UK' as const;
  readonly sourceLabel = 'HESA + Office for Students + SFC + Medr + DfE NI';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('UK: fetching union of HESA + four nation registers…');

    const settled = await Promise.allSettled(UK_SUB_SOURCES.map((sub) => fetchSubSource(sub, ctx)));

    const institutions: RegistryInstitution[] = [];
    const sources: RegistrySource[] = [];
    let succeeded = 0;

    settled.forEach((outcome, i) => {
      const sub = UK_SUB_SOURCES[i]!;
      const url = process.env[sub.envVar] ?? sub.defaultUrl;
      if (outcome.status === 'fulfilled') {
        succeeded++;
        institutions.push(...outcome.value.institutions);
        sources.push({
          name: sub.label,
          url,
          fetched_at: new Date().toISOString(),
          row_count: outcome.value.institutions.length,
          tier: 'http',
          note: '',
        });
      } else {
        const reason =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        ctx.logger.warn(`UK sub-source "${sub.label}" failed — degraded: ${reason}`);
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
      throw new RegistryError('every UK registry sub-source failed', {
        hint: 'check connectivity, or set the FINDER_UK_* URL env vars to current sources',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'Degree-granting HE providers (union of HESA + four nation registers)',
      lowerConfidence: succeeded < UK_SUB_SOURCES.length,
    };
  }
}

async function fetchSubSource(
  sub: UkSubSource,
  ctx: RegistryFetchContext,
): Promise<{ institutions: RegistryInstitution[] }> {
  const url = process.env[sub.envVar] ?? sub.defaultUrl;
  const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000 });
  if (!res.ok) {
    throw new RegistryError(`${sub.label} download failed (HTTP ${res.status})`);
  }
  const parsed = parseCsvRegistry(res.text(), {
    country: 'UK',
    registrySource: sub.registrySource,
    columns: sub.columns,
  });
  const institutions = sub.fixedRegion
    ? parsed.map((inst) => ({
        ...inst,
        region: inst.region.length > 0 ? inst.region : sub.fixedRegion!,
      }))
    : parsed;
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions };
}
