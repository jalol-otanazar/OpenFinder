import type { Command } from 'commander';
import { buildCatalog, type BuildCatalogOptions } from '../../catalog/build-catalog.js';
import { FinderError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

interface CatalogBuildOpts {
  run: string;
  force: boolean;
  batchSize?: string;
  concurrency?: string;
  budget?: string;
}

export function registerCatalogCommand(program: Command): void {
  const catalog = program
    .command('catalog')
    .description('Find the in-scope graduate programs at every institution in the universe.');

  catalog
    .command('build')
    .description('Discover each institution’s programs and build catalog.json.')
    .requiredOption('--run <run_id>', 'the run to build the catalog for')
    .option('--force', 're-check every institution even if the catalog stage is complete', false)
    .option('--batch-size <n>', 'institutions per worker batch')
    .option('--concurrency <n>', 'max workers running at once')
    .option('--budget <n>', 'LLM-completion budget per worker batch')
    .action(async (opts: CatalogBuildOpts) => {
      await runBuild(opts);
    });
}

async function runBuild(opts: CatalogBuildOpts): Promise<void> {
  const options: BuildCatalogOptions = { force: opts.force };
  if (opts.batchSize !== undefined) options.batchSize = positiveInt(opts.batchSize, '--batch-size');
  if (opts.concurrency !== undefined) {
    options.concurrency = positiveInt(opts.concurrency, '--concurrency');
  }
  if (opts.budget !== undefined) options.llmBudget = positiveInt(opts.budget, '--budget');

  const result = await buildCatalog(opts.run, options);

  if (result.skipped) {
    logger.info(
      `Catalog for run "${opts.run}" is already built (${result.totalPrograms} programs).`,
    );
    logger.info('Pass --force to re-check every institution.');
    return;
  }

  if (result.complete) {
    logger.success(`Catalog built for run "${opts.run}".`);
  } else {
    logger.warn(`Catalog partially built for run "${opts.run}".`);
  }
  for (const c of result.countries) {
    logger.info(
      `  ${c.country}: ${c.processed}/${c.total} institutions checked — ${c.programsFound} programs`,
    );
  }
  logger.info(`\nTotal: ${result.totalPrograms} programs in the catalog.`);
  logger.info(`Written: ${result.catalogPath}`);
  if (!result.complete) {
    logger.info(
      `${result.remainingUnchecked} institution(s) still unchecked — ` +
        `re-run \`finder catalog build --run ${opts.run}\` to resume.`,
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
