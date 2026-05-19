import type { Command } from 'commander';
import { FinderError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { buildScoring, type BuildScoringOptions } from '../../scoring/build-scoring.js';
import { PRESET_NAMES } from '../../scoring/weighting.js';

interface ScoringBuildOpts {
  run: string;
  force: boolean;
  batchSize?: string;
  concurrency?: string;
  budget?: string;
  weighting?: string;
}

export function registerScoringCommand(program: Command): void {
  const scoring = program
    .command('scoring')
    .description('Score every catalog program against the student on 7 goal-aware dimensions.');

  scoring
    .command('build')
    .description('Score the enriched catalog → ranked results_scored.json.')
    .requiredOption('--run <run_id>', 'the run to score')
    .option('--force', 're-score every program even if the stage is already complete', false)
    .option('--batch-size <n>', 'programs per worker batch')
    .option('--concurrency <n>', 'max workers running at once')
    .option('--budget <n>', 'LLM-completion budget per worker batch')
    .option('--weighting <preset>', `override the goal weighting (${PRESET_NAMES.join(', ')})`)
    .action(async (opts: ScoringBuildOpts) => {
      await runBuild(opts);
    });
}

async function runBuild(opts: ScoringBuildOpts): Promise<void> {
  const options: BuildScoringOptions = { force: opts.force };
  if (opts.batchSize !== undefined) options.batchSize = positiveInt(opts.batchSize, '--batch-size');
  if (opts.concurrency !== undefined) {
    options.concurrency = positiveInt(opts.concurrency, '--concurrency');
  }
  if (opts.budget !== undefined) options.llmBudget = positiveInt(opts.budget, '--budget');
  if (opts.weighting !== undefined) {
    if (!PRESET_NAMES.includes(opts.weighting)) {
      throw new FinderError(`unknown weighting preset "${opts.weighting}"`, {
        hint: `supported: ${PRESET_NAMES.join(', ')}`,
      });
    }
    options.weighting = opts.weighting;
  }

  const result = await buildScoring(opts.run, options);

  if (result.skipped) {
    logger.info(
      `Scoring for run "${opts.run}" is already complete (${result.scoredPrograms} programs).`,
    );
    logger.info('Pass --force to re-score, or update the profile to trigger a re-score.');
    return;
  }

  if (result.complete) {
    logger.success(`Scoring complete for run "${opts.run}".`);
  } else {
    logger.warn(`Scoring partially complete for run "${opts.run}".`);
  }
  logger.info(`  weighting: ${result.weightingProfile}`);
  logger.info(
    `  tiers: ${result.tierCounts.Priority} Priority · ${result.tierCounts.Apply} Apply · ` +
      `${result.tierCounts.Backup} Backup · ${result.tierCounts['Do Not Apply']} Do Not Apply`,
  );
  logger.info(
    `\nTotal: ${result.scoredPrograms}/${result.totalPrograms} programs scored.`,
  );
  logger.info(`Written: ${result.resultsPath}`);
  if (!result.complete) {
    logger.info(
      `${result.remainingPrograms} program(s) still pending — ` +
        `re-run \`finder scoring build --run ${opts.run}\` to resume.`,
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
