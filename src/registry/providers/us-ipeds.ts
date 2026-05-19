import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { RegistryError } from '../../core/errors.js';
import type { RegistryInstitution, RegistrySource } from '../../core/types/registry.js';
import { canonicalUrl, cleanName } from '../normalize.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';

/**
 * The IPEDS directory ("HD") year to fetch. Registries publish annually; this is
 * the one per-source constant likely to need bumping. Override with FINDER_IPEDS_YEAR.
 */
const DEFAULT_IPEDS_YEAR = 2023;

/**
 * Carnegie basic-classification codes kept: Doctoral Universities (15–17) and
 * Master's Colleges & Universities (18–20) — the institutions that plausibly
 * offer graduate programs (docs/country-registries.md).
 */
const GRADUATE_CARNEGIE_CODES = new Set(['15', '16', '17', '18', '19', '20']);

/** Carnegie column name, newest IPEDS naming first. */
const CARNEGIE_COLUMNS = ['C21BASIC', 'C18BASIC', 'C15BASIC', 'CARNEGIE'];

function ipedsYear(): number {
  const raw = process.env.FINDER_IPEDS_YEAR;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return DEFAULT_IPEDS_YEAR;
}

function ipedsUrl(year: number): string {
  return `https://nces.ed.gov/ipeds/datacenter/data/HD${year}.zip`;
}

/** US registry — NCES IPEDS directory file, filtered by Carnegie classification. */
export class UsIpedsProvider implements RegistryProvider {
  readonly country = 'US' as const;
  readonly sourceLabel = "NCES IPEDS (Carnegie: Doctoral + Master's institutions)";

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const year = ipedsYear();
    const url = ipedsUrl(year);
    ctx.logger.step(`US: fetching NCES IPEDS HD${year} directory…`);

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 120_000 });
    if (!res.ok) {
      throw new RegistryError(`IPEDS download failed (HTTP ${res.status}) from ${url}`, {
        hint: 'the IPEDS data-center URL may have changed; set FINDER_IPEDS_YEAR to a published year',
      });
    }

    const csvText = extractHdCsv(res.bytes, year);
    const rows = parseRows(csvText);
    const carnegieColumn = findCarnegieColumn(rows);

    const institutions: RegistryInstitution[] = [];
    for (const row of rows) {
      const name = cleanName(String(row['INSTNM'] ?? ''));
      if (name.length === 0) continue;
      const carnegie = String(row[carnegieColumn] ?? '').trim();
      if (!GRADUATE_CARNEGIE_CODES.has(carnegie)) continue;

      institutions.push({
        name,
        country: 'US',
        region: String(row['STABBR'] ?? '').trim(),
        official_url: canonicalUrl(String(row['WEBADDR'] ?? '')),
        registry_source: 'NCES IPEDS',
        raw_id: cleanRawId(row['UNITID']),
      });
    }

    if (institutions.length === 0) {
      throw new RegistryError('IPEDS parse produced zero graduate institutions', {
        hint: 'the HD file format may have changed — inspect the downloaded CSV columns',
      });
    }

    const source: RegistrySource = {
      name: `NCES IPEDS HD${year}`,
      url,
      fetched_at: new Date().toISOString(),
      row_count: rows.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: "Carnegie classification: Doctoral (15-17) + Master's (18-20)",
    };
  }
}

function extractHdCsv(zipBytes: Buffer, year: number): string {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBytes);
  } catch (err) {
    throw new RegistryError('IPEDS download was not a valid ZIP archive', { cause: err });
  }
  const entry = zip.getEntries().find((e) => /hd\d+(_rv)?\.csv$/i.test(e.entryName));
  if (!entry) {
    throw new RegistryError(`no HD CSV found inside HD${year}.zip`);
  }
  // IPEDS CSVs are Windows-1252 encoded; latin1 decodes them without mojibake.
  return entry.getData().toString('latin1');
}

function parseRows(csvText: string): Array<Record<string, string>> {
  try {
    return parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
    }) as Array<Record<string, string>>;
  } catch (err) {
    throw new RegistryError('could not parse the IPEDS HD CSV', { cause: err });
  }
}

function findCarnegieColumn(rows: Array<Record<string, string>>): string {
  const sample = rows[0];
  if (!sample) throw new RegistryError('IPEDS HD CSV had no data rows');
  const present = Object.keys(sample);
  for (const candidate of CARNEGIE_COLUMNS) {
    if (present.includes(candidate)) return candidate;
  }
  throw new RegistryError(
    `IPEDS HD CSV has no Carnegie classification column (looked for ${CARNEGIE_COLUMNS.join(', ')})`,
  );
}

function cleanRawId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return id.length > 0 ? id : null;
}
