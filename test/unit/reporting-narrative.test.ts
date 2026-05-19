import { describe, expect, it } from 'vitest';
import {
  renderCountryBriefs,
  renderDeadlineCalendar,
  renderGapReport,
} from '../../src/reporting/narrative.js';
import type { ProgramRecord } from '../../src/core/types/program-record.js';
import type { ScoredProgram } from '../../src/core/types/scored-program.js';
import { emptyStudentProfile, type StudentProfile } from '../../src/core/types/student-profile.js';
import type { LlmComplete } from '../../src/llm/parse.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const DEAD_LLM: LlmComplete = { complete: () => Promise.reject(new Error('llm down')) };
const PAGE = '<html><body><p>Official student visa and proof-of-funds information.</p></body></html>';

function scored(id: string, opts: Partial<ScoredProgram> = {}): ScoredProgram {
  return {
    program_id: id,
    institution_id: 'us_alpha',
    identity: { university: 'Alpha University', program: `Program ${id}`, country: 'US', degree_type: 'MSc' },
    eligibility: { verdict: 'PASS', reasoning: 'ok', must_confirm: [] },
    admission_chance: { bucket: 'Match', reasoning: 'ok' },
    academic_fit: { score: 3, reasoning: 'ok' },
    funding_fit: { score: 3, reasoning: 'ok' },
    location_fit: { score: 3, reasoning: 'ok' },
    visa: { score: 4, reasoning: 'F-1 visa with STEM OPT — strong work rights.' },
    logistics: { score: 3, reasoning: 'ok' },
    weighted_total: 60,
    recommendation_tier: 'Apply',
    summary: 'ok',
    ...opts,
  };
}

function programWithDeadline(id: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id,
    institution_id: 'us_alpha',
    identity: {
      university: 'Alpha University',
      program: `Program ${id}`,
      department: null,
      country: 'US',
      city: null,
      degree_type: 'MSc',
      language: null,
      duration_months: null,
    },
    requirements: null,
    logistics: {
      application_deadlines: ['2027-01-15'],
      intake_terms: [],
      application_fee: null,
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: null,
    outcomes: null,
    provenance: { source_urls: [], last_verified: '2026-05-19', source_confidence: 'web-verified', verification_notes: '' },
  };
}

describe('renderCountryBriefs', () => {
  it('produces a fetch-grounded brief from official pages', async () => {
    const brief = await renderCountryBriefs(
      {
        llm: new StubLlm(() => 'US student visa brief. Source: https://gov.test/visa.'),
        fetcher: new StubFetcher({ 'https://gov.test/visa': { body: PAGE } }),
        search: new StubSearch([
          { title: 'Visa', url: 'https://gov.test/visa', snippet: 'official' },
        ]),
      },
      ['US'],
      [],
      emptyStudentProfile('2026-05-19'),
    );
    expect(brief).toContain('## Per-country briefs');
    expect(brief).toContain('### US');
    expect(brief).toContain('https://gov.test/visa');
  });

  it('falls back to per-program visa reasoning when no pages can be fetched', async () => {
    const brief = await renderCountryBriefs(
      {
        llm: new StubLlm(() => 'unused'),
        fetcher: new StubFetcher({}),
        search: new StubSearch([]),
      },
      ['US'],
      [scored('p1')],
      emptyStudentProfile('2026-05-19'),
    );
    expect(brief).toContain('F-1 visa with STEM OPT');
    expect(brief).toContain('not web-verified');
  });
});

describe('renderGapReport', () => {
  it('synthesises a gap report from eligibility flags and profile gaps', async () => {
    const md = await renderGapReport(
      new StubLlm(() => 'High severity: take the English test.'),
      [scored('p1', { eligibility: { verdict: 'FAIL', reasoning: 'GPA below minimum', must_confirm: [] } })],
      emptyStudentProfile('2026-05-19'),
    );
    expect(md).toContain('## Personal gap report');
    expect(md).toContain('High severity');
  });

  it('falls back to the raw gap list when the LLM fails', async () => {
    const md = await renderGapReport(DEAD_LLM, [scored('p1')], emptyStudentProfile('2026-05-19'));
    expect(md).toContain('English-language test is not yet completed');
  });

  it('reports no gaps when the profile and scorecards are clean', async () => {
    const clean: StudentProfile = emptyStudentProfile('2026-05-19');
    clean.tests.english.status = 'completed';
    clean.references.count_confirmed = 3;
    const md = await renderGapReport(DEAD_LLM, [scored('p1')], clean);
    expect(md).toContain('No eligibility gaps');
  });
});

describe('renderDeadlineCalendar', () => {
  it('builds a calendar for the shortlisted programs', async () => {
    const md = await renderDeadlineCalendar(
      new StubLlm(() => 'Program p1: start by 2026-11-01.'),
      [scored('p1', { recommendation_tier: 'Priority' })],
      [programWithDeadline('p1')],
    );
    expect(md).toContain('## Deadline calendar');
    expect(md).toContain('start by 2026-11-01');
  });

  it('falls back to the raw deadline list when the LLM fails', async () => {
    const md = await renderDeadlineCalendar(
      DEAD_LLM,
      [scored('p1', { recommendation_tier: 'Priority' })],
      [programWithDeadline('p1')],
    );
    expect(md).toContain('2027-01-15');
    expect(md).toContain('Lead-time analysis needs the model');
  });

  it('says so when no shortlisted program has a deadline', async () => {
    const md = await renderDeadlineCalendar(DEAD_LLM, [scored('p1', { recommendation_tier: 'Do Not Apply' })], []);
    expect(md).toContain('No application deadlines');
  });
});
