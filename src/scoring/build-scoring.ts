import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { runPool, type PoolOutcome } from '../catalog/pool.js';
import { FileConfigStore } from '../config/config-store.js';
import { BlockingError, ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { CatalogFileSchema, type ProgramRecord } from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../core/types/run-manifest.js';
import {
  ResultsScoredFileSchema,
  ScoringShardSchema,
  type RecommendationTier,
  type ScoredProgram,
  type ScoringWeighting,
  type WeightSet,
} from '../core/types/scored-program.js';
import { ScholarshipFileSchema, type ScholarshipRecord } from '../core/types/scholarship-record.js';
import { StudentProfileSchema, type StudentProfile } from '../core/types/student-profile.js';
import { type LlmComplete, asString, parseJsonObject } from '../llm/parse.js';
import { RoutedLlmClient } from '../llm/routed-client.js';
import { FileStore, type Store } from '../storage/store.js';
import { normalizeWeights, presetFor, type SelectedPreset } from './weighting.js';
import {
  LlmScoringWorker,
  type ScoringBatch,
  type ScoringWorker,
  type ScoringWorkerResult,
} from './worker.js';

const DEFAULT_LLM_CALL_BUDGET = 25;
const MAX_PASSES = 100;
/** Scoring-pass shards live here, beside `catalog/` and `scholarships/`. */
const SCORING_SHARDS_DIR = 'scoring/';

export interface BuildScoringOptions {
  force?: boolean;
  batchSize?: number;
  concurrency?: number;
  llmBudget?: number;
  /** Override the profile's `scoring_profile` preset. */
  weighting?: string;
}

export interface BuildScoringDeps {
  store?: Store;
  worker?: ScoringWorker;
  /** LLM for the custom-notes weighting call; defaults from config. */
  llm?: LlmComplete;
}

export interface BuildScoringResult {
  runId: string;
  skipped: boolean;
  complete: boolean;
  resultsPath: string;
  totalPrograms: number;
  scoredPrograms: number;
  remainingPrograms: number;
  weightingProfile: string;
  tierCounts: Record<RecommendationTier, number>;
}

/**
 * The `scoring` skill (pipeline stage 5). It scores every enriched program
 * against the current student profile and writes a ranked `results_scored.json`.
 * The profile is re-read fresh and hashed; a changed profile forces a full
 * re-score (rule 03.7 — scoring never serves a stale verdict).
 */
export async function buildScoring(
  runId: string,
  options: BuildScoringOptions = {},
  deps: BuildScoringDeps = {},
): Promise<BuildScoringResult> {
  const store = deps.store ?? new FileStore();
  const runDir = store.resolveRunDir(runId);
  const manifestPath = join(runDir, 'run-manifest.json');

  if (!(await store.exists(manifestPath))) {
    throw new BlockingError(`no run manifest for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` first`,
    });
  }
  const manifest = await store.readJson(manifestPath, RunManifestSchema);

  if (manifest.stage_status.enrichment !== 'complete') {
    throw new BlockingError(`enrichment for run "${runId}" is not complete yet`, {
      hint: `run \`finder enrichment build --run ${runId}\` first`,
    });
  }

  const catalogPath = join(runDir, manifest.files.catalog_merged);
  const resultsPath = join(runDir, manifest.files.results_scored);
  if (!(await store.exists(catalogPath))) {
    throw new BlockingError(`catalog.json is missing for run "${runId}"`, {
      hint: `run \`finder enrichment build --run ${runId}\` first`,
    });
  }
  const programs = (await store.readJson(catalogPath, CatalogFileSchema)).programs;

  const profilePath = join(runDir, manifest.scope.profile_ref);
  if (!(await store.exists(profilePath))) {
    throw new BlockingError(`no student profile for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` to seed a profile`,
    });
  }
  const profile = await store.readJson(profilePath, StudentProfileSchema);
  const profileHash = hashProfile(profile);

  const scholarships = await readScholarships(store, join(runDir, manifest.files.scholarships));

  // Prior results — kept only if the profile is unchanged.
  const prior = (await store.exists(resultsPath))
    ? await store.readJson(resultsPath, ResultsScoredFileSchema)
    : null;
  const priorValid = prior !== null && prior.profile_hash === profileHash && !options.force;

  if (manifest.stage_status.scoring === 'complete' && priorValid) {
    return {
      runId,
      skipped: true,
      complete: true,
      resultsPath,
      totalPrograms: programs.length,
      scoredPrograms: prior.scored_count,
      remainingPrograms: 0,
      weightingProfile: prior.weighting.profile,
      tierCounts: tallyTiers(prior.programs),
    };
  }

  // Resume the unchanged-profile case; otherwise re-score everything.
  const scored = new Map<string, ScoredProgram>();
  if (priorValid && prior) {
    for (const entry of prior.programs) scored.set(entry.program_id, entry);
  } else if (options.force || (prior && prior.profile_hash !== profileHash)) {
    manifest.batches = manifest.batches.filter((b) => b.stage !== 'scoring');
  }

  const customNotes = profile.custom_notes;
  const needDefaults = !deps.worker || (customNotes.length > 0 && !deps.llm);
  const built = needDefaults ? await defaultScoringDeps(store) : null;
  const worker: ScoringWorker = deps.worker ?? built!.worker;
  const weightingLlm: LlmComplete | null = deps.llm ?? built?.llm ?? null;

  const preset = presetFor(profile.real_goal.scoring_profile, options.weighting);
  const weighting = await deriveWeighting(weightingLlm, preset, customNotes, profile);

  const batchSize = options.batchSize ?? manifest.concurrency.default_batch_size;
  const concurrency = options.concurrency ?? manifest.concurrency.max_parallel_workers;
  const llmBudget = options.llmBudget ?? DEFAULT_LLM_CALL_BUDGET;

  manifest.stage_status.scoring = 'in-progress';
  manifest.updated = new Date().toISOString();
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  const startTimes = new Map<string, string>();
  let batchSeq = manifest.batches.filter((b) => b.stage === 'scoring').length;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const pending = programs.filter((p) => !scored.has(p.id));
    if (pending.length === 0) break;

    const batches: ScoringBatch[] = sliceByCountry(pending, batchSize).map((group) => {
      const country = group[0]!.identity.country;
      const batchId = `scoring-${country}-${String(++batchSeq).padStart(3, '0')}`;
      return {
        runId,
        batchId,
        country,
        programs: group,
        profile,
        scholarships,
        weights: weighting.weights,
        llmCallBudget: llmBudget,
        shardPath: join(runDir, SCORING_SHARDS_DIR, `${batchId}.json`),
      };
    });

    let progressed = 0;
    await runPool(
      batches,
      concurrency,
      (batch) => {
        startTimes.set(batch.batchId, new Date().toISOString());
        return worker.run(batch);
      },
      async (outcome) => {
        progressed += await applyBatch(
          outcome,
          manifest,
          scored,
          startTimes,
          store,
          manifestPath,
          resultsPath,
          runId,
          profileHash,
          weighting,
        );
      },
    );

    if (progressed === 0) {
      logger.warn('scoring: a pass made no progress — stopping; re-run to resume');
      break;
    }
  }

  // Always write results_scored.json so it reflects current progress.
  await writeResults(store, resultsPath, runId, profileHash, weighting, scored);

  const remaining = programs.filter((p) => !scored.has(p.id)).length;
  const complete = remaining === 0;
  const now = new Date().toISOString();
  manifest.stage_status.scoring = complete ? 'complete' : 'in-progress';
  manifest.updated = now;
  manifest.log.push(
    `${now} scoring ${complete ? 'complete' : 'partial'} — ${scored.size}/${programs.length} ` +
      `programs scored (weighting: ${weighting.profile})`,
  );
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  return {
    runId,
    skipped: false,
    complete,
    resultsPath,
    totalPrograms: programs.length,
    scoredPrograms: scored.size,
    remainingPrograms: remaining,
    weightingProfile: weighting.profile,
    tierCounts: tallyTiers([...scored.values()]),
  };
}

/** Apply one settled scoring batch to disk state. Returns programs scored. */
async function applyBatch(
  outcome: PoolOutcome<ScoringBatch, ScoringWorkerResult>,
  manifest: RunManifest,
  scored: Map<string, ScoredProgram>,
  startTimes: Map<string, string>,
  store: Store,
  manifestPath: string,
  resultsPath: string,
  runId: string,
  profileHash: string,
  weighting: ScoringWeighting,
): Promise<number> {
  const now = new Date().toISOString();
  const batch = outcome.item;
  const started = startTimes.get(batch.batchId) ?? now;

  if (!outcome.ok) {
    logger.warn(
      `scoring batch ${batch.batchId} failed (${describe(outcome.error)}) — ` +
        'its programs stay unscored and will be retried',
    );
    manifest.batches.push({
      batch_id: batch.batchId,
      stage: 'scoring',
      country: batch.country,
      institution_ids: batch.programs.map((p) => p.id),
      status: 'failed',
      tool_calls_used: null,
      tool_call_budget: batch.llmCallBudget,
      shard_file: '',
      started,
      finished: now,
    });
    manifest.updated = now;
    await store.writeJson(manifestPath, manifest, RunManifestSchema);
    return 0;
  }

  const result = outcome.result;
  const shard = await store.readJson(result.shardPath, ScoringShardSchema);
  for (const entry of shard.programs) scored.set(entry.program_id, entry);

  manifest.batches.push({
    batch_id: result.batchId,
    stage: 'scoring',
    country: batch.country,
    institution_ids: result.programIds,
    status: 'complete',
    tool_calls_used: result.llmCallsUsed,
    tool_call_budget: batch.llmCallBudget,
    shard_file: join(SCORING_SHARDS_DIR, `${result.batchId}.json`),
    started,
    finished: now,
  });
  manifest.updated = now;
  manifest.log.push(`${now} scoring batch ${result.batchId} — ${result.programIds.length} program(s)`);
  logger.step(
    `${result.batchId}: ${result.programIds.length} program(s) scored` +
      (result.budgetExhausted ? ' (budget reached — remainder deferred)' : ''),
  );

  await writeResults(store, resultsPath, runId, profileHash, weighting, scored);
  await store.writeJson(manifestPath, manifest, RunManifestSchema);
  return result.programIds.length;
}

/** Write results_scored.json, sorted by weighted_total (ties broken by id). */
async function writeResults(
  store: Store,
  resultsPath: string,
  runId: string,
  profileHash: string,
  weighting: ScoringWeighting,
  scored: Map<string, ScoredProgram>,
): Promise<void> {
  const programs = [...scored.values()].sort(
    (a, b) => b.weighted_total - a.weighted_total || a.program_id.localeCompare(b.program_id),
  );
  await store.writeJson(
    resultsPath,
    {
      schema_version: '1.0' as const,
      run_id: runId,
      generated: today(),
      profile_hash: profileHash,
      weighting,
      scored_count: programs.length,
      programs,
    },
    ResultsScoredFileSchema,
  );
}

/** One LLM call to adjust the preset weights for the student's custom notes. */
async function deriveWeighting(
  llm: LlmComplete | null,
  preset: SelectedPreset,
  customNotes: string[],
  profile: StudentProfile,
): Promise<ScoringWeighting> {
  if (customNotes.length === 0 || llm === null) {
    return {
      profile: preset.name,
      weights: preset.weights,
      rationale: 'Goal preset applied; no custom notes to adjust for.',
    };
  }
  const system =
    'You tune graduate-program scoring weights to a student’s stated priorities. ' +
    'Respond ONLY with a JSON object — no prose.';
  const user =
    `Goal preset "${preset.name}" weights (percent, sum 100): ${JSON.stringify(preset.weights)}\n` +
    `real_goal: ${JSON.stringify(profile.real_goal)}\n\n` +
    `The student's custom notes:\n${customNotes.map((n) => `- ${n}`).join('\n')}\n\n` +
    'Adjust the six weights so they reflect these notes (e.g. a note that location ' +
    'outweighs prestige should raise "location" and lower "academic"). Keep every ' +
    'weight >= 0. Return {"funding":n,"location":n,"admission":n,"visa":n,"logistics":n,' +
    '"academic":n,"rationale":string}. JSON object only.';

  const result = await llm.complete('worker', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 700,
    temperature: 0,
  });
  const o = parseJsonObject(result.text);
  const raw: WeightSet = {
    funding: asWeight(o['funding'], preset.weights.funding),
    location: asWeight(o['location'], preset.weights.location),
    admission: asWeight(o['admission'], preset.weights.admission),
    visa: asWeight(o['visa'], preset.weights.visa),
    logistics: asWeight(o['logistics'], preset.weights.logistics),
    academic: asWeight(o['academic'], preset.weights.academic),
  };
  return {
    profile: preset.name,
    weights: normalizeWeights(raw),
    rationale:
      asString(o['rationale']) ?? `Weights adjusted from the "${preset.name}" preset for custom notes.`,
  };
}

/** Group programs by country, then chunk each country's list. */
function sliceByCountry(programs: ProgramRecord[], size: number): ProgramRecord[][] {
  const byCountry = new Map<CountryCode, ProgramRecord[]>();
  for (const program of programs) {
    const list = byCountry.get(program.identity.country) ?? [];
    list.push(program);
    byCountry.set(program.identity.country, list);
  }
  const batches: ProgramRecord[][] = [];
  for (const list of byCountry.values()) {
    for (let i = 0; i < list.length; i += size) {
      batches.push(list.slice(i, i + size));
    }
  }
  return batches;
}

function tallyTiers(programs: ScoredProgram[]): Record<RecommendationTier, number> {
  const counts: Record<RecommendationTier, number> = {
    Priority: 0,
    Apply: 0,
    Backup: 0,
    'Do Not Apply': 0,
  };
  for (const program of programs) counts[program.recommendation_tier] += 1;
  return counts;
}

async function readScholarships(store: Store, path: string): Promise<ScholarshipRecord[]> {
  if (!(await store.exists(path))) return [];
  return (await store.readJson(path, ScholarshipFileSchema)).scholarships;
}

function hashProfile(profile: StudentProfile): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex').slice(0, 16);
}

function asWeight(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function defaultScoringDeps(
  store: Store,
): Promise<{ worker: ScoringWorker; llm: LlmComplete }> {
  const config = await new FileConfigStore().load();
  if (config.roles.worker.length === 0) {
    throw new ConfigError('no LLM model is configured for the "worker" role', {
      hint: 'run `finder setup` to configure a provider and model',
    });
  }
  const llm = new RoutedLlmClient(config);
  return { worker: new LlmScoringWorker({ llm, store }), llm };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
