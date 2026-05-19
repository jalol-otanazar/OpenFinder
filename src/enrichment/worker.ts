import { logger } from '../core/logger.js';
import {
  CatalogShardSchema,
  type CatalogShard,
  type CostAndFunding,
  type FundingLikelihood,
  type Logistics,
  type Outcomes,
  type ProgramRecord,
  type Requirements,
  type SourceConfidence,
} from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import {
  type LlmComplete,
  asPositiveInt,
  asString,
  asStringArray,
  parseJsonArray,
  parseJsonObject,
  truncate,
} from '../llm/parse.js';
import type { Fetcher } from '../tools/fetcher.js';
import { extractLinks, htmlToText, type PageLink } from '../tools/html.js';
import type { SearchClient } from '../tools/search.js';
import type { Store } from '../storage/store.js';

/**
 * The `enrichment` worker (skills/enrichment.skill.md — per-worker procedure).
 * One worker takes a batch of program *stubs* and fills the `requirements`,
 * `logistics`, `cost_and_funding`, and `outcomes` sections from official pages.
 * Code-orchestrated like the catalog worker: FInder code drives fetch + search;
 * the LLM only reasons over plain text. It writes a disk shard and returns a
 * compact index (rules/03 §3.1–3.3).
 */

/** A program stub plus its institution's official URL (from universe.json). */
export interface EnrichmentTarget {
  program: ProgramRecord;
  officialUrl: string;
}

/** A batch handed to an enrichment worker by the orchestrator. */
export interface EnrichmentBatch {
  runId: string;
  batchId: string;
  country: CountryCode;
  targets: EnrichmentTarget[];
  fields: string[];
  intake: string;
  /** Max LLM completions this batch may spend (rules/03 §3.5). */
  llmCallBudget: number;
  /** Absolute path the worker writes its shard to. */
  shardPath: string;
}

/** What a worker returns after writing its shard — compact, no record data. */
export interface EnrichmentWorkerResult {
  batchId: string;
  shardPath: string;
  /** Program ids enriched in this batch. */
  programIds: string[];
  llmCallsUsed: number;
  /** True when the budget stopped the batch before every program was done. */
  budgetExhausted: boolean;
}

/** The worker seam — a different enrichment strategy can implement this later. */
export interface EnrichmentWorker {
  run(batch: EnrichmentBatch): Promise<EnrichmentWorkerResult>;
}

export interface LlmEnrichmentWorkerDeps {
  llm: LlmComplete;
  fetcher: Fetcher;
  search: SearchClient;
  store: Store;
}

const MAX_LLM_CALLS_PER_PROGRAM = 2;
const MAX_PAGES = 6;
const MAX_HOMEPAGE_LINKS = 60;
const MAX_SELECTED = 4;
const HOMEPAGE_TEXT_LIMIT = 4000;
const PER_PAGE_TEXT_LIMIT = 4000;
const EXTRACT_TEXT_LIMIT = 16_000;
const SEARCH_RESULTS = 4;

interface FetchedPage {
  url: string;
  text: string;
  rawHtml: string;
}

/** Code-orchestrated, fetch-grounded enrichment worker. */
export class LlmEnrichmentWorker implements EnrichmentWorker {
  constructor(private readonly deps: LlmEnrichmentWorkerDeps) {}

  async run(batch: EnrichmentBatch): Promise<EnrichmentWorkerResult> {
    const enriched: ProgramRecord[] = [];
    const programIds: string[] = [];
    let llmCallsUsed = 0;
    let budgetExhausted = false;

    for (const target of batch.targets) {
      if (llmCallsUsed + MAX_LLM_CALLS_PER_PROGRAM > batch.llmCallBudget) {
        budgetExhausted = true;
        break;
      }
      const result = await this.enrichProgram(target, batch);
      llmCallsUsed += result.llmCalls;
      enriched.push(result.record);
      programIds.push(result.record.id);
    }

    const shard: CatalogShard = {
      schema_version: '1.0',
      run_id: batch.runId,
      batch_id: batch.batchId,
      generated: today(),
      programs: enriched,
    };
    await this.deps.store.writeJson(batch.shardPath, shard, CatalogShardSchema);

    return { batchId: batch.batchId, shardPath: batch.shardPath, programIds, llmCallsUsed, budgetExhausted };
  }

  /** Fill one program's detail sections. Never throws on a fetch failure. */
  private async enrichProgram(
    target: EnrichmentTarget,
    batch: EnrichmentBatch,
  ): Promise<{ record: ProgramRecord; llmCalls: number }> {
    let llmCalls = 0;
    const { program, officialUrl } = target;

    // Candidate pages: the catalog-found program pages first, then official-site
    // admissions/fees/funding pages chosen from the homepage, then web search.
    const candidates: string[] = [...program.provenance.source_urls];

    const home = officialUrl.trim();
    const homepage = home.length > 0 ? await this.fetchPage(home) : null;
    if (homepage) {
      const links = extractLinks(homepage.rawHtml, homepage.url, MAX_HOMEPAGE_LINKS);
      candidates.push(...(await this.selectPages(program, homepage.text, links, batch.fields)));
      llmCalls += 1;
    }
    candidates.push(...(await this.searchPages(program)));

    const pages: FetchedPage[] = [];
    const seen = new Set<string>();
    if (homepage) {
      pages.push(homepage);
      seen.add(homepage.url);
    }
    for (const url of candidates) {
      if (pages.length >= MAX_PAGES) break;
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await this.fetchPage(url);
      if (page) pages.push(page);
    }

    let detail: Record<string, unknown> = {};
    if (pages.length > 0) {
      detail = await this.extractDetail(program, pages, batch);
      llmCalls += 1;
    }

    return { record: toEnrichedRecord(program, detail, pages), llmCalls };
  }

  /** Fetch one page → text + raw HTML. null on any failure / non-HTML content. */
  private async fetchPage(url: string): Promise<FetchedPage | null> {
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
      logger.debug(`enrichment worker: fetch failed for ${url} (${describe(err)})`);
      return null;
    }
  }

  /** LLM call: pick admissions / fees / funding pages from the homepage links. */
  private async selectPages(
    program: ProgramRecord,
    homepageText: string,
    links: PageLink[],
    fields: string[],
  ): Promise<string[]> {
    if (links.length === 0) return [];
    const linkList = links.map((l) => `- ${l.text || '(no text)'} | ${l.url}`).join('\n');
    const system =
      'You identify which of a university website’s links lead to graduate ' +
      'admissions, tuition/fees, and funding/scholarship pages. Respond ONLY with a ' +
      'JSON array of URL strings copied verbatim from the provided list. No prose.';
    const user =
      `University: ${program.identity.university}\n` +
      `Program: ${program.identity.program}\nFields: ${fields.join(', ')}\n\n` +
      `Homepage text excerpt:\n${truncate(homepageText, HOMEPAGE_TEXT_LIMIT)}\n\n` +
      `Links on the homepage:\n${linkList}\n\n` +
      `Return up to ${MAX_SELECTED} URLs (from the list) most likely to carry graduate ` +
      'admission requirements, tuition/fees, or funding/scholarship detail. JSON array only.';

    const linkSet = new Set(links.map((l) => l.url));
    const chosen: string[] = [];
    for (const value of parseJsonArray(await this.completeText(system, user))) {
      const url = asString(value);
      if (url && linkSet.has(url) && !chosen.includes(url)) chosen.push(url);
      if (chosen.length >= MAX_SELECTED) break;
    }
    return chosen;
  }

  /** Supplementary web search for the program's admissions / funding pages. */
  private async searchPages(program: ProgramRecord): Promise<string[]> {
    const query =
      `${program.identity.university} ${program.identity.program} ` +
      'admission requirements tuition funding';
    const results = await this.deps.search.search(query, { maxResults: SEARCH_RESULTS });
    return results.map((r) => r.url).filter((u) => u.length > 0);
  }

  /** LLM call: extract the four detail sections from the fetched page text. */
  private async extractDetail(
    program: ProgramRecord,
    pages: FetchedPage[],
    batch: EnrichmentBatch,
  ): Promise<Record<string, unknown>> {
    const corpus = truncate(
      pages
        .map((p) => `=== PAGE: ${p.url} ===\n${truncate(p.text, PER_PAGE_TEXT_LIMIT)}`)
        .join('\n\n'),
      EXTRACT_TEXT_LIMIT,
    );
    const system =
      'You extract graduate-program admission, cost, funding, and outcome facts from ' +
      'official university web-page text. Respond ONLY with a JSON object — no prose.';
    const user =
      `University: ${program.identity.university}\n` +
      `Program: ${program.identity.program} (${program.identity.degree_type ?? 'degree'})\n` +
      `Intended intake: ${batch.intake}\n\n` +
      'From the page text below, return a JSON object with these keys (use null / [] ' +
      'when a fact is not stated — never invent):\n' +
      '{"requirements": {"min_gpa": {"raw": string, "us_4_0_equivalent": number|null}|null, ' +
      '"required_background": string|null, "prerequisites": string[], "gre": string|null, ' +
      '"english_tests": {"ielts": string|null, "toefl": string|null, "duolingo": string|null, ' +
      '"pte": string|null}|null, "english_waiver": {"available": boolean, "basis": string, ' +
      '"confidence": "web-verified"}|null, "reference_letters": number|null, ' +
      '"other_documents": string[]}, ' +
      '"logistics": {"application_deadlines": string[], "intake_terms": string[], ' +
      '"application_fee": string|null, "application_portal": string|null, ' +
      '"decision_timeline": string|null}, ' +
      '"cost_and_funding": {"tuition_international": {"amount": number, "currency": string, ' +
      '"period": string}|null, "living_cost_estimate": {"amount": number, "currency": string, ' +
      '"period": string}|null, "scholarships_for_internationals": string[], ' +
      '"funding_likelihood": "full"|"partial"|"none"|"unknown", "fully_funded": boolean}, ' +
      '"outcomes": {"field_ranking": string|null, "post_study_work_rights": string|null, ' +
      '"placement_info": string|null}, ' +
      '"conflict_notes": string}. ' +
      'For english_tests, OMIT a test (leave null) if the page does not list it — absence ' +
      'is meaningful. If two pages disagree on a fact, describe it in conflict_notes. ' +
      'JSON object only.\n\n' +
      `Page text:\n${corpus}`;

    return parseJsonObject(await this.completeText(system, user));
  }

  private async completeText(system: string, user: string): Promise<string> {
    const result = await this.deps.llm.complete('worker', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 2500,
      temperature: 0,
    });
    return result.text;
  }
}

/** Build the enriched record — all four sections present, even if sparse. */
function toEnrichedRecord(
  program: ProgramRecord,
  detail: Record<string, unknown>,
  pages: FetchedPage[],
): ProgramRecord {
  const pageUrls = pages.map((p) => p.url);
  const sourceUrls = [...new Set([...program.provenance.source_urls, ...pageUrls])];
  const verified = pageUrls.length > 0;
  const conflict = asString(detail['conflict_notes']);

  return {
    ...program,
    requirements: coerceRequirements(detail['requirements']),
    logistics: coerceLogistics(detail['logistics']),
    cost_and_funding: coerceCostAndFunding(detail['cost_and_funding']),
    outcomes: coerceOutcomes(detail['outcomes']),
    provenance: {
      source_urls: sourceUrls,
      last_verified: today(),
      source_confidence: verified ? 'web-verified' : 'model-knowledge',
      verification_notes: verified
        ? `Detail enriched from ${pageUrls.length} fetched page(s).` +
          (conflict ? ` Source conflict: ${conflict}` : '')
        : 'Official pages were unreachable — detail sections could not be verified this run.',
    },
  };
}

function coerceRequirements(value: unknown): Requirements {
  const o = isRecord(value) ? value : {};
  return {
    min_gpa: coerceMinGpa(o['min_gpa']),
    required_background: asString(o['required_background']),
    prerequisites: asStringArray(o['prerequisites']),
    gre: asString(o['gre']),
    english_tests: coerceEnglishTests(o['english_tests']),
    english_waiver: coerceEnglishWaiver(o['english_waiver']),
    reference_letters: asPositiveInt(o['reference_letters']),
    other_documents: asStringArray(o['other_documents']),
  };
}

function coerceMinGpa(value: unknown): Requirements['min_gpa'] {
  if (!isRecord(value)) return null;
  const raw = asString(value['raw']);
  const eq = typeof value['us_4_0_equivalent'] === 'number' ? value['us_4_0_equivalent'] : null;
  if (raw === null && eq === null) return null;
  return { raw: raw ?? '', us_4_0_equivalent: eq };
}

function coerceEnglishTests(value: unknown): Requirements['english_tests'] {
  if (!isRecord(value)) return null;
  const tests = {
    ielts: asString(value['ielts']),
    toefl: asString(value['toefl']),
    duolingo: asString(value['duolingo']),
    pte: asString(value['pte']),
  };
  return tests.ielts ?? tests.toefl ?? tests.duolingo ?? tests.pte ? tests : null;
}

function coerceEnglishWaiver(value: unknown): Requirements['english_waiver'] {
  if (!isRecord(value)) return null;
  if (typeof value['available'] !== 'boolean') return null;
  return {
    available: value['available'],
    basis: asString(value['basis']) ?? '',
    confidence: coerceConfidence(value['confidence']),
  };
}

function coerceLogistics(value: unknown): Logistics {
  const o = isRecord(value) ? value : {};
  return {
    application_deadlines: asStringArray(o['application_deadlines']),
    intake_terms: asStringArray(o['intake_terms']),
    application_fee: asString(o['application_fee']),
    application_portal: asString(o['application_portal']),
    decision_timeline: asString(o['decision_timeline']),
  };
}

function coerceCostAndFunding(value: unknown): CostAndFunding {
  const o = isRecord(value) ? value : {};
  return {
    tuition_international: coerceMoney(o['tuition_international']),
    living_cost_estimate: coerceMoney(o['living_cost_estimate']),
    scholarships_for_internationals: asStringArray(o['scholarships_for_internationals']),
    funding_likelihood: coerceFundingLikelihood(o['funding_likelihood']),
    fully_funded: typeof o['fully_funded'] === 'boolean' ? o['fully_funded'] : false,
  };
}

function coerceMoney(value: unknown): CostAndFunding['tuition_international'] {
  if (!isRecord(value)) return null;
  if (typeof value['amount'] !== 'number') return null;
  return {
    amount: value['amount'],
    currency: asString(value['currency']) ?? '',
    period: asString(value['period']) ?? '',
  };
}

function coerceOutcomes(value: unknown): Outcomes {
  const o = isRecord(value) ? value : {};
  return {
    field_ranking: asString(o['field_ranking']),
    post_study_work_rights: asString(o['post_study_work_rights']),
    placement_info: asString(o['placement_info']),
  };
}

function coerceFundingLikelihood(value: unknown): FundingLikelihood {
  return value === 'full' || value === 'partial' || value === 'none' ? value : 'unknown';
}

function coerceConfidence(value: unknown): SourceConfidence {
  return value === 'model-knowledge' || value === 'community' ? value : 'web-verified';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
