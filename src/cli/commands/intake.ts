import type { Command } from 'commander';
import { logger } from '../../core/logger.js';
import { runIntake, type RunIntakeOptions } from '../../intake/build-intake.js';

interface IntakeOpts {
  run: string;
  prompt?: string;
  promptFile?: string;
}

export function registerIntakeCommand(program: Command): void {
  program
    .command('intake')
    .description('Capture the student profile from a free-form description (pipeline stage 1).')
    .requiredOption('--run <run_id>', 'identifier for this run')
    .option('--prompt <text>', 'the student description — runs non-interactively')
    .option('--prompt-file <path>', 'read the student description from a file (non-interactive)')
    .action(async (opts: IntakeOpts) => {
      const options: RunIntakeOptions = {};
      if (opts.prompt !== undefined) options.prompt = opts.prompt;
      if (opts.promptFile !== undefined) options.promptFile = opts.promptFile;

      const result = await runIntake(opts.run, options);

      logger.success(`Intake complete for run "${result.runId}".`);
      logger.info(`  profile:    ${result.profilePath}`);
      logger.info(`  manifest:   ${result.manifestPath}`);
      logger.info(`  fields:     ${result.fields.join(', ')}`);
      logger.info(`  countries:  ${result.countries.join(', ')}`);
      logger.info(`  intake:     ${result.intake}`);
      if (result.followUpsAsked > 0) {
        logger.info(`  follow-ups: ${result.followUpsAsked} asked`);
      }
      logger.info(
        `\nNext: \`finder universe refresh\` then \`finder universe build --run ${result.runId}\`.`,
      );
    });
}
