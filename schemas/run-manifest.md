# Schema: Run Manifest

The control file for a single search run. It is what makes a run **resumable** — Stage A
lost completed Canada/UK results when a long session compacted; the manifest plus
disk-backed shards mean an interrupted run picks up exactly where it stopped.

- **File:** `run-manifest.json` (one per run).
- **Written/updated by:** the orchestrator throughout the pipeline (see
  `rules/03-orchestration.md`).
- **Read by:** every skill, to know what is done and what remains.

## Structure

```json
{
  "schema_version": "1.0",
  "run_id": "2026-fall-csai-us-ca-uk",
  "created": "2026-05-18T09:00:00Z",
  "updated": "2026-05-18T14:30:00Z",

  "scope": {
    "fields": ["Computer Science", "AI", "Machine Learning", "Data Science"],
    "countries": ["US", "Canada", "UK"],
    "intake": "Fall 2027",
    "profile_ref": "student-profile.json"
  },

  "files": {
    "universe": "universe.json",
    "catalog_shards_dir": "catalog/",
    "catalog_merged": "catalog.json",
    "scholarships": "scholarships.json",
    "results_scored": "results_scored.json"
  },

  "stage_status": {
    "intake": "complete",
    "universe": "complete",
    "catalog": "in-progress",
    "enrichment": "pending",
    "scoring": "pending",
    "reporting": "pending"
  },

  "coverage": {
    "US": { "total": 142, "checked": 142, "ratio": 1.0 },
    "Canada": { "total": 48, "checked": 48, "ratio": 1.0 },
    "UK": { "total": 166, "checked": 121, "ratio": 0.73 }
  },

  "batches": [
    {
      "batch_id": "uk-batch-03",
      "stage": "catalog",
      "country": "UK",
      "institution_ids": ["uk_university_of_sheffield", "uk_university_of_leeds"],
      "status": "complete",
      "tool_calls_used": 18,
      "tool_call_budget": 25,
      "shard_file": "catalog/uk-batch-03.json",
      "started": "2026-05-18T13:10:00Z",
      "finished": "2026-05-18T13:34:00Z"
    },
    {
      "batch_id": "uk-batch-04",
      "stage": "catalog",
      "country": "UK",
      "institution_ids": ["uk_university_of_glasgow", "uk_university_of_warwick"],
      "status": "in-progress",
      "tool_calls_used": null,
      "tool_call_budget": 25,
      "shard_file": "catalog/uk-batch-04.json",
      "started": "2026-05-18T14:28:00Z",
      "finished": null
    }
  ],

  "concurrency": { "max_parallel_workers": 2, "default_batch_size": 8 },

  "log": [
    "2026-05-18T09:05 intake complete — profile saved",
    "2026-05-18T10:40 universe complete — 356 institutions across 3 countries",
    "2026-05-18T13:34 uk-batch-03 complete — 5 programs found"
  ]
}
```

## Field reference

| Group        | Field                                  | Notes                                                                                                                                              |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope        | —                                      | The frozen definition of the run. `profile_ref` points at the profile used.                                                                        |
| files        | —                                      | Canonical paths for every artifact, so any skill/run can find prior state.                                                                         |
| stage_status | —                                      | Per-stage: `pending` \| `in-progress` \| `complete` \| `failed`.                                                                                   |
| coverage     | —                                      | Per-country `total` / `checked` / `ratio`, mirrored from `universe.json`. The reporting skill reads this; it is **computed**, never typed by hand. |
| batches      | `status`                               | `pending` \| `in-progress` \| `complete` \| `failed`. On resume, re-dispatch anything not `complete`.                                              |
| batches      | `tool_calls_used` / `tool_call_budget` | Enforces the per-worker budget that prevents the Stage A rate-limit blowups.                                                                       |
| batches      | `shard_file`                           | The disk shard a worker writes to — results never live only in chat.                                                                               |
| concurrency  | `max_parallel_workers`                 | Default 2 — bounded concurrency (`rules/03-orchestration.md`).                                                                                     |

## Resumability contract

On startup the orchestrator reads `run-manifest.json` and:

1. Skips any `stage_status` already `complete`.
2. For an `in-progress` stage, re-dispatches every batch whose `status` is not `complete`.
3. Trusts shards on disk — a `complete` batch's `shard_file` is authoritative; it is not
   re-run.

This guarantees: **a fresh session resumes an interrupted run with zero lost work and zero
duplicated work.**

## Related

- `rules/03-orchestration.md` — the orchestration rules this file enforces.
- `schemas/universe-entry.md` — `coverage` is derived from the universe checklist.
