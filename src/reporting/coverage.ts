import type { CountryCode } from '../core/types/registry.js';
import type { UniverseFile } from '../core/types/universe.js';

/**
 * The coverage computation (docs/coverage-methodology.md). Coverage is computed
 * from the universe checklist — never estimated:
 *   coverage(country) = |status ∈ {checked, no-programs, unreachable}| / |all|.
 * `unreachable` institutions count as attempted but are reported as known gaps;
 * any `unchecked` entry means the run is not complete (rule 01).
 */

export interface CountryCoverage {
  country: CountryCode;
  registrySource: string;
  total: number;
  processed: number;
  ratio: number;
  programsFound: number;
  /** Names of institutions that could not be processed — known gaps. */
  unreachable: string[];
  uncheckedRemaining: number;
}

export interface CoverageReport {
  countries: CountryCoverage[];
  overall: { total: number; processed: number; ratio: number; programsFound: number };
  /** True only when every institution in every country has been processed. */
  complete: boolean;
}

const PROCESSED = new Set(['checked', 'no-programs', 'unreachable']);

/** Compute per-country and overall coverage from the universe checklist. */
export function computeCoverage(universe: UniverseFile): CoverageReport {
  const byCountry = new Map<CountryCode, CountryCoverage>();

  for (const entry of universe.institutions) {
    let c = byCountry.get(entry.country);
    if (!c) {
      c = {
        country: entry.country,
        registrySource: universe.registry_sources[entry.country] ?? 'unknown',
        total: 0,
        processed: 0,
        ratio: 0,
        programsFound: 0,
        unreachable: [],
        uncheckedRemaining: 0,
      };
      byCountry.set(entry.country, c);
    }
    c.total += 1;
    if (PROCESSED.has(entry.status)) c.processed += 1;
    if (entry.status === 'unchecked') c.uncheckedRemaining += 1;
    if (entry.status === 'unreachable') c.unreachable.push(entry.name);
    c.programsFound += entry.programs_found ?? 0;
  }

  const countries = [...byCountry.values()];
  for (const c of countries) c.ratio = c.total > 0 ? c.processed / c.total : 0;

  const total = countries.reduce((n, c) => n + c.total, 0);
  const processed = countries.reduce((n, c) => n + c.processed, 0);
  const programsFound = countries.reduce((n, c) => n + c.programsFound, 0);

  return {
    countries,
    overall: { total, processed, programsFound, ratio: total > 0 ? processed / total : 0 },
    complete: countries.every((c) => c.uncheckedRemaining === 0),
  };
}

/** Render the coverage report as a Markdown section for `report.md`. */
export function renderCoverageReport(report: CoverageReport): string {
  const lines: string[] = ['## Coverage report', ''];
  const o = report.overall;
  lines.push(
    `Overall: ${o.processed} / ${o.total} institutions checked (${pct(o.ratio)}) — ` +
      `${o.programsFound} programs found.`,
  );
  lines.push(
    report.complete
      ? 'The search is **complete** — every institution in the registry was processed.'
      : `**${unchecked(report)} institution(s) remain unchecked — this run is NOT complete.**`,
  );
  lines.push('');

  for (const c of report.countries) {
    lines.push(`### ${c.country}`);
    lines.push(`- Registry: ${c.registrySource} — ${c.total} institutions (the denominator)`);
    lines.push(`- Checked: ${c.processed} / ${c.total} (${pct(c.ratio)})`);
    lines.push(`- Programs found: ${c.programsFound}`);
    lines.push(
      c.unreachable.length > 0
        ? `- Unreachable (known gaps): ${c.unreachable.join(', ')}`
        : '- Unreachable (known gaps): none',
    );
    if (c.uncheckedRemaining > 0) {
      lines.push(`- **Unchecked remaining: ${c.uncheckedRemaining} — country not complete**`);
    }
    lines.push('');
  }

  lines.push(
    '_Coverage is computed from the registry checklist, never estimated. FInder never ' +
      'claims a 100% search; confirm each program against its official source._',
  );
  return lines.join('\n');
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function unchecked(report: CoverageReport): number {
  return report.countries.reduce((n, c) => n + c.uncheckedRemaining, 0);
}
