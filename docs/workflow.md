# Workflow

The end-to-end run, step by step — how the six skills chain, how the orchestrator drives
them, and how iteration (add a country, update the profile) works without redoing work.

---

## The run, end to end

| Step | Skill        | Reads                                          | Writes                                                                         |
| ---- | ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | `intake`     | student prose, existing profile                | `student-profile.json`; scope → `run-manifest.json`                            |
| 2    | `universe`   | scope, `docs/country-registries.md`            | `universe.json` (all `unchecked`)                                              |
| 3    | `catalog`    | `universe.json`                                | `catalog/` shards → `catalog.json`; universe statuses                          |
| 4    | `enrichment` | `catalog.json`, profile                        | enriched `catalog.json`, `scholarships.json`                                   |
| 5    | `scoring`    | enriched catalog, `scholarships.json`, profile | `results_scored.json`                                                          |
| 6    | `reporting`  | `results_scored.json`, `universe.json`         | spreadsheet, shortlist, briefs, gap report, deadline calendar, coverage report |

`run-manifest.json` is updated throughout (see `schemas/run-manifest.md`).

## The orchestrator loop (steps 3–4)

Steps 3 and 4 are the heavy ones, and they run under the orchestration rules
(`rules/03-orchestration.md`):

```
while universe.json has unchecked entries:
    slice next batch (default 6-10 institutions, by country/region)
    dispatch  — at most max_parallel_workers (default 2) at once
    each worker:
        works in its own isolated context
        respects its tool-call budget (default ~25)
        writes results to a disk shard
        returns a one-line status
    orchestrator updates universe.json + run-manifest.json
merge + dedupe shards
```

The orchestrator never holds program data — only the profile and a small index. This is
what lets the search span hundreds of institutions without overflowing any model's
context, and what makes the run resumable.

## Step detail

1. **Intake.** Student writes one free-form prompt. The agent extracts a profile, asks
   only the follow-ups it needs, and confirms the scope (field + countries). → profile saved.
2. **Universe.** For each country, load the authoritative registry and enumerate _every_
   institution into `universe.json`. The model is never asked which universities exist.
   → complete checklist.
3. **Catalog.** Orchestrator loop above. Each worker finds the in-scope programs at its
   batch of institutions and writes program stubs. → raw catalog.
4. **Enrichment.** Orchestrator loop again. Each worker pulls requirements, deadlines,
   funding, English-test/waiver detail from official pages (tiered fetch) and stamps
   provenance; a sub-pass gathers scholarships. → enriched catalog + scholarships.
5. **Scoring.** Re-read the profile. Score every program on the 7 dimensions with the
   goal-derived weighting. → `results_scored.json`.
6. **Reporting.** Render the six deliverables. Coverage is computed from `universe.json`.

## Resuming an interrupted run

A run can stop at any point — closed session, crash, rate limit. On the next start the
orchestrator reads `run-manifest.json` and:

- skips stages already `complete`,
- re-dispatches only batches not marked `complete`,
- trusts on-disk shards from completed batches.

Zero lost work, zero duplicated work. This is the fix for the Stage A loss of completed
Canada/UK results.

## Iteration — the cheap operations

Because the universe and catalog are profile-agnostic and reusable, and the profile is a
file, the common follow-up requests are cheap:

### "Add Canada to my search"

Run `universe` for Canada only → append new rows to `universe.json`. Run `catalog` and
`enrichment` for just the new `unchecked` rows. Then `scoring` + `reporting` re-run over
the combined set. **Prior results are untouched; nothing is forgotten.**

### "I can take the Duolingo test now" / any profile change

Re-run `intake` to update `student-profile.json`. The universe, catalog, and enrichment
are unaffected — they are profile-agnostic. Only `scoring` + `reporting` re-run. The whole
ranking refreshes against the new profile in one cheap pass.

### "Tell me more about program X"

A targeted drill-down: re-fetch and re-verify that one program's official pages, refresh
its record, re-score it. No full run needed.

## Where each rule applies

| Step       | Governing rules                                                                            |
| ---------- | ------------------------------------------------------------------------------------------ |
| Intake     | `00-iron-rules` (no forms, goal-aware), `03-orchestration` (profile is source of truth)    |
| Universe   | `01-search-completeness` (the core rule), `02-data-provenance`                             |
| Catalog    | `01-search-completeness`, `02-data-provenance`, `03-orchestration`                         |
| Enrichment | `02-data-provenance`, `03-orchestration`                                                   |
| Scoring    | `04-honesty-and-scope` (no fake %, flag don't drop), `03-orchestration` (re-read profile)  |
| Reporting  | `01-search-completeness` (computed coverage), `04-honesty-and-scope`, `02-data-provenance` |

## Related

- `docs/architecture.md` — the components behind these steps.
- `rules/03-orchestration.md` — the orchestrator loop contract.
- `schemas/run-manifest.md` — the file that makes resume + iteration work.
