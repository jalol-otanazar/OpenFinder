import { describe, expect, it } from 'vitest';
import { computeCoverage, renderCoverageReport } from '../../src/reporting/coverage.js';
import type { InstitutionStatus, UniverseEntry, UniverseFile } from '../../src/core/types/universe.js';

function entry(id: string, status: InstitutionStatus, programsFound: number | null): UniverseEntry {
  return {
    id,
    name: `Institution ${id}`,
    country: 'US',
    region: 'CA',
    registry_source: 'NCES IPEDS',
    official_url: `https://${id}.edu`,
    status,
    programs_found: programsFound,
    last_checked: null,
    checked_by_batch: null,
    notes: '',
  };
}

function universe(institutions: UniverseEntry[]): UniverseFile {
  return {
    schema_version: '1.0',
    run_id: 'r1',
    generated: '2026-05-19',
    registry_sources: { US: 'NCES IPEDS' },
    institutions,
  };
}

describe('computeCoverage', () => {
  it('counts checked, no-programs, and unreachable toward the numerator', () => {
    const report = computeCoverage(
      universe([
        entry('a', 'checked', 3),
        entry('b', 'no-programs', 0),
        entry('c', 'unreachable', null),
        entry('d', 'checked', 2),
      ]),
    );
    expect(report.overall.total).toBe(4);
    expect(report.overall.processed).toBe(4);
    expect(report.overall.ratio).toBe(1);
    expect(report.overall.programsFound).toBe(5);
    expect(report.complete).toBe(true);
  });

  it('lists unreachable institutions and flags unchecked remainders', () => {
    const report = computeCoverage(
      universe([entry('a', 'checked', 1), entry('b', 'unreachable', null), entry('c', 'unchecked', null)]),
    );
    const us = report.countries[0]!;
    expect(us.processed).toBe(2);
    expect(us.total).toBe(3);
    expect(us.unreachable).toEqual(['Institution b']);
    expect(us.uncheckedRemaining).toBe(1);
    expect(report.complete).toBe(false);
  });
});

describe('renderCoverageReport', () => {
  it('states completeness, the ratio, and known gaps', () => {
    const md = renderCoverageReport(
      computeCoverage(universe([entry('a', 'checked', 1), entry('b', 'unreachable', null)])),
    );
    expect(md).toContain('## Coverage report');
    expect(md).toContain('Institution b'); // the known gap
    expect(md).toContain('complete');
    expect(md).toContain('never claims a 100% search');
  });

  it('says the run is NOT complete when an institution is unchecked', () => {
    const md = renderCoverageReport(
      computeCoverage(universe([entry('a', 'checked', 1), entry('b', 'unchecked', null)])),
    );
    expect(md).toContain('NOT complete');
  });
});
