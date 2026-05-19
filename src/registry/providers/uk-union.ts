import { RegistryError } from '../../core/errors.js';
import type { RegistryInstitution, RegistrySource } from '../../core/types/registry.js';
import { canonicalUrl, cleanName } from '../normalize.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { type CsvColumnSpec, parseCsvRegistry } from './csv-registry.js';

/**
 * One UK sub-source. The UK universe is a union of independent registers, each
 * fetched separately — a dead source degrades the union, it does not sink it.
 *
 * Working sources today:
 *  - **OfS Register API** — the Office for Students register of English HE
 *    providers, served as JSON with no bot wall. The reliable UK source.
 *  - **HESA** — the UK-wide provider list. HESA sits behind a Cloudflare
 *    JavaScript bot-challenge, so a plain HTTP fetch is usually blocked (it
 *    degrades gracefully). It is kept because it is the correct UK-wide source:
 *    point `FINDER_UK_HESA_URL` at a manually downloaded CSV to use it.
 */
interface UkSubSource {
  label: string;
  envVar: string;
  defaultUrl: string;
  registrySource: string;
  /** Turn a raw response body into institutions. */
  parse: (body: string) => RegistryInstitution[];
}

const HESA_COLUMNS: CsvColumnSpec = {
  name: ['HE Provider', 'Provider Name', "Provider's name", 'Provider', 'Institution', 'name'],
  url: ['Website', 'Web address', 'URL', 'url'],
  region: ['Country', 'Region'],
  id: ['UKPRN', 'ukprn', 'Provider UKPRN'],
};

const UK_SUB_SOURCES: UkSubSource[] = [
  {
    label: 'Office for Students Register (England)',
    envVar: 'FINDER_UK_OFS_URL',
    defaultUrl: 'https://register-api.officeforstudents.org.uk/api/Provider',
    registrySource: 'OfS Register',
    parse: parseOfsJson,
  },
  {
    label: 'HESA HE providers (UK-wide)',
    envVar: 'FINDER_UK_HESA_URL',
    defaultUrl:
      'https://www.hesa.ac.uk/collection/provider-tools/all_hesa_providers?ProviderAllCurrentHESA.csv',
    registrySource: 'HESA',
    parse: (body) =>
      parseCsvRegistry(body, { country: 'UK', registrySource: 'HESA', columns: HESA_COLUMNS }),
  },
];

/** UK registry — union of the OfS register (England) and the HESA UK-wide list. */
export class UkUnionProvider implements RegistryProvider {
  readonly country = 'UK' as const;
  readonly sourceLabel = 'Office for Students Register + HESA';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    ctx.logger.step('UK: fetching union of the OfS register and the HESA list…');

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
        hint: 'check connectivity, or set FINDER_UK_OFS_URL / FINDER_UK_HESA_URL to a reachable source',
      });
    }

    return {
      institutions,
      sources,
      filterApplied: 'Registered HE providers (OfS England register; HESA UK-wide when reachable)',
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
  const institutions = sub.parse(res.text());
  if (institutions.length === 0) {
    throw new RegistryError(`${sub.label} produced zero institutions`);
  }
  return { institutions };
}

/** Parse the OfS Register API JSON array into England HE institutions. */
function parseOfsJson(body: string): RegistryInstitution[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new RegistryError('OfS Register API response was not valid JSON', { cause: err });
  }
  if (!Array.isArray(json)) {
    throw new RegistryError('OfS Register API response was not a JSON array');
  }

  const institutions: RegistryInstitution[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    // Skip providers that have left the register.
    if (str(record['DateOfRemovalFromRegister']) || str(record['DateOfVoluntaryDeregistration'])) {
      continue;
    }
    const name = cleanName(
      str(record['CommonName']) ||
        firstLine(str(record['TradingName'])) ||
        str(record['LegalName']),
    );
    if (name.length === 0) continue;
    const ukprn = str(record['Ukprn']).trim();
    institutions.push({
      name,
      country: 'UK',
      region: 'England',
      official_url: canonicalUrl(str(record['Website'])),
      registry_source: 'OfS Register',
      raw_id: ukprn.length > 0 ? ukprn : null,
    });
  }
  return institutions;
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : String(value);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? '';
}
