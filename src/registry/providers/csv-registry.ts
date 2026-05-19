import { parse } from 'csv-parse/sync';
import { RegistryError } from '../../core/errors.js';
import type { CountryCode, RegistryInstitution } from '../../core/types/registry.js';
import { canonicalUrl, cleanName } from '../normalize.js';

/** Candidate header names for each field — first match wins (case-insensitive). */
export interface CsvColumnSpec {
  name: string[];
  url?: string[];
  region?: string[];
  id?: string[];
  type?: string[];
}

export interface CsvRegistryOptions {
  country: CountryCode;
  registrySource: string;
  columns: CsvColumnSpec;
  /** Field delimiter — many European registries use ';'. */
  delimiter?: string;
  /** Keep only rows whose `type` cell contains one of these (case-insensitive). */
  keepTypes?: string[];
}

/**
 * Parse a CSV registry export into normalized institutions. Header names vary
 * between (and within) registries, so columns are resolved by candidate match
 * rather than fixed position.
 */
export function parseCsvRegistry(csvText: string, opts: CsvRegistryOptions): RegistryInstitution[] {
  let rows: Array<Record<string, string>>;
  try {
    rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
      trim: true,
      delimiter: opts.delimiter ?? ',',
    }) as Array<Record<string, string>>;
  } catch (err) {
    throw new RegistryError(`could not parse the ${opts.country} registry CSV`, { cause: err });
  }

  const header = rows[0] ? Object.keys(rows[0]) : [];
  const nameCol = pickColumn(header, opts.columns.name);
  if (!nameCol) {
    throw new RegistryError(
      `${opts.country} registry CSV has no recognizable institution-name column`,
    );
  }
  const urlCol = opts.columns.url ? pickColumn(header, opts.columns.url) : undefined;
  const regionCol = opts.columns.region ? pickColumn(header, opts.columns.region) : undefined;
  const idCol = opts.columns.id ? pickColumn(header, opts.columns.id) : undefined;
  const typeCol = opts.columns.type ? pickColumn(header, opts.columns.type) : undefined;

  const institutions: RegistryInstitution[] = [];
  for (const row of rows) {
    const name = cleanName(row[nameCol] ?? '');
    if (name.length === 0) continue;

    if (typeCol && opts.keepTypes && opts.keepTypes.length > 0) {
      const typeCell = (row[typeCol] ?? '').toLowerCase();
      if (!opts.keepTypes.some((t) => typeCell.includes(t.toLowerCase()))) continue;
    }

    const rawId = idCol ? (row[idCol] ?? '').trim() : '';
    institutions.push({
      name,
      country: opts.country,
      region: regionCol ? cleanName(row[regionCol] ?? '') : '',
      official_url: urlCol ? canonicalUrl(row[urlCol] ?? '') : '',
      registry_source: opts.registrySource,
      raw_id: rawId.length > 0 ? rawId : null,
    });
  }
  return institutions;
}

function pickColumn(header: string[], candidates: string[]): string | undefined {
  const norm = (s: string): string => s.toLowerCase().trim();
  for (const candidate of candidates) {
    const exact = header.find((h) => norm(h) === norm(candidate));
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = header.find((h) => norm(h).includes(norm(candidate)));
    if (partial) return partial;
  }
  return undefined;
}
