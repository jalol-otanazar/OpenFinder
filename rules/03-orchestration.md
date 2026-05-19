# Rule 03 — Orchestration

The detailed rule behind Iron Rule 3. How the agent runs a large search without
overflowing context, losing work, or hitting rate limits. Detail behind the Stage A
"results lost" and "rate-limit crash" failures.

---

## The problems this prevents

- **Context overflow.** A search spanning hundreds of institutions cannot fit in one
  model context. If the orchestrator accumulates program data as it goes, it dies.
- **Lost work.** In Stage A, completed Canada and UK results were held in the
  conversation and lost when the session compacted. Hours of search, gone.
- **Rate-limit crashes.** Stage A spawned 4 unbounded parallel agents and hit the
  account rate limit mid-run, three times.

## The rule

### 3.1 — The orchestrator holds only profile + index

The orchestrator's working memory contains the student profile and a small results
**index** (counts, status, file paths). It **never** holds the program data itself. All
program detail lives in files.

### 3.2 — Workers run in isolated contexts

Heavy search / fetch / reasoning happens inside disposable **worker** contexts. A worker
receives a batch, does the work in its own context window, writes results to disk, and
returns only a compact one-line status. The worker's context is then discarded. This is
the core anti-overflow mechanism and it holds for any LLM backend.

### 3.3 — Persist immediately

A worker writes its results to a disk **shard** the moment its batch finishes — before
returning. Results never exist only in chat. A crash, a compaction, or a closed session
loses nothing already written.

### 3.4 — Bounded concurrency

At most `max_parallel_workers` workers run at once. **Default: 2.** This is a deliberate
ceiling — Stage A's 4-wide unbounded fan-out caused the rate-limit crashes. The ceiling is
configurable but low by default.

### 3.5 — Per-worker tool-call budget

Each worker batch has a tool-call budget (default ~25). A worker that exhausts its budget
writes what it has, marks its batch incomplete in the run manifest, and stops. Batch size
is chosen so a typical batch finishes within budget.

### 3.6 — Runs are resumable

The run state lives in `run-manifest.json` (see `schemas/run-manifest.md`). On startup the
orchestrator reads it and:

1. skips stages already `complete`,
2. re-dispatches any batch not marked `complete`,
3. trusts on-disk shards from completed batches — never re-runs them.

A fresh session resumes an interrupted run with zero lost and zero duplicated work.

### 3.7 — The profile is re-read every run, by every skill

`student-profile.json` is the single source of truth. Every skill re-reads it at the start
of its invocation. A change made mid-run (Stage A: the student said "I can take Duolingo")
propagates everywhere — scoring re-derives from the current profile, never a cached
verdict. Nothing personal is ever held only in chat.

### 3.8 — State files are canonical and named once

The run manifest records the canonical path of every artifact (`universe.json`,
`catalog/`, `catalog.json`, `scholarships.json`, `results_scored.json`). Skills find prior
state through the manifest, not by guessing filenames.

## Enforcement checklist

- [ ] Orchestrator memory holds only profile + index — no bulk program data.
- [ ] Every worker writes a shard to disk before returning.
- [ ] No more than `max_parallel_workers` (default 2) workers run concurrently.
- [ ] Each batch has a tool-call budget; over-budget batches stop cleanly.
- [ ] `run-manifest.json` is updated after every batch.
- [ ] An interrupted run resumes without re-running completed batches.
- [ ] Every skill re-reads `student-profile.json` on entry.

## Related

- `schemas/run-manifest.md` — the resumability data contract.
- `skills/catalog.skill.md`, `skills/enrichment.skill.md` — the batched-worker stages.
- `docs/architecture.md` — the orchestrator / worker component split.
