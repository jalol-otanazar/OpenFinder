import type { Command } from 'commander';
import { logger } from '../../core/logger.js';
import { buildReporting } from '../../reporting/build-reporting.js';

interface ReportingBuildOpts {
  run: string;
  force: boolean;
}

export function registerReportingCommand(program: Command): void {
  const reporting = program
    .command('reporting')
    .description('Render the decision-ready deliverables — spreadsheet, report, coverage.');

  reporting
    .command('build')
    .description('Render the master spreadsheet and report.md from results_scored.json.')
    .requiredOption('--run <run_id>', 'the run to report on')
    .option('--force', 're-render even if the reporting stage is already complete', false)
    .action(async (opts: ReportingBuildOpts) => {
      await runBuild(opts);
    });
}

async function runBuild(opts: ReportingBuildOpts): Promise<void> {
  const result = await buildReporting(opts.run, { force: opts.force });

  if (result.skipped) {
    logger.info(`Reporting for run "${opts.run}" is already complete.`);
    logger.info('Pass --force to re-render the deliverables.');
    return;
  }

  logger.success(`Reporting complete for run "${opts.run}" — the FInder pipeline is finished.`);
  logger.info(`  programs:  ${result.programCount}`);
  logger.info(
    `  coverage:  ${(result.coverageRatio * 100).toFixed(1)}% — ` +
      (result.coverageComplete ? 'search complete' : 'INCOMPLETE (see the coverage report)'),
  );
  logger.info(`  written:   ${result.spreadsheetPath}`);
  logger.info(`  written:   ${result.reportPath}`);
}
