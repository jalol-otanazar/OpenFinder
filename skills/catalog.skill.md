# Skill: Catalog

> Pipeline stage 3 of 6. Finds the in-scope programs at every institution in the universe.

## Purpose

For every `unchecked` institution in `universe.json`, discover the graduate programs it
offers in the scoped field, and write a stub program record for each. The output is the
raw catalog — identity only; deep detail comes in `enrichment`.

## Inputs

- `universe.json` — the institution checklist from `universe`.
- Scope (field, intake) from `run-manifest.json`.

## Outputs

- `catalog/<batch-id>.json` — one shard per worker batch, each an array of program record
  stubs (see `schemas/program-record.md` — `identity` + `institution_id` + provenance stub).
- Updated `universe.json` — each processed institution flipped to `checked` /
  `no-programs` / `unreachable`, with `programs_found`.
- Updated `run-manifest.json` — batch log + per-country coverage.

## Procedure (orchestrator)

1. **Slice the universe.** Group `unchecked` entries into batches (`default_batch_size`,
   typically 6–10 institutions), sliced by country/region for locality.
2. **Dispatch with bounded concurrency.** Run at most `max_parallel_workers` (default 2)
   at once. Each worker gets a per-batch tool-call budget (default ~25).
3. **Collect compact results only.** A worker returns a one-line status; its actual output
   is the shard it wrote to disk. The orchestrator's working memory holds only the
   profile + a small index — never the program data itself.
4. **Update state immediately** after each batch: flip universe statuses, append to the
   manifest batch log, refresh coverage counts.
5. **Repeat** until no `unchecked` entries remain.
6. **Merge + dedupe** all shards into `catalog.json`. Deduplicate on
   (`institution_id`, normalized program name).

## Procedure (per worker)

For each institution in the batch:

1. Start from the institution's `official_url` (trusted root).
2. Find its graduate program listing — multi-source union: the official program catalog /
   department pages first; aggregators (Studyportals, FindAMasters/FindAPhD) and general
   web search as supplements. Never rely on a single source.
3. Identify every program matching the scoped field and intake.
4. Write a stub program record per program into the batch shard: `identity`,
   `institution_id`, and a provenance stub (`source_urls`, `last_verified`,
   `source_confidence`).
5. Set the institution's universe status: `checked` (programs found),
   `no-programs` (genuinely none in scope), or `unreachable` (could not be processed even
   at the real-browser tier).
6. Stay within the tool-call budget. If the budget is exhausted mid-batch, write what is
   done, mark the batch incomplete in the manifest, and stop — the orchestrator
   re-dispatches the remainder.

## Rules enforced

- `rules/01-search-completeness.md` — every universe entry is processed; none skipped.
- `rules/02-data-provenance.md` — every stub carries provenance from creation.
- `rules/03-orchestration.md` — isolated workers, bounded concurrency, per-worker budget,
  persist-immediately, resumable batches.

## Failure modes prevented

- **Context overflow** — the heavy search work happens inside disposable worker contexts;
  the orchestrator never accumulates hundreds of programs in one window.
- **Lost results** (the Stage A Canada/UK loss) — shards are on disk the moment a batch
  finishes; a compaction or crash loses nothing.
- **Rate-limit blowups** (the Stage A 4-agent crash) — bounded concurrency + per-worker
  budgets keep request volume controlled.

## Handoff

→ `skills/enrichment.skill.md`, which fills in the detail for each stub.
