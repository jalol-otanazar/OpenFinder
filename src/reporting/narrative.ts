import { logger } from '../core/logger.js';
import type { ProgramRecord } from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import type { ScoredProgram } from '../core/types/scored-program.js';
import type { StudentProfile } from '../core/types/student-profile.js';
import { type LlmComplete, asString, truncate } from '../llm/parse.js';
import type { Fetcher } from '../tools/fetcher.js';
import { htmlToText } from '../tools/html.js';
import type { SearchClient } from '../tools/search.js';

/**
 * The LLM-backed reporting deliverables — per-country briefs, the gap report,
 * and the deadline calendar. Each renderer is wrapped with a deterministic
 * fallback, so `reporting` always produces every section even with no LLM or a
 * dead key. The country brief is **fetch-grounded**: it pulls official
 * immigration pages and the brief cites them (rule 02 / rule 04.6).
 */

export interface CountryBriefDeps {
  llm: LlmComplete;
  fetcher: Fetcher;
  search: SearchClient;
}

const MAX_BRIEF_PAGES = 4;
const PER_PAGE_LIMIT = 3500;
const BRIEF_CORPUS_LIMIT = 12_000;

/** Per-country visa / funds / work-rights briefs, grounded in fetched pages. */
export async function renderCountryBriefs(
  deps: CountryBriefDeps,
  countries: CountryCode[],
  scored: ScoredProgram[],
  profile: StudentProfile,
): Promise<string> {
  const nationality = profile.identity.nationality ?? 'the student';
  const lines: string[] = [
    '## Per-country briefs',
    '',
    `Visa, proof-of-funds, and post-study work outlook for **${nationality}** students.`,
    '',
  ];

  for (const country of countries) {
    lines.push(`### ${country}`, '');
    try {
      lines.push(await briefForCountry(deps, country, nationality));
    } catch (err) {
      logger.warn(`reporting: ${country} brief used the fallback (${describe(err)})`);
      lines.push(fallbackBrief(country, nationality, scored));
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function briefForCountry(
  deps: CountryBriefDeps,
  country: CountryCode,
  nationality: string,
): Promise<string> {
  const queries = [
    `${country} student visa requirements international students`,
    `${country} student visa proof of funds amount`,
    `${country} post-study work visa graduates`,
  ];
  const urls: string[] = [];
  for (const query of queries) {
    for (const hit of await deps.search.search(query, { maxResults: 4 })) urls.push(hit.url);
  }

  const pages: { url: string; text: string }[] = [];
  for (const url of preferOfficial([...new Set(urls)])) {
    if (pages.length >= MAX_BRIEF_PAGES) break;
    const page = await fetchText(deps.fetcher, url);
    if (page) pages.push(page);
  }
  if (pages.length === 0) throw new Error('no official immigration pages could be fetched');

  const corpus = truncate(
    pages.map((p) => `=== SOURCE: ${p.url} ===\n${truncate(p.text, PER_PAGE_LIMIT)}`).join('\n\n'),
    BRIEF_CORPUS_LIMIT,
  );
  const system =
    'You write a concise graduate-student visa & immigration brief from official ' +
    'immigration-page text. Cite the source URLs you used inline. Respond in Markdown — ' +
    'no preamble, no JSON.';
  const user =
    `Today: ${today()}\nDestination country: ${country}\nStudent nationality: ${nationality}\n\n` +
    'From the official page text below, write a brief covering: the student visa process, ' +
    'the proof-of-funds amount required, typical processing time, post-study work rights, ' +
    'and any PR pathway. State a fact only if the pages support it; cite the source URL ' +
    'inline for each. End with: ' +
    `"_Verified ${today()} against the sources above — confirm with the official ` +
    'immigration authority before relying on it._"\n\n' +
    `Official page text:\n${corpus}`;

  const text = (await complete(deps.llm, system, user)).trim();
  if (text.length === 0) throw new Error('empty brief from the model');
  return text;
}

function fallbackBrief(country: CountryCode, nationality: string, scored: ScoredProgram[]): string {
  const notes = [
    ...new Set(
      scored
        .filter((s) => s.identity.country === country && s.visa.reasoning.trim().length > 0)
        .map((s) => s.visa.reasoning.trim()),
    ),
  ].slice(0, 5);
  const body =
    notes.length > 0
      ? notes.map((n) => `- ${n}`).join('\n')
      : '- No visa assessment was available for this country.';
  return (
    `_A web-sourced visa brief could not be generated for ${country}. ` +
    `From the per-program visa assessments for ${nationality} students:_\n${body}\n\n` +
    '_These are model assessments, not web-verified — confirm with the official ' +
    'immigration authority before relying on them._'
  );
}

/** The personal gap report — synthesised from eligibility flags + profile gaps. */
export async function renderGapReport(
  llm: LlmComplete,
  scored: ScoredProgram[],
  profile: StudentProfile,
): Promise<string> {
  const lines: string[] = ['## Personal gap report', ''];
  const gaps = collectGaps(scored, profile);
  if (gaps.length === 0) {
    lines.push('_No eligibility gaps were flagged across the scored programs._');
    return lines.join('\n');
  }

  try {
    const system =
      'You write a graduate-application gap report. Respond in Markdown — no preamble, no JSON.';
    const user =
      `Today: ${today()}\nIntended intake: ${profile.preferences.target_intake ?? 'unknown'}\n\n` +
      `Gaps identified for this applicant:\n${gaps.map((g) => `- ${g}`).join('\n')}\n\n` +
      'For each gap, give: a severity (high / medium / low), a realistic fix, and a ' +
      'target deadline relative to today. Group by severity, highest first.';
    const text = (await complete(llm, system, user)).trim();
    lines.push(text.length > 0 ? text : fallbackGaps(gaps));
  } catch (err) {
    logger.warn(`reporting: gap report used the fallback (${describe(err)})`);
    lines.push(fallbackGaps(gaps));
  }
  return lines.join('\n');
}

/** Aggregate the raw gap signals from the scorecards and the profile. */
function collectGaps(scored: ScoredProgram[], profile: StudentProfile): string[] {
  const gaps = new Set<string>();
  for (const s of scored) {
    if (s.eligibility.verdict === 'FAIL' && s.eligibility.reasoning.trim().length > 0) {
      gaps.add(`Eligibility failure seen: ${s.eligibility.reasoning.trim()}`);
    }
    for (const item of s.eligibility.must_confirm) {
      if (item.trim().length > 0) gaps.add(`To confirm: ${item.trim()}`);
    }
  }
  const english = profile.tests.english.status;
  if (english === null || !/done|complete|taken/i.test(english)) {
    gaps.add('English-language test is not yet completed.');
  }
  if (profile.tests.gre.status !== null && /plan/i.test(profile.tests.gre.status)) {
    gaps.add('GRE is planned but not yet taken.');
  }
  if (profile.references.count_confirmed === null || profile.references.count_confirmed < 2) {
    gaps.add('Fewer than two reference letters are confirmed.');
  }
  return [...gaps];
}

function fallbackGaps(gaps: string[]): string {
  return (
    `${gaps.map((g) => `- ${g}`).join('\n')}\n\n` +
    '_Severity and fix-by dates need the model; the raw gap list is shown above._'
  );
}

/** The deadline calendar for the shortlisted programs. */
export async function renderDeadlineCalendar(
  llm: LlmComplete,
  scored: ScoredProgram[],
  catalog: ProgramRecord[],
): Promise<string> {
  const lines: string[] = ['## Deadline calendar', ''];
  const shortlisted = new Set(
    scored.filter((s) => s.recommendation_tier !== 'Do Not Apply').map((s) => s.program_id),
  );
  const entries = catalog
    .filter((p) => shortlisted.has(p.id))
    .map((p) => ({
      label: `${p.identity.program} — ${p.identity.university}`,
      deadlines: p.logistics?.application_deadlines ?? [],
    }))
    .filter((e) => e.deadlines.length > 0);

  if (entries.length === 0) {
    lines.push('_No application deadlines were recorded for the shortlisted programs._');
    return lines.join('\n');
  }

  try {
    const system =
      'You build a graduate-application deadline calendar. Respond in Markdown — no JSON.';
    const user =
      `Today: ${today()}.\n\nShortlisted programs and their application deadlines:\n` +
      entries.map((e) => `- ${e.label}: ${e.deadlines.join(' | ')}`).join('\n') +
      '\n\nInterpret each deadline (some are free-text or rolling). Counting backward by ' +
      'realistic document lead times — transcripts ~3-4 weeks, apostille/legalisation ' +
      '~2-4 weeks, language-test results ~2-3 weeks, reference letters ~2-3 weeks — give, ' +
      'per program, the latest safe start date, and flag any deadline no longer feasible ' +
      'from today. Sort soonest-first.';
    const text = (await complete(llm, system, user)).trim();
    lines.push(text.length > 0 ? text : fallbackCalendar(entries));
  } catch (err) {
    logger.warn(`reporting: deadline calendar used the fallback (${describe(err)})`);
    lines.push(fallbackCalendar(entries));
  }
  return lines.join('\n');
}

function fallbackCalendar(entries: { label: string; deadlines: string[] }[]): string {
  return (
    `${entries.map((e) => `- **${e.label}** — ${e.deadlines.join(' | ')}`).join('\n')}\n\n` +
    '_Lead-time analysis needs the model; the raw deadlines are listed above._'
  );
}

async function complete(llm: LlmComplete, system: string, user: string): Promise<string> {
  const result = await llm.complete('worker', {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 1600,
    temperature: 0,
  });
  return asString(result.text) ?? '';
}

async function fetchText(
  fetcher: Fetcher,
  url: string,
): Promise<{ url: string; text: string } | null> {
  try {
    const res = await fetcher.fetch({ url, timeoutMs: 20_000 });
    if (!res.ok) return null;
    const contentType = res.contentType.toLowerCase();
    if (
      contentType.length > 0 &&
      !contentType.includes('html') &&
      !contentType.includes('xml') &&
      !contentType.includes('text')
    ) {
      return null;
    }
    const text = htmlToText(res.text());
    return text.length > 0 ? { url, text } : null;
  } catch {
    return null;
  }
}

/** Sort official-looking hosts (immigration / government) first. */
function preferOfficial(urls: string[]): string[] {
  return [...urls].sort((a, b) => officialScore(b) - officialScore(a));
}

function officialScore(url: string): number {
  return /gov|immigration|gouv|govt/i.test(url) ? 1 : 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
