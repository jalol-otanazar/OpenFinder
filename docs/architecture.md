# Architecture

How FInder is put together. The blueprint named 11 components; this document maps them to
the concrete pieces of the Stage B build and shows how data flows between them.

---

## Design stance

- **The chat is a thin control panel.** It is not the brain and not the database.
- **State lives on disk.** Every component reads and writes files; nothing important lives
  only in a model context.
- **Model- and vendor-agnostic.** FInder talks to an abstract LLM interface. The pipeline
  is identical whether the backend is a paid API, a local model, or a free provider.
- **Self-contained.** Search, fetch, and browser tooling ship inside the package. The only
  thing the user supplies is an LLM key (which can be a free one).

## Components

| #   | Component                    | What it is in the build                                         | Detail                       |
| --- | ---------------------------- | --------------------------------------------------------------- | ---------------------------- |
| 1   | **Adaptive Intake**          | The `intake` skill                                              | `skills/intake.skill.md`     |
| 2   | **Profile Store**            | `student-profile.json` on disk                                  | `schemas/student-profile.md` |
| 3   | **Program Catalog**          | `catalog.json` (+ shards), built by `catalog`                   | `skills/catalog.skill.md`    |
| 4   | **Enrichment Workers**       | Batched workers run by `enrichment`                             | `skills/enrichment.skill.md` |
| 5   | **Scoring Engine**           | The `scoring` skill                                             | `skills/scoring.skill.md`    |
| 6   | **Orchestrator**             | The run controller — slices batches, holds only profile + index | `rules/03-orchestration.md`  |
| 7   | **Output Layer**             | The `reporting` skill                                           | `skills/reporting.skill.md`  |
| 8   | **Conversational Interface** | The CLI; stateless — reads files each turn                      | this doc                     |
| 9   | **LLM Adapter**              | Pluggable model interface                                       | this doc                     |
| 10  | **Bundled Tools**            | Search client, fetcher, headless browser                        | this doc                     |
| 11  | **Storage Layer**            | SQLite (self-host) / Postgres (hosted)                          | this doc                     |

Plus one component the blueprint implied and Stage A proved essential:

| 12 | **Registry Layer** | Authoritative institution registries → the `universe` skill | `docs/country-registries.md` |

The Registry Layer is first-class infrastructure. It is the component whose absence caused
the Stage A UK failure. See `docs/stage-a-retrospective.md`.

## The three layers that make it model-agnostic and self-contained

### LLM Adapter (component 9)

An abstract "LLM provider" interface. Concrete adapters cover any OpenAI-compatible API,
local runtimes (Ollama, LM Studio), and free/low-cost providers. The user picks one at
setup; **no other component changes**. The orchestrator/worker split (component 6) is what
keeps this true — because workers operate in isolated contexts and return compact
results, the design respects _any_ model's context limit, not one vendor's.

### Bundled Tools (component 10)

Shipped inside the package, needing no external account:

| Function          | Module                              | Notes                                          |
| ----------------- | ----------------------------------- | ---------------------------------------------- |
| Web search        | Search client                       | Free, no-key default; pluggable to a keyed API |
| Fetch + extract   | HTTP fetcher + HTML extractor       | First tier — fast, light                       |
| JS-heavy pages    | Headless browser                    | Second tier                                    |
| Bot-blocked pages | Headless browser, real-browser mode | Last tier; ToS applies                         |

This is the **tiered fetch strategy**: plain fetch → headless → real-browser, escalating
only as needed. Used by `universe`, `catalog`, and `enrichment`.

### Storage Layer (component 11)

Pluggable behind one interface. **SQLite** is the bundled default — a single local file,
zero setup, fully functional self-hosted. **Postgres** is the storage adapter for the
operator's hosted deployment. Same application code; only the adapter differs. The choice
of database does not change what the product _is_.

## Data flow

```
   student prose
        │
        ▼
  ┌───────────┐     student-profile.json
  │  INTAKE   │ ───────────────────────────────┐
  └───────────┘                                 │
        │ scope (field + countries)             │
        ▼                                       │
  ┌───────────┐   registries    universe.json   │
  │ UNIVERSE  │ ◄────────────►  (checklist)      │
  └───────────┘                     │           │
        │                           │           │
        ▼                           ▼           │
  ┌───────────┐   ORCHESTRATOR: slices batches,  │
  │  CATALOG  │   bounded concurrency, holds     │
  └───────────┘   only profile + index          │
        │   catalog shards ──► catalog.json      │
        ▼                                        │
  ┌────────────┐  scholarships.json              │
  │ ENRICHMENT │  enriched catalog.json          │
  └────────────┘                                 │
        │                                        │
        ▼                                        ▼
  ┌───────────┐ ◄──────────────────────────────────
  │  SCORING  │   results_scored.json
  └───────────┘
        │
        ▼
  ┌───────────┐   spreadsheet · shortlist · briefs ·
  │ REPORTING │   gap report · deadline calendar ·
  └───────────┘   coverage report (computed)

  run-manifest.json tracks every stage + batch — making the whole run resumable.
```

## What is shared vs. per-student

- **Shared / reusable:** the universe and the catalog (programs, requirements, funding)
  are profile-agnostic. Once built, they are reused across students and across runs.
- **Per-student / private:** the profile, the scoring, and the reports. Scoring is the
  only stage that must re-run when the profile changes.

This split is why "add a country" or "update my profile" is cheap — see `docs/workflow.md`.

## Related

- `docs/workflow.md` — the run sequence step by step.
- `docs/country-registries.md` — the Registry Layer in detail.
- `rules/03-orchestration.md` — the orchestrator/worker contract.
