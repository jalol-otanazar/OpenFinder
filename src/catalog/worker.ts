import { makeProgramId } from '../core/ids.js';
import { logger } from '../core/logger.js';
import {
  CatalogShardSchema,
  type CatalogShard,
  type ProgramRecord,
} from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import type { InstitutionStatus, UniverseEntry } from '../core/types/universe.js';
import {
  type LlmComplete,
  asPositiveInt,
  asString,
  parseJsonArray,
  truncate,
} from '../llm/parse.js';
import { canonicalNameKey } from '../registry/normalize.js';
import type { Store } from '../storage/store.js';
import type { Fetcher } from '../tools/fetcher.js';
import { type PageLink, extractLinks, htmlToText } from '../tools/html.js';
import type { SearchClient } from '../tools/search.js';

/**
 * The `catalog` worker (skills/catalog.skill.md — per-worker procedure). One
 * worker processes one batch of institutions in an isolated unit of work: it
 * drives the bundled tools (fetcher + search) and the configured LLM, writes a
 * disk shard, and returns only a compact index — never the program data — so
 * the orchestrator's memory stays bounded (rules/03 §3.1–3.3).
 *
 * The loop is **code-orchestrated**: FInder code decides what to fetch; the LLM
 * is used only for plain-text reasoning (pick program-listing pages, extract
 * programs from page text). This keeps the worker model-agnostic — no provider
 * function-calling is required.
 */

/** A batch handed to a worker by the orchestrator. */
export interface CatalogBatch {
  runId: string;
  batchId: string;
  /** All institutions in a batch share one country (sliced for locality). */
  country: CountryCode;
  institutions: UniverseEntry[];
  /** Scoped fields of study, from run-manifest scope. */
  fields: string[];
  /** Intended intake term, from run-manifest scope. */
  intake: string;
  /** Max LLM completions this batch may spend (rules/03 §3.5). */
  llmCallBudget: number;
  /** Absolute path the worker writes its shard to. */
  shardPath: string;
}

/** A processed institution — compact, no program data (rules/03 §3.1). */
export interface InstitutionOutcome {
  id: string;
  /** Never `unchecked` — a reported institution was processed. */
  status: Exclude<InstitutionStatus, 'unchecked'>;
  programsFound: number;
}

/** What a worker returns to the orchestrator after writing its shard. */
export interface CatalogWorkerResult {
  batchId: string;
  shardPath: string;
  outcomes: InstitutionOutcome[];
  llmCallsUsed: number;
  /** True when the budget stopped the batch before every institution was done. */
  budgetExhausted: boolean;
}

/** The worker seam — a different discovery strategy can implement this later. */
export interface CatalogWorker {
  run(batch: CatalogBatch): Promise<CatalogWorkerResult>;
}

export interface LlmCatalogWorkerDeps {
  llm: LlmComplete;
  fetcher: Fetcher;
  search: SearchClient;
  store: Store;
}

const MAX_LLM_CALLS_PER_INSTITUTION = 2;
const MAX_CANDIDATE_PAGES = 5;
const MAX_HOMEPAGE_LINKS = 60;
const HOMEPAGE_TEXT_LIMIT = 5000;
const PER_PAGE_TEXT_LIMIT = 4000;
const EXTRACT_TEXT_LIMIT = 14_000;
const SEARCH_RESULTS = 5;

interface FetchedPage {
  url: string;
  text: string;
}

interface InstitutionResult {
  status: Exclude<InstitutionStatus, 'unchecked'>;
  programs: ProgramRecord[];
  llmCalls: number;
}

/** Code-orchestrated, fetch-grounded catalog worker. */
export class LlmCatalogWorker implements CatalogWorker {
  constructor(private readonly deps: LlmCatalogWorkerDeps) {}

  async run(batch: CatalogBatch): Promise<CatalogWorkerResult> {
    const programs: ProgramRecord[] = [];
    const outcomes: InstitutionOutcome[] = [];
    const usedIds = new Set<string>();
    let llmCallsUsed = 0;
    let budgetExhausted = false;

    for (const entry of batch.institutions) {
      // Reserve room for this institution before starting it (rules/03 §3.5).
      if (llmCallsUsed + MAX_LLM_CALLS_PER_INSTITUTION > batch.llmCallBudget) {
        budgetExhausted = true;
        break;
      }

      const result = await this.processInstitution(entry, batch);
      llmCallsUsed += result.llmCalls;

      for (const program of result.programs) {
        programs.push({ ...program, id: uniqueId(usedIds, program.id) });
      }
      outcomes.push({
        id: entry.id,
        status: result.status,
        programsFound: result.programs.length,
      });
    }

    const shard: CatalogShard = {
      schema_version: '1.0',
      run_id: batch.runId,
      batch_id: batch.batchId,
      generated: today(),
      programs,
    };
    await this.deps.store.writeJson(batch.shardPath, shard, CatalogShardSchema);

    return { batchId: batch.batchId, shardPath: batch.shardPath, outcomes, llmCallsUsed, budgetExhausted };
  }

  /** Discover the in-scope programs at one institution. Never throws. */
  private async processInstitution(
    entry: UniverseEntry,
    batch: CatalogBatch,
  ): Promise<InstitutionResult> {
    let llmCalls = 0;
    const homeUrl = entry.official_url.trim();
    const homepage = homeUrl.length > 0 ? await this.fetchPage(homeUrl) : null;

    // Candidate program-listing pages: official-site links chosen by the LLM,
    // unioned with a supplementary web search (skills/catalog — multi-source).
    const candidates: string[] = [];
    if (homepage) {
      const links = extractLinks(homepage.rawHtml, homepage.url, MAX_HOMEPAGE_LINKS);
      const selected = await this.selectProgramPages(entry, homepage.text, links, batch.fields);
      llmCalls += 1;
      candidates.push(...selected);
    }
    for (const hit of await this.searchProgramPages(entry, batch.fields)) {
      candidates.push(hit);
    }

    // Fetch the candidate union (capped), starting from the homepage text.
    const pages: FetchedPage[] = [];
    if (homepage) pages.push({ url: homepage.url, text: homepage.text });
    const seen = new Set<string>(pages.map((p) => p.url));
    for (const url of candidates) {
      if (pages.length >= MAX_CANDIDATE_PAGES + 1) break;
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await this.fetchPage(url);
      if (page) pages.push({ url: page.url, text: page.text });
    }

    if (pages.length === 0) {
      // Nothing could be fetched — not "no programs", genuinely unreachable.
      return { status: 'unreachable', programs: [], llmCalls };
    }

    const extracted = await this.extractPrograms(entry, pages, batch.fields, batch.intake);
    llmCalls += 1;

    const sourceUrls = pages.map((p) => p.url);
    const programs = this.toProgramRecords(entry, extracted, sourceUrls);
    return {
      status: programs.length > 0 ? 'checked' : 'no-programs',
      programs,
      llmCalls,
    };
  }

  /** Fetch one page → cleaned text + raw HTML. null on any failure / non-HTML. */
  private async fetchPage(
    url: string,
  ): Promise<{ url: string; text: string; rawHtml: string } | null> {
    try {
      const res = await this.deps.fetcher.fetch({ url, timeoutMs: 25_000 });
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
      const rawHtml = res.text();
      const text = htmlToText(rawHtml);
      return text.length > 0 ? { url, text, rawHtml } : null;
    } catch (err) {
      logger.debug(`catalog worker: fetch failed for ${url} (${describe(err)})`);
      return null;
    }
  }

  /** LLM call: choose program-listing URLs from the homepage's own links. */
  private async selectProgramPages(
    entry: UniverseEntry,
    homepageText: string,
    links: PageLink[],
    fields: string[],
  ): Promise<string[]> {
    if (links.length === 0) return [];
    const linkList = links.map((l) => `- ${l.text || '(no text)'} | ${l.url}`).join('\n');
    const system =
      'You identify which of a university website’s links lead to listings of its ' +
      'graduate (postgraduate) degree programs. Respond ONLY with a JSON array of URL ' +
      'strings copied verbatim from the provided list. No prose, no markdown.';
    const user =
      `University: ${entry.name}\nFields of interest: ${fields.join(', ')}\n\n` +
      `Homepage text excerpt:\n${truncate(homepageText, HOMEPAGE_TEXT_LIMIT)}\n\n` +
      `Links on the homepage:\n${linkList}\n\n` +
      `Return up to ${MAX_CANDIDATE_PAGES} URLs (from the list above) most likely to lead ` +
      'to listings of taught masters, research masters, or PhD programs — prefer ' +
      'postgraduate-study, course-catalog, and relevant department/school pages. JSON array only.';

    const text = await this.completeText(system, user);
    const linkSet = new Set(links.map((l) => l.url));
    const chosen: string[] = [];
    for (const value of parseJsonArray(text)) {
      const url = asString(value);
      // Only trust URLs that actually appeared on the page — no hallucinations.
      if (url && linkSet.has(url) && !chosen.includes(url)) chosen.push(url);
      if (chosen.length >= MAX_CANDIDATE_PAGES) break;
    }
    return chosen;
  }

  /** Supplementary web search for program-listing pages. Degrades to []. */
  private async searchProgramPages(entry: UniverseEntry, fields: string[]): Promise<string[]> {
    const query = `${entry.name} ${fields.join(' ')} graduate masters PhD programs`;
    const results = await this.deps.search.search(query, { maxResults: SEARCH_RESULTS });
    return results.map((r) => r.url).filter((u) => u.length > 0);
  }

  /** LLM call: extract program stubs from the fetched page text. */
  private async extractPrograms(
    entry: UniverseEntry,
    pages: FetchedPage[],
    fields: string[],
    intake: string,
  ): Promise<ExtractedProgram[]> {
    const corpus = truncate(
      pages.map((p) => `=== PAGE: ${p.url} ===\n${truncate(p.text, PER_PAGE_TEXT_LIMIT)}`).join('\n\n'),
      EXTRACT_TEXT_LIMIT,
    );
    const system =
      'You extract graduate (postgraduate) degree programs from university web-page ' +
      'text. Respond ONLY with a JSON array — no prose, no markdown.';
    const user =
      `University: ${entry.name}\nFields of interest: ${fields.join(', ')}\n` +
      `Intended intake: ${intake}\n\n` +
      'From the page text below, list every graduate degree program (taught masters, ' +
      'research masters, or PhD) relevant to the fields of interest. For each program ' +
      'return an object: {"program": string, "degree_type": string|null, ' +
      '"department": string|null, "language": string|null, "duration_months": ' +
      'number|null, "city": string|null}. Use only programs actually named in the text. ' +
      'If none are relevant, return []. JSON array only.\n\n' +
      `Page text:\n${corpus}`;

    const text = await this.completeText(system, user);
    const programs: ExtractedProgram[] = [];
    const seen = new Set<string>();
    for (const value of parseJsonArray(text)) {
      if (typeof value !== 'object' || value === null) continue;
      const obj = value as Record<string, unknown>;
      const program = asString(obj['program']);
      if (!program) continue;
      const key = canonicalNameKey(program);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      programs.push({
        program,
        degree_type: asString(obj['degree_type']),
        department: asString(obj['department']),
        language: asString(obj['language']),
        duration_months: asPositiveInt(obj['duration_months']),
        city: asString(obj['city']),
      });
    }
    return programs;
  }

  private toProgramRecords(
    entry: UniverseEntry,
    extracted: ExtractedProgram[],
    sourceUrls: string[],
  ): ProgramRecord[] {
    const verified = today();
    return extracted.map((p) => ({
      schema_version: '1.0' as const,
      id: makeProgramId(entry.id, p.program),
      institution_id: entry.id,
      identity: {
        university: entry.name,
        program: p.program,
        department: p.department,
        country: entry.country,
        city: p.city,
        degree_type: p.degree_type,
        language: p.language,
        duration_months: p.duration_months,
      },
      requirements: null,
      logistics: null,
      cost_and_funding: null,
      outcomes: null,
      provenance: {
        source_urls: sourceUrls,
        last_verified: verified,
        source_confidence: 'web-verified' as const,
        verification_notes: 'Identity extracted from fetched institution / search-result pages.',
      },
    }));
  }

  private async completeText(system: string, user: string): Promise<string> {
    const result = await this.deps.llm.complete('worker', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 2000,
      temperature: 0,
    });
    return result.text;
  }
}

interface ExtractedProgram {
  program: string;
  degree_type: string | null;
  department: string | null;
  language: string | null;
  duration_months: number | null;
  city: string | null;
}

function uniqueId(used: Set<string>, base: string): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
