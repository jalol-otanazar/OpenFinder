import { join } from 'node:path';
import { FileConfigStore } from '../config/config-store.js';
import { BlockingError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { CatalogFileSchema } from '../core/types/program-record.js';
import { RunManifestSchema } from '../core/types/run-manifest.js';
import { ResultsScoredFileSchema } from '../core/types/scored-program.js';
import { StudentProfileSchema } from '../core/types/student-profile.js';
import { UniverseFileSchema } from '../core/types/universe.js';
import { type LlmComplete } from '../llm/parse.js';
import { RoutedLlmClient } from '../llm/routed-client.js';
import { FileStore, type Store } from '../storage/store.js';
import { HttpFetcher, type Fetcher } from '../tools/fetcher.js';
import { HttpSearchClient, type SearchClient } from '../tools/search.js';
import { computeCoverage, renderCoverageReport } from './coverage.js';
import {
  renderCountryBriefs,
  renderDeadlineCalendar,
  renderGapReport,
} from './narrative.js';
import { renderShortlist, renderSpreadsheet } from './render.js';

export interface BuildReportingOptions {
  force?: boolean;
}

export interface BuildReportingDeps {
  store?: Store;
  llm?: LlmComplete;
  fetcher?: Fetcher;
  search?: SearchClient;
}

export interface BuildReportingResult {
  runId: string;
  skipped: boolean;
  reportPath: string;
  spreadsheetPath: string;
  programCount: number;
  coverageRatio: number;
  coverageComplete: boolean;
}

/**
 * The `reporting` skill (pipeline stage 6 — the last). It turns
 * `results_scored.json` into the decision-ready deliverables: a master
 * spreadsheet (CSV) and a `report.md` carrying the ranked shortlist, per-country
 * briefs, gap report, deadline calendar, and a *computed* coverage report.
 * Completing it completes the FInder pipeline.
 */
export async function buildReporting(
  runId: string,
  options: BuildReportingOptions = {},
  deps: BuildReportingDeps = {},
): Promise<BuildReportingResult> {
  const store = deps.store ?? new FileStore();
  const runDir = store.resolveRunDir(runId);
  const manifestPath = join(runDir, 'run-manifest.json');

  if (!(await store.exists(manifestPath))) {
    throw new BlockingError(`no run manifest for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` first`,
    });
  }
  const manifest = await store.readJson(manifestPath, RunManifestSchema);

  if (manifest.stage_status.scoring !== 'complete') {
    throw new BlockingError(`scoring for run "${runId}" is not complete yet`, {
      hint: `run \`finder scoring build --run ${runId}\` first`,
    });
  }

  const reportDir = join(runDir, 'report');
  const reportPath = join(reportDir, 'report.md');
  const spreadsheetPath = join(reportDir, 'spreadsheet.csv');

  const results = await readRequired(store, join(runDir, manifest.files.results_scored), ResultsScoredFileSchema, runId, 'results_scored.json', 'scoring build');
  const catalog = await readRequired(store, join(runDir, manifest.files.catalog_merged), CatalogFileSchema, runId, 'catalog.json', 'catalog build');
  const universe = await readRequired(store, join(runDir, manifest.files.universe), UniverseFileSchema, runId, 'universe.json', 'universe build');
  const profile = await readRequired(store, join(runDir, manifest.scope.profile_ref), StudentProfileSchema, runId, 'student-profile.json', 'intake');

  const coverage = computeCoverage(universe);

  if (manifest.stage_status.reporting === 'complete' && !options.force) {
    return {
      runId,
      skipped: true,
      reportPath,
      spreadsheetPath,
      programCount: results.scored_count,
      coverageRatio: coverage.overall.ratio,
      coverageComplete: coverage.complete,
    };
  }

  const { llm, fetcher, search } = await resolveDeps(deps);

  // Deterministic deliverables first.
  const spreadsheet = renderSpreadsheet(results.programs, catalog.programs);
  const shortlist = renderShortlist(results.programs);
  const coverageReport = renderCoverageReport(coverage);

  // LLM-backed deliverables — each degrades to a deterministic fallback.
  logger.step('reporting: generating per-country briefs, gap report, deadline calendar…');
  const briefs = await renderCountryBriefs(
    { llm, fetcher, search },
    manifest.scope.countries,
    results.programs,
    profile,
  );
  const gapReport = await renderGapReport(llm, results.programs, profile);
  const calendar = await renderDeadlineCalendar(llm, results.programs, catalog.programs);

  const report = assembleReport(runId, manifest.scope, results.programs.length, coverage, [
    shortlist,
    briefs,
    gapReport,
    calendar,
    coverageReport,
  ]);

  await store.writeText(spreadsheetPath, spreadsheet);
  await store.writeText(reportPath, report);

  const now = new Date().toISOString();
  manifest.stage_status.reporting = 'complete';
  manifest.updated = now;
  manifest.log.push(
    `${now} reporting complete — ${results.scored_count} programs; ` +
      `coverage ${(coverage.overall.ratio * 100).toFixed(1)}% (` +
      `${coverage.complete ? 'search complete' : 'INCOMPLETE'})`,
  );
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  logger.success('reporting: pipeline complete.');
  return {
    runId,
    skipped: false,
    reportPath,
    spreadsheetPath,
    programCount: results.scored_count,
    coverageRatio: coverage.overall.ratio,
    coverageComplete: coverage.complete,
  };
}

/** Assemble `report.md` from the rendered sections. */
function assembleReport(
  runId: string,
  scope: { fields: string[]; countries: string[]; intake: string },
  programCount: number,
  coverage: ReturnType<typeof computeCoverage>,
  sections: string[],
): string {
  const header = [
    `# FInder report — ${runId}`,
    '',
    `Generated ${today()} · Scope: ${scope.fields.join(', ')} in ${scope.countries.join(', ')} ` +
      `· intake ${scope.intake}`,
    `Coverage: ${(coverage.overall.ratio * 100).toFixed(1)}% of registry institutions checked — ` +
      `${coverage.complete ? 'search complete' : `INCOMPLETE, see the coverage report`}`,
    `Programs scored: ${programCount}`,
    '',
  ].join('\n');

  const footer =
    '---\n_FInder is decision support, not official admissions or immigration advice. ' +
    'Confirm every fact against its official source before you rely on it._';

  return [header, ...sections, footer].join('\n\n') + '\n';
}

async function resolveDeps(
  deps: BuildReportingDeps,
): Promise<{ llm: LlmComplete; fetcher: Fetcher; search: SearchClient }> {
  if (deps.llm && deps.fetcher && deps.search) {
    return { llm: deps.llm, fetcher: deps.fetcher, search: deps.search };
  }
  // Reporting tolerates a missing LLM: its narrative renderers fall back.
  const config = await new FileConfigStore().load();
  const fetcher = deps.fetcher ?? new HttpFetcher();
  return {
    llm: deps.llm ?? new RoutedLlmClient(config),
    fetcher,
    search: deps.search ?? new HttpSearchClient(fetcher),
  };
}

async function readRequired<S extends Parameters<Store['readJson']>[1]>(
  store: Store,
  path: string,
  schema: S,
  runId: string,
  name: string,
  produces: string,
): Promise<Awaited<ReturnType<Store['readJson']>>> {
  if (!(await store.exists(path))) {
    throw new BlockingError(`${name} is missing for run "${runId}"`, {
      hint: `run \`finder ${produces} --run ${runId}\` first`,
    });
  }
  return store.readJson(path, schema);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
