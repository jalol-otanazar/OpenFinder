import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileConfigStore } from '../config/config-store.js';
import { BlockingError, ConfigError, FinderError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { ALL_COUNTRIES, type CountryCode } from '../core/types/registry.js';
import { type RunManifest, RunManifestSchema, type StageStatusMap } from '../core/types/run-manifest.js';
import {
  StudentProfileSchema,
  emptyStudentProfile,
  type StudentProfile,
} from '../core/types/student-profile.js';
import { type LlmComplete, asString, asStringArray, parseJsonObject, truncate } from '../llm/parse.js';
import { RoutedLlmClient } from '../llm/routed-client.js';
import { FileStore, type Store } from '../storage/store.js';
import { type IntakeChoice, type IntakePrompter, InquirerPrompter } from './prompter.js';

/**
 * The `intake` skill (pipeline stage 1). It turns one free-form prose prompt
 * into a structured `student-profile.json` and records the run scope into
 * `run-manifest.json` — asking conversational follow-ups only for the blocking
 * fields the search cannot start without (iron rule 9: no forms). Re-runnable:
 * a later prompt updates the profile in place.
 */

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FUNDING_NEEDS = ['fully_funded', 'partial_ok', 'self_fund'] as const;
const SCORING_PROFILES = [
  'phd-academia',
  'immigrate-settle',
  'program-as-vehicle',
  'cheapest-fastest',
] as const;

const SCORING_CHOICES: IntakeChoice[] = [
  { name: 'A career move or relocation — the degree is a means', value: 'program-as-vehicle' },
  { name: 'To immigrate and settle in the destination country', value: 'immigrate-settle' },
  { name: 'Academic research / a PhD and academia', value: 'phd-academia' },
  { name: 'The cheapest, fastest path to the credential', value: 'cheapest-fastest' },
];
const FUNDING_CHOICES: IntakeChoice[] = [
  { name: 'I need full funding — I cannot self-fund tuition', value: 'fully_funded' },
  { name: 'Partial funding is OK — I can cover part of the cost', value: 'partial_ok' },
  { name: 'I can self-fund', value: 'self_fund' },
];

export interface RunIntakeOptions {
  /** Prose supplied directly (non-interactive). */
  prompt?: string;
  /** A file to read the prose from (non-interactive). */
  promptFile?: string;
}

export interface RunIntakeDeps {
  store?: Store;
  llm?: LlmComplete;
  prompter?: IntakePrompter;
}

export interface RunIntakeResult {
  runId: string;
  profilePath: string;
  manifestPath: string;
  fields: string[];
  countries: CountryCode[];
  intake: string;
  interactive: boolean;
  followUpsAsked: number;
  /** True on a re-run whose scope differs from the existing manifest. */
  scopeChanged: boolean;
}

/**
 * The `intake` skill. Builds (or updates) `student-profile.json` from a prose
 * description and writes the run manifest with the confirmed scope.
 */
export async function runIntake(
  runId: string,
  options: RunIntakeOptions = {},
  deps: RunIntakeDeps = {},
): Promise<RunIntakeResult> {
  const id = runId.trim();
  if (!RUN_ID_PATTERN.test(id)) {
    throw new FinderError(`invalid run id "${id}"`, {
      hint: 'use letters, digits, dot, dash or underscore (no spaces or slashes)',
    });
  }

  const store = deps.store ?? new FileStore();
  const prompter = deps.prompter ?? new InquirerPrompter();
  const runDir = store.resolveRunDir(id);
  const manifestPath = join(runDir, 'run-manifest.json');
  const profilePath = join(runDir, 'student-profile.json');

  // 1. Resolve the prose + the interaction mode.
  const { prose, interactive } = await resolveProse(options, prompter);

  // 2. Load existing state — intake is re-runnable.
  const existingProfile = (await store.exists(profilePath))
    ? await store.readJson(profilePath, StudentProfileSchema)
    : null;
  const existingManifest = (await store.exists(manifestPath))
    ? await store.readJson(manifestPath, RunManifestSchema)
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const base = existingProfile ?? emptyStudentProfile(today);

  // 3. Extract a profile from the prose.
  const llm = deps.llm ?? (await defaultLlm());
  logger.step('intake: extracting your profile from the description…');
  const profile = coerceProfile(await extractProfile(llm, prose, existingProfile), base, today);

  // 4. Progressive follow-ups for the blocking fields (interactive only).
  let followUpsAsked = 0;
  if (interactive) {
    followUpsAsked = await askFollowUps(profile, prompter);
  }

  // 5. Normalise countries to supported codes.
  let countries = resolveCountries(profile.preferences.target_countries);
  if (interactive && countries.unknown.length > 0) {
    logger.warn(
      `Not covered: ${countries.unknown.join(', ')} — FInder supports ${ALL_COUNTRIES.join(', ')}.`,
    );
  }
  profile.preferences.target_countries = countries.valid;

  // 6. Confirm the scope (interactive); one correction round on a "no".
  if (interactive) {
    const intakeTerm = intakeTermOf(profile);
    logger.info(
      `\nScope — fields: ${profile.preferences.fields.join(', ') || '(none)'} · ` +
        `countries: ${countries.valid.join(', ') || '(none)'} · intake: ${intakeTerm}`,
    );
    if (!(await prompter.askConfirm('Proceed with this scope?', { default: true }))) {
      profile.preferences.fields = splitList(
        await prompter.askText('Field(s) of study (comma-separated)', {
          default: profile.preferences.fields.join(', '),
        }),
      );
      countries = resolveCountries(
        splitList(
          await prompter.askText(`Countries — supported: ${ALL_COUNTRIES.join(', ')}`, {
            default: countries.valid.join(', '),
          }),
        ),
      );
      profile.preferences.target_countries = countries.valid;
    }
  }

  // 7. Hard requirement — the run scope.
  if (profile.preferences.fields.length === 0) {
    throw new BlockingError('no field of study could be determined', {
      hint: interactive ? 'provide at least one field' : 'name the field(s) in --prompt',
    });
  }
  if (countries.valid.length === 0) {
    throw new BlockingError('no supported country could be determined', {
      hint: `name one or more of: ${ALL_COUNTRIES.join(', ')}`,
    });
  }
  const intakeTerm = intakeTermOf(profile);

  // 8. Write the profile.
  await store.writeJson(profilePath, profile, StudentProfileSchema);

  // 9. Build or update the run manifest.
  const now = new Date().toISOString();
  const scope = { fields: profile.preferences.fields, countries: countries.valid, intake: intakeTerm };
  const { manifest, scopeChanged } = existingManifest
    ? updateManifest(existingManifest, scope, now)
    : { manifest: freshManifest(id, scope, now), scopeChanged: false };
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  return {
    runId: id,
    profilePath,
    manifestPath,
    fields: scope.fields,
    countries: scope.countries,
    intake: intakeTerm,
    interactive,
    followUpsAsked,
    scopeChanged,
  };
}

/** Where the prose comes from, and whether intake runs interactively. */
async function resolveProse(
  options: RunIntakeOptions,
  prompter: IntakePrompter,
): Promise<{ prose: string; interactive: boolean }> {
  if (options.prompt !== undefined && options.prompt.trim().length > 0) {
    return { prose: options.prompt.trim(), interactive: false };
  }
  if (options.promptFile !== undefined) {
    let raw: string;
    try {
      raw = await readFile(options.promptFile, 'utf-8');
    } catch (err) {
      throw new FinderError(`could not read prompt file "${options.promptFile}"`, { cause: err });
    }
    if (raw.trim().length === 0) throw new FinderError('the prompt file is empty');
    return { prose: raw.trim(), interactive: false };
  }
  const prose = await prompter.askText(
    'Describe yourself, your goals, and what you want to study (a paragraph is fine):',
  );
  if (prose.trim().length === 0) throw new FinderError('an intake description is required');
  return { prose: prose.trim(), interactive: true };
}

/** Ask a conversational follow-up for each blocking field still missing. */
async function askFollowUps(profile: StudentProfile, prompter: IntakePrompter): Promise<number> {
  let asked = 0;
  if (profile.preferences.fields.length === 0) {
    profile.preferences.fields = splitList(
      await prompter.askText('What field(s) of study? (comma-separated)'),
    );
    asked += 1;
  }
  if (resolveCountries(profile.preferences.target_countries).valid.length === 0) {
    profile.preferences.target_countries = splitList(
      await prompter.askText(`Which countries? Supported: ${ALL_COUNTRIES.join(', ')}`),
    );
    asked += 1;
  }
  if (profile.real_goal.scoring_profile === null) {
    const picked = await prompter.askChoice('Why this degree — the real goal?', SCORING_CHOICES);
    profile.real_goal.scoring_profile = coerceEnum(picked, SCORING_PROFILES);
    asked += 1;
  }
  if (profile.financial.funding_need === null) {
    const picked = await prompter.askChoice('How much funding do you need?', FUNDING_CHOICES);
    profile.financial.funding_need = coerceEnum(picked, FUNDING_NEEDS);
    asked += 1;
  }
  if (profile.identity.nationality === null) {
    const answer = await prompter.askText('What is your nationality? (it drives visa scoring)');
    if (answer.length > 0) profile.identity.nationality = answer;
    asked += 1;
  }
  return asked;
}

/** One LLM call: free-form prose (+ any existing profile) → a profile JSON object. */
async function extractProfile(
  llm: LlmComplete,
  prose: string,
  existing: StudentProfile | null,
): Promise<Record<string, unknown>> {
  const system =
    "You convert a prospective graduate student's free-form description into a structured " +
    'profile JSON. Respond ONLY with a JSON object — no prose, no markdown.';
  const user =
    (existing
      ? `Update this existing profile with any new information from the description below.\n` +
        `EXISTING PROFILE:\n${truncate(JSON.stringify(existing), 6000)}\n\n`
      : '') +
    `STUDENT DESCRIPTION:\n${truncate(prose, 8000)}\n\n` +
    'Return a JSON object with exactly these keys (use null / [] when the description does ' +
    'not state something — never invent):\n' +
    '{"identity":{"nationality":string|null,"country_of_residence":string|null,"languages":string[]},' +
    '"academics":{"institution":string|null,"degree":string|null,"year_status":string|null,' +
    '"expected_graduation":string|null,"gpa_raw":string|null,"gpa_us_4_0":number|null,' +
    '"gpa_notes":string|null,"instruction_language":string|null,"key_coursework":string[]},' +
    '"tests":{"gre":{"status":string|null,"score":string|null,"planned_date":string|null},' +
    '"english":{"status":string|null,"test_type":string|null,"score":string|null,' +
    '"target":string|null,"notes":string|null},"other":string[]},' +
    '"experience":{"research_publications":string|null,"internships":string|null,' +
    '"projects":string|null,"achievements":string[]},' +
    '"references":{"count_confirmed":number|null,"potential_sources":string[],' +
    '"self_assessed_strength":string|null},' +
    '"financial":{"budget":string|null,"funding_need":"fully_funded"|"partial_ok"|"self_fund"|null,' +
    '"proof_of_funds_capacity":string|null,"external_scholarships":string[]},' +
    '"preferences":{"target_countries":string[],"target_intake":string|null,"fields":string[],' +
    '"program_types_acceptable":string[],"language_of_instruction":string|null,' +
    '"location_priority":string|null,"deal_breakers":string[]},' +
    '"real_goal":{"primary":string|null,"degree_role":string|null,' +
    '"post_graduation_intent":string|null,' +
    '"scoring_profile":"phd-academia"|"immigrate-settle"|"program-as-vehicle"|"cheapest-fastest"|null},' +
    '"custom_notes":string[]}\n' +
    'For real_goal.scoring_profile choose the preset that best fits WHY the student wants the ' +
    'degree. Copy any preference that fits no field into custom_notes verbatim. JSON object only.';

  const result = await llm.complete('worker', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 2200,
    temperature: 0,
  });
  return parseJsonObject(result.text);
}

/** Build a valid StudentProfile by merging the LLM object onto a base profile. */
function coerceProfile(
  raw: Record<string, unknown>,
  base: StudentProfile,
  today: string,
): StudentProfile {
  const identity = obj(raw['identity']);
  const academics = obj(raw['academics']);
  const tests = obj(raw['tests']);
  const gre = obj(tests['gre']);
  const english = obj(tests['english']);
  const experience = obj(raw['experience']);
  const references = obj(raw['references']);
  const financial = obj(raw['financial']);
  const preferences = obj(raw['preferences']);
  const realGoal = obj(raw['real_goal']);

  return {
    schema_version: '1.0',
    created: base.created,
    last_updated: today,
    identity: {
      nationality: asString(identity['nationality']) ?? base.identity.nationality,
      country_of_residence:
        asString(identity['country_of_residence']) ?? base.identity.country_of_residence,
      languages: mergeArr(asStringArray(identity['languages']), base.identity.languages),
    },
    academics: {
      institution: asString(academics['institution']) ?? base.academics.institution,
      degree: asString(academics['degree']) ?? base.academics.degree,
      year_status: asString(academics['year_status']) ?? base.academics.year_status,
      expected_graduation:
        asString(academics['expected_graduation']) ?? base.academics.expected_graduation,
      gpa_raw: asString(academics['gpa_raw']) ?? base.academics.gpa_raw,
      gpa_us_4_0: asNumber(academics['gpa_us_4_0']) ?? base.academics.gpa_us_4_0,
      gpa_notes: asString(academics['gpa_notes']) ?? base.academics.gpa_notes,
      instruction_language:
        asString(academics['instruction_language']) ?? base.academics.instruction_language,
      key_coursework: mergeArr(asStringArray(academics['key_coursework']), base.academics.key_coursework),
    },
    tests: {
      gre: {
        status: asString(gre['status']) ?? base.tests.gre.status,
        score: asString(gre['score']) ?? base.tests.gre.score,
        planned_date: asString(gre['planned_date']) ?? base.tests.gre.planned_date,
      },
      english: {
        status: asString(english['status']) ?? base.tests.english.status,
        test_type: asString(english['test_type']) ?? base.tests.english.test_type,
        score: asString(english['score']) ?? base.tests.english.score,
        target: asString(english['target']) ?? base.tests.english.target,
        notes: asString(english['notes']) ?? base.tests.english.notes,
      },
      other: mergeArr(asStringArray(tests['other']), base.tests.other),
    },
    experience: {
      research_publications:
        asString(experience['research_publications']) ?? base.experience.research_publications,
      internships: asString(experience['internships']) ?? base.experience.internships,
      projects: asString(experience['projects']) ?? base.experience.projects,
      achievements: mergeArr(asStringArray(experience['achievements']), base.experience.achievements),
    },
    references: {
      count_confirmed: asNonNegInt(references['count_confirmed']) ?? base.references.count_confirmed,
      potential_sources: mergeArr(
        asStringArray(references['potential_sources']),
        base.references.potential_sources,
      ),
      self_assessed_strength:
        asString(references['self_assessed_strength']) ?? base.references.self_assessed_strength,
    },
    financial: {
      budget: asString(financial['budget']) ?? base.financial.budget,
      funding_need: coerceEnum(financial['funding_need'], FUNDING_NEEDS) ?? base.financial.funding_need,
      proof_of_funds_capacity:
        asString(financial['proof_of_funds_capacity']) ?? base.financial.proof_of_funds_capacity,
      external_scholarships: mergeArr(
        asStringArray(financial['external_scholarships']),
        base.financial.external_scholarships,
      ),
    },
    preferences: {
      target_countries: mergeArr(
        asStringArray(preferences['target_countries']),
        base.preferences.target_countries,
      ),
      target_intake: asString(preferences['target_intake']) ?? base.preferences.target_intake,
      fields: mergeArr(asStringArray(preferences['fields']), base.preferences.fields),
      program_types_acceptable: mergeArr(
        asStringArray(preferences['program_types_acceptable']),
        base.preferences.program_types_acceptable,
      ),
      language_of_instruction:
        asString(preferences['language_of_instruction']) ?? base.preferences.language_of_instruction,
      location_priority:
        asString(preferences['location_priority']) ?? base.preferences.location_priority,
      deal_breakers: mergeArr(asStringArray(preferences['deal_breakers']), base.preferences.deal_breakers),
    },
    real_goal: {
      primary: asString(realGoal['primary']) ?? base.real_goal.primary,
      degree_role: asString(realGoal['degree_role']) ?? base.real_goal.degree_role,
      post_graduation_intent:
        asString(realGoal['post_graduation_intent']) ?? base.real_goal.post_graduation_intent,
      scoring_profile:
        coerceEnum(realGoal['scoring_profile'], SCORING_PROFILES) ?? base.real_goal.scoring_profile,
    },
    custom_notes: mergeArr(asStringArray(raw['custom_notes']), base.custom_notes),
  };
}

function freshManifest(
  runId: string,
  scope: { fields: string[]; countries: CountryCode[]; intake: string },
  now: string,
): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: now,
    updated: now,
    scope: { ...scope, profile_ref: 'student-profile.json' },
    files: {
      universe: 'universe.json',
      catalog_shards_dir: 'catalog/',
      catalog_merged: 'catalog.json',
      scholarships: 'scholarships.json',
      results_scored: 'results_scored.json',
    },
    stage_status: {
      intake: 'complete',
      universe: 'pending',
      catalog: 'pending',
      enrichment: 'pending',
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 8 },
    log: [`${now} intake complete — profile captured, scope set`],
  };
}

function updateManifest(
  manifest: RunManifest,
  scope: { fields: string[]; countries: CountryCode[]; intake: string },
  now: string,
): { manifest: RunManifest; scopeChanged: boolean } {
  const scopeChanged =
    !sameSet(manifest.scope.fields, scope.fields) ||
    !sameSet(manifest.scope.countries, scope.countries);
  manifest.scope.fields = scope.fields;
  manifest.scope.countries = scope.countries;
  manifest.scope.intake = scope.intake;
  manifest.stage_status.intake = 'complete';
  manifest.updated = now;
  manifest.log.push(`${now} intake re-run — profile updated`);

  if (scopeChanged) {
    const downstream: (keyof StageStatusMap)[] = [
      'universe',
      'catalog',
      'enrichment',
      'scoring',
      'reporting',
    ];
    const affected = downstream.filter((s) => manifest.stage_status[s] !== 'pending');
    if (affected.length > 0) {
      logger.warn(
        `intake: the run scope changed — re-run these stages: ${affected.join(', ')}`,
      );
    }
  }
  return { manifest, scopeChanged };
}

async function defaultLlm(): Promise<LlmComplete> {
  const config = await new FileConfigStore().load();
  if (config.roles.worker.length === 0) {
    throw new ConfigError('no LLM model is configured for the "worker" role', {
      hint: 'run `finder setup` to configure a provider and model',
    });
  }
  return new RoutedLlmClient(config);
}

const COUNTRY_ALIASES: Record<string, CountryCode> = {
  uk: 'UK',
  'united kingdom': 'UK',
  britain: 'UK',
  'great britain': 'UK',
  england: 'UK',
  scotland: 'UK',
  wales: 'UK',
  gb: 'UK',
  us: 'US',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  canada: 'Canada',
  ca: 'Canada',
  australia: 'Australia',
  au: 'Australia',
  aus: 'Australia',
  germany: 'Germany',
  de: 'Germany',
  deutschland: 'Germany',
  netherlands: 'Netherlands',
  'the netherlands': 'Netherlands',
  holland: 'Netherlands',
  nl: 'Netherlands',
};

/** Resolve free-text country names to the six supported codes. */
function resolveCountries(raw: string[]): { valid: CountryCode[]; unknown: string[] } {
  const valid: CountryCode[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    const key = item.trim().toLowerCase().replace(/\./g, '');
    if (key.length === 0) continue;
    const code = COUNTRY_ALIASES[key];
    if (code) {
      if (!valid.includes(code)) valid.push(code);
    } else if (!unknown.includes(item.trim())) {
      unknown.push(item.trim());
    }
  }
  return { valid, unknown };
}

function intakeTermOf(profile: StudentProfile): string {
  return (profile.preferences.target_intake ?? '').trim() || 'unspecified';
}

function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

function mergeArr(extracted: string[], baseValue: string[]): string[] {
  return extracted.length > 0 ? extracted : baseValue;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asNonNegInt(value: unknown): number | null {
  const n = asNumber(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
