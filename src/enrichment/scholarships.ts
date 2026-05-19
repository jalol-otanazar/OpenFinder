import { slug } from '../core/ids.js';
import { logger } from '../core/logger.js';
import {
  ScholarshipShardSchema,
  type FunderType,
  type ScholarshipRecord,
  type ScholarshipShard,
  type ScholarshipType,
} from '../core/types/scholarship-record.js';
import type { CountryCode } from '../core/types/registry.js';
import { type LlmComplete, asString, asStringArray, parseJsonArray, truncate } from '../llm/parse.js';
import type { Fetcher } from '../tools/fetcher.js';
import { htmlToText } from '../tools/html.js';
import type { SearchClient, SearchResult } from '../tools/search.js';
import type { Store } from '../storage/store.js';

/**
 * The `enrichment` scholarship sub-pass (skills/enrichment.skill.md). One task
 * gathers the scholarships in scope for one destination country, or — when a
 * nationality is known — the student's home-country government/foundation
 * schemes. Search + fetch + LLM-extract, then a shard on disk. Records carry
 * full `eligibility` so `scoring` can match them to the student later.
 */

export type ScholarshipTaskKind = 'destination' | 'home-country';

/** One unit of scholarship gathering. */
export interface ScholarshipTask {
  runId: string;
  taskId: string;
  kind: ScholarshipTaskKind;
  /** Country of study — set for destination tasks. */
  country: CountryCode | null;
  /** Student nationality — set for the home-country task. */
  nationality: string | null;
  /** Absolute path the task writes its shard to. */
  shardPath: string;
}

export interface ScholarshipWorkerResult {
  taskId: string;
  shardPath: string;
  scholarshipsFound: number;
  llmCallsUsed: number;
}

export interface ScholarshipWorker {
  run(task: ScholarshipTask): Promise<ScholarshipWorkerResult>;
}

export interface LlmScholarshipWorkerDeps {
  llm: LlmComplete;
  fetcher: Fetcher;
  search: SearchClient;
  store: Store;
}

const MAX_RESULTS_PER_QUERY = 6;
const MAX_PAGES = 5;
const PER_PAGE_TEXT_LIMIT = 3500;
const EXTRACT_TEXT_LIMIT = 14_000;
const MAX_SCHOLARSHIPS = 40;

/** Code-orchestrated, fetch-grounded scholarship worker. */
export class LlmScholarshipWorker implements ScholarshipWorker {
  constructor(private readonly deps: LlmScholarshipWorkerDeps) {}

  async run(task: ScholarshipTask): Promise<ScholarshipWorkerResult> {
    const hits: SearchResult[] = [];
    for (const query of buildQueries(task)) {
      for (const hit of await this.deps.search.search(query, { maxResults: MAX_RESULTS_PER_QUERY })) {
        hits.push(hit);
      }
    }

    const pages: { url: string; text: string }[] = [];
    for (const url of [...new Set(hits.map((h) => h.url))].slice(0, MAX_PAGES)) {
      const page = await this.fetchText(url);
      if (page) pages.push(page);
    }

    let scholarships: ScholarshipRecord[] = [];
    let llmCallsUsed = 0;
    if (hits.length > 0 || pages.length > 0) {
      scholarships = await this.extract(task, hits, pages);
      llmCallsUsed = 1;
    }

    const shard: ScholarshipShard = {
      schema_version: '1.0',
      run_id: task.runId,
      task_id: task.taskId,
      generated: today(),
      scholarships,
    };
    await this.deps.store.writeJson(task.shardPath, shard, ScholarshipShardSchema);

    return {
      taskId: task.taskId,
      shardPath: task.shardPath,
      scholarshipsFound: scholarships.length,
      llmCallsUsed,
    };
  }

  private async fetchText(url: string): Promise<{ url: string; text: string } | null> {
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
      const text = htmlToText(res.text());
      return text.length > 0 ? { url, text } : null;
    } catch (err) {
      logger.debug(`scholarship worker: fetch failed for ${url} (${describe(err)})`);
      return null;
    }
  }

  private async extract(
    task: ScholarshipTask,
    hits: SearchResult[],
    pages: { url: string; text: string }[],
  ): Promise<ScholarshipRecord[]> {
    const snippets = hits
      .map((h) => `- ${h.title} | ${h.url}\n  ${h.snippet}`)
      .join('\n');
    const corpus = truncate(
      pages
        .map((p) => `=== PAGE: ${p.url} ===\n${truncate(p.text, PER_PAGE_TEXT_LIMIT)}`)
        .join('\n\n'),
      EXTRACT_TEXT_LIMIT,
    );
    const system =
      'You extract scholarship and funding schemes from web search results and ' +
      'official funding pages. Respond ONLY with a JSON array — no prose.';
    const user =
      `${taskBrief(task)}\n\n` +
      'From the search results and page text below, list every relevant scholarship. ' +
      'For each return an object: {"name": string, "funder": string, "funder_type": ' +
      '"national-government"|"university"|"intergovernmental"|"private"|"research-council", ' +
      '"type": "full"|"partial"|"tuition-only"|"fee-discount", "eligibility": ' +
      '{"nationalities": string[], "countries_of_study": string[], "degree_levels": ' +
      'string[], "other_conditions": string[]}, "value": {"covers": string[], ' +
      '"amount_note": string|null}, "application": {"deadline": string|null, "portal": ' +
      'string|null, "linked_to_program_admission": boolean|null}, "source_url": string}. ' +
      'Use only schemes named in the material; never invent. JSON array only.\n\n' +
      `Search results:\n${snippets}\n\nPage text:\n${corpus}`;

    const result = await this.deps.llm.complete('worker', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 3000,
      temperature: 0,
    });

    const defaultSources = pages.map((p) => p.url);
    const confidence = pages.length > 0 ? 'web-verified' : 'model-knowledge';
    const scholarships: ScholarshipRecord[] = [];
    const seen = new Set<string>();
    for (const value of parseJsonArray(result.text)) {
      const record = coerceScholarship(value, defaultSources, confidence);
      if (!record || seen.has(record.id)) continue;
      seen.add(record.id);
      scholarships.push(record);
      if (scholarships.length >= MAX_SCHOLARSHIPS) break;
    }
    return scholarships;
  }
}

/** The search queries for a task. */
function buildQueries(task: ScholarshipTask): string[] {
  if (task.kind === 'home-country' && task.nationality) {
    const n = task.nationality;
    return [
      `${n} government scholarship study abroad masters PhD`,
      `${n} foundation scholarship overseas international graduate study`,
    ];
  }
  const c = task.country ?? '';
  return [
    `scholarships for international graduate students in ${c}`,
    `${c} government scholarship international students masters PhD funding`,
  ];
}

/** A one-line brief that scopes the extraction prompt. */
function taskBrief(task: ScholarshipTask): string {
  if (task.kind === 'home-country' && task.nationality) {
    return `Scope: government, foundation, and research-council scholarships funded for ${task.nationality} citizens to study a graduate degree abroad.`;
  }
  return `Scope: scholarships open to international students for a graduate degree in ${task.country ?? 'the destination country'} — national-government, university, and intergovernmental schemes.`;
}

function coerceScholarship(
  value: unknown,
  defaultSources: string[],
  confidence: 'web-verified' | 'model-knowledge',
): ScholarshipRecord | null {
  if (!isRecord(value)) return null;
  const name = asString(value['name']);
  if (!name) return null;
  const id = slug(name);
  if (id.length === 0) return null;

  const eligibility = isRecord(value['eligibility']) ? value['eligibility'] : {};
  const money = isRecord(value['value']) ? value['value'] : {};
  const application = isRecord(value['application']) ? value['application'] : {};
  const sourceUrl = asString(value['source_url']);
  const sourceUrls = [...new Set([sourceUrl, ...defaultSources].filter((u): u is string => !!u))];

  return {
    schema_version: '1.0',
    id,
    name,
    funder: asString(value['funder']) ?? '',
    funder_type: coerceFunderType(value['funder_type']),
    type: coerceScholarshipType(value['type']),
    eligibility: {
      nationalities: asStringArray(eligibility['nationalities']),
      countries_of_study: asStringArray(eligibility['countries_of_study']),
      degree_levels: asStringArray(eligibility['degree_levels']),
      other_conditions: asStringArray(eligibility['other_conditions']),
    },
    value: {
      covers: asStringArray(money['covers']),
      amount_note: asString(money['amount_note']),
    },
    application: {
      deadline: asString(application['deadline']),
      portal: asString(application['portal']),
      linked_to_program_admission:
        typeof application['linked_to_program_admission'] === 'boolean'
          ? application['linked_to_program_admission']
          : null,
    },
    provenance: {
      source_urls: sourceUrls,
      last_verified: today(),
      source_confidence: confidence,
      verification_notes:
        'Gathered by the enrichment scholarship pass; scheme cycles and eligibility drift — confirm the current cycle at source.',
    },
  };
}

function coerceFunderType(value: unknown): FunderType {
  return value === 'national-government' ||
    value === 'university' ||
    value === 'intergovernmental' ||
    value === 'research-council'
    ? value
    : 'private';
}

function coerceScholarshipType(value: unknown): ScholarshipType {
  return value === 'full' || value === 'tuition-only' || value === 'fee-discount'
    ? value
    : 'partial';
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
