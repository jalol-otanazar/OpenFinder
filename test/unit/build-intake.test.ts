import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIntake } from '../../src/intake/build-intake.js';
import type { IntakeChoice, IntakePrompter } from '../../src/intake/prompter.js';
import { BlockingError } from '../../src/core/errors.js';
import { RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { StudentProfileSchema } from '../../src/core/types/student-profile.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm } from '../helpers/catalog-stubs.js';

/** A scripted prompter — text/choice answers consumed in order. */
class StubPrompter implements IntakePrompter {
  public asked: string[] = [];

  constructor(
    private readonly textAnswers: string[],
    private readonly choiceAnswers: string[] = [],
    private readonly confirmAnswer = true,
  ) {}

  askText(question: string): Promise<string> {
    this.asked.push(question);
    return Promise.resolve(this.textAnswers.shift() ?? '');
  }

  askConfirm(question: string): Promise<boolean> {
    this.asked.push(question);
    return Promise.resolve(this.confirmAnswer);
  }

  askChoice(question: string, _choices: IntakeChoice[]): Promise<string> {
    this.asked.push(question);
    return Promise.resolve(this.choiceAnswers.shift() ?? '');
  }
}

const FULL_EXTRACTION = {
  identity: { nationality: 'Uzbek', country_of_residence: 'Uzbekistan', languages: ['Uzbek', 'English'] },
  preferences: { target_countries: ['US', 'UK'], fields: ['Computer Science'], target_intake: 'Fall 2027' },
  real_goal: { primary: 'relocate to a tech hub', scoring_profile: 'program-as-vehicle' },
  financial: { funding_need: 'fully_funded' },
  custom_notes: ['Location and funding outweigh prestige.'],
};

describe('runIntake', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-intake-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts a profile and writes the manifest non-interactively from --prompt', async () => {
    const result = await runIntake(
      'run-1',
      { prompt: 'I am an Uzbek student who wants a funded CS masters in the US or UK to relocate.' },
      { store, llm: new StubLlm(() => JSON.stringify(FULL_EXTRACTION)) },
    );

    expect(result.interactive).toBe(false);
    expect(result.followUpsAsked).toBe(0);
    expect(result.fields).toEqual(['Computer Science']);
    expect(result.countries).toEqual(['US', 'UK']);
    expect(result.intake).toBe('Fall 2027');

    const runDir = store.resolveRunDir('run-1');
    const profile = await store.readJson(join(runDir, 'student-profile.json'), StudentProfileSchema);
    expect(profile.identity.nationality).toBe('Uzbek');
    expect(profile.real_goal.scoring_profile).toBe('program-as-vehicle');

    const manifest = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(manifest.stage_status.intake).toBe('complete');
    expect(manifest.stage_status.universe).toBe('pending');
    expect(manifest.scope.countries).toEqual(['US', 'UK']);
  });

  it('throws when no field or country can be determined non-interactively', async () => {
    await expect(
      runIntake(
        'run-2',
        { prompt: 'Hello, I am thinking about graduate school someday.' },
        { store, llm: new StubLlm(() => '{}') },
      ),
    ).rejects.toThrow(BlockingError);
  });

  it('asks a follow-up for each missing blocking field interactively', async () => {
    const prompter = new StubPrompter(
      ['I want to study abroad.', 'Computer Science', 'US, Canada', 'Uzbek'],
      ['program-as-vehicle', 'fully_funded'],
      true,
    );
    const result = await runIntake(
      'run-3',
      {},
      { store, llm: new StubLlm(() => '{}'), prompter },
    );

    expect(result.interactive).toBe(true);
    expect(result.followUpsAsked).toBe(5);
    expect(result.fields).toEqual(['Computer Science']);
    expect(result.countries).toEqual(['US', 'Canada']);

    const runDir = store.resolveRunDir('run-3');
    const profile = await store.readJson(join(runDir, 'student-profile.json'), StudentProfileSchema);
    expect(profile.identity.nationality).toBe('Uzbek');
    expect(profile.real_goal.scoring_profile).toBe('program-as-vehicle');
    expect(profile.financial.funding_need).toBe('fully_funded');
  });

  it('merges a re-run into the existing profile, preserving prior fields', async () => {
    await runIntake(
      'run-4',
      { prompt: 'Uzbek student, funded CS masters, US or UK, to relocate.' },
      { store, llm: new StubLlm(() => JSON.stringify(FULL_EXTRACTION)) },
    );

    const result = await runIntake(
      'run-4',
      { prompt: 'Update: I can now take the Duolingo English Test.' },
      {
        store,
        llm: new StubLlm(() => JSON.stringify({ tests: { english: { status: 'planned', test_type: 'Duolingo' } } })),
      },
    );
    expect(result.scopeChanged).toBe(false);

    const runDir = store.resolveRunDir('run-4');
    const profile = await store.readJson(join(runDir, 'student-profile.json'), StudentProfileSchema);
    expect(profile.tests.english.status).toBe('planned');
    expect(profile.preferences.fields).toEqual(['Computer Science']); // preserved
    expect(profile.identity.nationality).toBe('Uzbek'); // preserved
  });

  it('drops unsupported countries and keeps the supported ones', async () => {
    const result = await runIntake(
      'run-5',
      { prompt: 'CS masters in the US and France.' },
      {
        store,
        llm: new StubLlm(() =>
          JSON.stringify({ preferences: { fields: ['Computer Science'], target_countries: ['US', 'France'] } }),
        ),
      },
    );
    expect(result.countries).toEqual(['US']);
  });
});
