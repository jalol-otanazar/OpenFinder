import type { Command } from 'commander';
import { FinderError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { ALL_COUNTRIES, CountryCodeSchema, type CountryCode } from '../../core/types/registry.js';
import { RegistryService } from '../../registry/registry-service.js';
import { buildUniverse } from '../../universe/build-universe.js';

export function registerUniverseCommand(program: Command): void {
  const universe = program
    .command('universe')
    .description('Enumerate the institution universe from authoritative registries.');

  universe
    .command('refresh')
    .description('Fetch registries and cache dated snapshots.')
    .option('--country <list>', 'comma-separated countries to refresh')
    .option('--all', 'refresh all six preloaded countries')
    .action(async (opts: { country?: string; all?: boolean }) => {
      await runRefresh(opts);
    });

  universe
    .command('build')
    .description('Build universe.json from cached registry snapshots.')
    .requiredOption('--run <run_id>', 'the run to build the universe for')
    .option('--force', 'rebuild even if the universe stage is already complete', false)
    .action(async (opts: { run: string; force: boolean }) => {
      await runBuild(opts);
    });
}

async function runRefresh(opts: { country?: string; all?: boolean }): Promise<void> {
  const countries = opts.country ? parseCountries(opts.country) : ALL_COUNTRIES;
  if (!opts.country && !opts.all) {
    logger.info('No --country given; refreshing all six preloaded registries.');
  }

  const service = new RegistryService();
  let ok = 0;
  let failed = 0;

  for (const country of countries) {
    try {
      const snapshot = await service.refresh(country);
      ok++;
      const degraded = snapshot.meta.sources.filter((s) => s.note.length > 0);
      logger.success(
        `${country}: ${snapshot.meta.institution_count} institutions cached ` +
          `(${snapshot.meta.fetched_at.slice(0, 10)})`,
      );
      for (const source of degraded) {
        logger.warn(`  ${country} sub-source "${source.name}": ${source.note}`);
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`${country}: refresh failed — ${message}`);
    }
  }

  logger.info(`\nRefresh complete: ${ok} succeeded, ${failed} failed.`);
  if (failed > 0 && ok > 0) {
    logger.info('Per-country independence: succeeded countries are cached and usable.');
  }
  if (ok === 0) {
    throw new FinderError('no registries could be refreshed');
  }
}

async function runBuild(opts: { run: string; force: boolean }): Promise<void> {
  const result = await buildUniverse(opts.run, { force: opts.force });

  if (result.skipped) {
    logger.info(
      `Universe for run "${opts.run}" is already built (${result.totalInstitutions} institutions).`,
    );
    logger.info('Pass --force to rebuild from the latest snapshots.');
    return;
  }

  logger.success(`Universe built for run "${opts.run}".`);
  for (const c of result.countries) {
    const confidence = c.lowerConfidence ? '  [lower-confidence: union of lists]' : '';
    logger.info(
      `  ${c.country}: ${c.total} institutions  — ${c.registrySource}  (snapshot ${c.snapshotDate})${confidence}`,
    );
  }
  logger.info(`\nTotal: ${result.totalInstitutions} institutions, all status "unchecked".`);
  logger.info(`Written: ${result.universePath}`);
}

function parseCountries(raw: string): CountryCode[] {
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tokens.length === 0) {
    throw new FinderError('no countries given to --country');
  }
  const valid = CountryCodeSchema.options;
  const result: CountryCode[] = [];
  for (const token of tokens) {
    const match = valid.find((c) => c.toLowerCase() === token.toLowerCase());
    if (!match) {
      throw new FinderError(`unknown country "${token}"`, {
        hint: `supported: ${valid.join(', ')}`,
      });
    }
    if (!result.includes(match)) result.push(match);
  }
  return result;
}
