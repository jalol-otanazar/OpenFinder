# FInder — project memory

FInder is an **exhaustive, goal-aware graduate-program advisor**. A student describes
themselves once in plain language; FInder returns _every_ program matching their scoped
criteria (field + countries), scored against their profile, with eligibility, admission
odds, funding, visa and logistics folded in. It is an **advisor**, not a directory.

This repository is the **open-core** product: a free, open-source cross-platform terminal
CLI that technical users self-host, plus a paid hosted version for non-technical students.
Same code; only the storage adapter differs (SQLite self-host / Postgres hosted).

## The iron rule

**Never enumerate universities from the model's memory. Always from a registry.**

The whole project exists because LLMs _sample_ ("here are 10 good options") instead of
_enumerating_. Stage A proved this is not hypothetical — it recalled "prominent UK
universities" and missed 40% of them. Every search begins by loading an authoritative
national registry into a `universe.json` checklist; no institution is searched unless it
is a row in that file. See `rules/01-search-completeness.md`.

## Other non-negotiables

- **State lives on disk.** Profile, catalog, results are files — re-read every run. A
  fresh chat and a 500-message chat behave identically. See `rules/03-orchestration.md`.
- **Show everything.** Ineligible programs are displayed _flagged with the reason_, never
  dropped. See `rules/04-honesty-and-scope.md`.
- **Every fact has a source URL + `last_verified` date.** See `rules/02-data-provenance.md`.
- **Coverage is computed, never estimated** — institutions-checked ÷ registry-total.

## The pipeline (6 skills, in order)

1. `skills/intake.skill.md` — free-form prompt → `student-profile.json`
2. `skills/universe.skill.md` — registry → complete `universe.json` checklist
3. `skills/catalog.skill.md` — batched workers find each institution's programs
4. `skills/enrichment.skill.md` — pull requirements / deadlines / funding
5. `skills/scoring.skill.md` — 7-dimension goal-aware scoring
6. `skills/reporting.skill.md` — spreadsheet + shortlist + briefs + gap + coverage

## Where to read next

- New here? `README.md`, then `docs/stage-a-retrospective.md` (why the design is shaped
  this way), then `docs/architecture.md`.
- Building it? `docs/workflow.md` + the `skills/` specs + the `schemas/` contracts.
- Status: **specification complete; implementation pending.** This folder is the repo root.
