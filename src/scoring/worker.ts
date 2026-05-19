import {
  ScoringShardSchema,
  type AdmissionBucket,
  type DimensionScore,
  type EligibilityVerdict,
  type ScoredProgram,
  type ScoringShard,
  type WeightSet,
} from '../core/types/scored-program.js';
import type { ProgramRecord } from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import type { ScholarshipRecord } from '../core/types/scholarship-record.js';
import type { StudentProfile } from '../core/types/student-profile.js';
import { type LlmComplete, asString, parseJsonObject, truncate } from '../llm/parse.js';
import type { Store } from '../storage/store.js';
import { admissionScore, recommendationTier, weightedTotal } from './weighting.js';

/**
 * The `scoring` worker (skills/scoring.skill.md). One worker scores a batch of
 * programs against the student — one LLM call per program for the seven
 * dimension judgments — then FInder code computes the weighted total and the
 * recommendation tier (rule 04: the ranking math is deterministic, never the
 * LLM's invention). No fetching: scoring is a pure reasoning pass.
 */

export interface ScoringBatch {
  runId: string;
  batchId: string;
  country: CountryCode;
  programs: ProgramRecord[];
  profile: StudentProfile;
  /** Scholarships in scope for this batch's country. */
  scholarships: ScholarshipRecord[];
  /** The goal-derived weight set, applied uniformly across the run. */
  weights: WeightSet;
  llmCallBudget: number;
  shardPath: string;
}

export interface ScoringWorkerResult {
  batchId: string;
  shardPath: string;
  programIds: string[];
  llmCallsUsed: number;
  budgetExhausted: boolean;
}

export interface ScoringWorker {
  run(batch: ScoringBatch): Promise<ScoringWorkerResult>;
}

export interface LlmScoringWorkerDeps {
  llm: LlmComplete;
  store: Store;
}

const MAX_LLM_CALLS_PER_PROGRAM = 1;
const PROGRAM_JSON_LIMIT = 6000;
const PROFILE_JSON_LIMIT = 4000;

/** LLM-driven scoring worker. */
export class LlmScoringWorker implements ScoringWorker {
  constructor(private readonly deps: LlmScoringWorkerDeps) {}

  async run(batch: ScoringBatch): Promise<ScoringWorkerResult> {
    const scored: ScoredProgram[] = [];
    const programIds: string[] = [];
    let llmCallsUsed = 0;
    let budgetExhausted = false;

    for (const program of batch.programs) {
      if (llmCallsUsed + MAX_LLM_CALLS_PER_PROGRAM > batch.llmCallBudget) {
        budgetExhausted = true;
        break;
      }
      scored.push(await this.scoreProgram(program, batch));
      programIds.push(program.id);
      llmCallsUsed += 1;
    }

    const shard: ScoringShard = {
      schema_version: '1.0',
      run_id: batch.runId,
      batch_id: batch.batchId,
      generated: today(),
      programs: scored,
    };
    await this.deps.store.writeJson(batch.shardPath, shard, ScoringShardSchema);

    return { batchId: batch.batchId, shardPath: batch.shardPath, programIds, llmCallsUsed, budgetExhausted };
  }

  /** Score one program — one LLM call for judgments, then deterministic math. */
  private async scoreProgram(program: ProgramRecord, batch: ScoringBatch): Promise<ScoredProgram> {
    const scholarships = batch.scholarships
      .map(
        (s) =>
          `- ${s.name} (${s.funder_type}, ${s.type}) — nationalities: ${
            s.eligibility.nationalities.length > 0 ? s.eligibility.nationalities.join(', ') : 'any'
          }`,
      )
      .join('\n');
    const system =
      'You are a graduate-admissions advisor. Score one program against one student on ' +
      'seven dimensions and respond ONLY with a JSON object — no prose, no markdown.';
    const user =
      `Today: ${today()}\n\n` +
      `STUDENT PROFILE:\n${truncate(JSON.stringify(batch.profile), PROFILE_JSON_LIMIT)}\n\n` +
      `PROGRAM:\n${truncate(JSON.stringify(program), PROGRAM_JSON_LIMIT)}\n\n` +
      `IN-SCOPE SCHOLARSHIPS:\n${scholarships || '(none gathered)'}\n\n` +
      'Score these dimensions:\n' +
      '- eligibility: hard gates — GPA, required background, prerequisites, GRE, English ' +
      'test, application deadline still open vs today. verdict PASS / FAIL / UNCERTAIN; ' +
      'UNCERTAIN when data is missing — list what to confirm in must_confirm.\n' +
      '- admission_chance: the profile vs the typical admitted cohort — bucket ' +
      'Reach / Match / Safety with reasoning. NEVER a percentage.\n' +
      '- academic_fit 0-5: field and coursework alignment; faculty match for research programs.\n' +
      '- funding_fit 0-5: affordability + funding likelihood for an international applicant, ' +
      'including the scholarships above (5 = full tuition+living, 0 = full self-pay).\n' +
      '- location_fit 0-5: location preference, cost of living, and ecosystem (industry, ' +
      'startup scene, research community, diaspora).\n' +
      "- visa 0-5: for the student's nationality — visa difficulty, work rights, PR pathway.\n" +
      '- logistics 0-5: can every document be assembled before the deadline, given today.\n' +
      'Respect the profile’s real_goal and custom_notes in your reasoning.\n\n' +
      'Return exactly this JSON object:\n' +
      '{"eligibility":{"verdict":"PASS|FAIL|UNCERTAIN","reasoning":string,"must_confirm":string[]},' +
      '"admission_chance":{"bucket":"Reach|Match|Safety","reasoning":string},' +
      '"academic_fit":{"score":0-5,"reasoning":string},' +
      '"funding_fit":{"score":0-5,"reasoning":string},' +
      '"location_fit":{"score":0-5,"reasoning":string},' +
      '"visa":{"score":0-5,"reasoning":string},' +
      '"logistics":{"score":0-5,"reasoning":string},' +
      '"summary":string}. ' +
      'summary is two sentences addressed to the student as "you". JSON object only.';

    const result = await this.deps.llm.complete('worker', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 2000,
      temperature: 0,
    });
    const card = parseJsonObject(result.text);

    const eligibility = coerceEligibility(card['eligibility']);
    const admission = coerceAdmission(card['admission_chance']);
    const academic = coerceDimension(card['academic_fit']);
    const funding = coerceDimension(card['funding_fit']);
    const location = coerceDimension(card['location_fit']);
    const visa = coerceDimension(card['visa']);
    const logistics = coerceDimension(card['logistics']);

    const total = weightedTotal(
      {
        funding: funding.score,
        location: location.score,
        admission: admissionScore(admission.bucket),
        visa: visa.score,
        logistics: logistics.score,
        academic: academic.score,
      },
      batch.weights,
    );

    return {
      program_id: program.id,
      institution_id: program.institution_id,
      identity: {
        university: program.identity.university,
        program: program.identity.program,
        country: program.identity.country,
        degree_type: program.identity.degree_type,
      },
      eligibility,
      admission_chance: admission,
      academic_fit: academic,
      funding_fit: funding,
      location_fit: location,
      visa,
      logistics,
      weighted_total: total,
      recommendation_tier: recommendationTier(eligibility.verdict, total),
      summary: asString(card['summary']) ?? 'No summary was produced for this program.',
    };
  }
}

function coerceEligibility(value: unknown): ScoredProgram['eligibility'] {
  const o = isRecord(value) ? value : {};
  const mustConfirm = Array.isArray(o['must_confirm'])
    ? o['must_confirm'].map(asString).filter((s): s is string => s !== null)
    : [];
  return {
    verdict: coerceVerdict(o['verdict']),
    reasoning: asString(o['reasoning']) ?? '',
    must_confirm: mustConfirm,
  };
}

function coerceAdmission(value: unknown): ScoredProgram['admission_chance'] {
  const o = isRecord(value) ? value : {};
  return { bucket: coerceBucket(o['bucket']), reasoning: asString(o['reasoning']) ?? '' };
}

function coerceDimension(value: unknown): DimensionScore {
  const o = isRecord(value) ? value : {};
  return { score: asScore(o['score']), reasoning: asString(o['reasoning']) ?? '' };
}

function coerceVerdict(value: unknown): EligibilityVerdict {
  return value === 'PASS' || value === 'FAIL' ? value : 'UNCERTAIN';
}

function coerceBucket(value: unknown): AdmissionBucket {
  return value === 'Safety' || value === 'Match' ? value : 'Reach';
}

/** A 0–5 integer from a loose LLM value; out-of-range is clamped, junk is 0. */
function asScore(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
