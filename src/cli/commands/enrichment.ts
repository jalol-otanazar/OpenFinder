import type { Command } from 'commander';
import { buildEnrichment, type BuildEnrichmentOptions } from '../../enrichment/build-enrichment.js';
import { FinderError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

interface EnrichmentBuildOpts {
  run: string;
  force: boolean;
  batchSize?: string;
  concurrency?: string;
  budget?: string;
}

export function registerEnrichmentCommand(program: Command): void {
  const enrichment = program
    .command('enrichment')
    .description('Fill each catalog program with requirements, costs, funding, and outcomes.');

  enrichment
    .command('build')
    .description('Enrich every program from official pages and gather scholarships.')
    .requiredOption('--run <run_id>', 'the run to enrich')
    .option('--force', 're-enrich every program even if the stage is already complete', false)
    .option('--batch-size <n>', 'programs per worker batch')
    .option('--concurrency <n>', 'max workers running at once')
    .option('--budget <n>', 'LLM-completion budget per worker batch')
    .action(async (opts: EnrichmentBuildOpts) => {
      await runBuild(opts);
    });
}

async function runBuild(opts: EnrichmentBuildOpts): Promise<void> {
  const options: BuildEnrichmentOptions = { force: opts.force };
  if (opts.batchSize !== undefined) options.batchSize = positiveInt(opts.batchSize, '--batch-size');
  if (opts.concurrency !== undefined) {
    options.concurrency = positiveInt(opts.concurrency, '--concurrency');
  }
  if (opts.budget !== undefined) options.llmBudget = positiveInt(opts.budget, '--budget');

  const result = await buildEnrichment(opts.run, options);

  if (result.skipped) {
    logger.info(
      `Enrichment for run "${opts.run}" is already complete ` +
        `(${result.enrichedPrograms} programs, ${result.scholarshipsFound} scholarships).`,
    );
    logger.info('Pass --force to re-enrich every program.');
    return;
  }

  if (result.complete) {
    logger.success(`Enrichment complete for run "${opts.run}".`);
  } else {
    logger.warn(`Enrichment partially complete for run "${opts.run}".`);
  }
  for (const c of result.countries) {
    logger.info(`  ${c.country}: ${c.enriched}/${c.programs} programs enriched`);
  }
  logger.info(
    `\nTotal: ${result.enrichedPrograms}/${result.totalPrograms} programs enriched, ` +
      `${result.scholarshipsFound} scholarships gathered.`,
  );
  logger.info(`Written: ${result.catalogPath}`);
  if (result.complete) {
    logger.info(`Written: ${result.scholarshipsPath}`);
  } else {
    logger.info(
      `${result.remainingPrograms} program(s) still pending — ` +
        `re-run \`finder enrichment build --run ${opts.run}\` to resume ` +
        '(the scholarship pass runs once every program is enriched).',
    );
  }
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FinderError(`${flag} must be a positive integer`);
  }
  return n;
}
