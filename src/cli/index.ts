import { Command } from 'commander';
import { FinderError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerModelsCommand } from './commands/models.js';
import { registerIntakeCommand } from './commands/intake.js';
import { registerUniverseCommand } from './commands/universe.js';
import { registerCatalogCommand } from './commands/catalog.js';
import { registerEnrichmentCommand } from './commands/enrichment.js';
import { registerScoringCommand } from './commands/scoring.js';
import { registerReportingCommand } from './commands/reporting.js';

const program = new Command();

program
  .name('finder')
  .description('FInder — an exhaustive, goal-aware graduate-program advisor.')
  .version('0.1.0');

registerSetupCommand(program);
registerConfigCommand(program);
registerModelsCommand(program);
registerIntakeCommand(program);
registerUniverseCommand(program);
registerCatalogCommand(program);
registerEnrichmentCommand(program);
registerScoringCommand(program);
registerReportingCommand(program);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // Ctrl-C out of an interactive prompt — exit quietly.
    if (err instanceof Error && err.name === 'ExitPromptError') {
      logger.info('\nCancelled.');
      return;
    }
    if (err instanceof FinderError) {
      logger.error(err.message);
      if (err.hint) logger.hint(err.hint);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

void main();
