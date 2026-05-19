# FInder

**An exhaustive, goal-aware graduate-program advisor — in your terminal.**

You describe yourself once, in plain language. FInder returns _every_ graduate program
matching your scope (field + countries), each one scored against _your_ profile —
eligibility, admission odds, funding, visa, and logistics folded in. It is an **advisor**,
not a searchable directory, and not a chatbot.

---

## Why it exists

Ask a general chatbot for graduate programs and two things break:

1. **It samples instead of enumerating.** "Here are 10 good options" — when hundreds
   exist. It silently misses most of the field, and no prompt fixes that.
2. **It doesn't know what you actually want.** A funded research PhD and a Bay-Area
   professional master's get ranked the same, regardless of _your_ real goal.

FInder fixes both by design. Every search begins from an **authoritative national
registry** — never the model's memory — so it covers the field _completely_ and reports,
with a _computed_ number, exactly how complete. And it captures your **real goal** up
front, then weights every score to it.

---

## How it works

A six-stage pipeline. Each stage writes a file on disk that the next stage reads, so a
run is fully **resumable** — interrupt it, re-run, and it continues where it stopped; a
fresh session behaves identically to a long one.

| # | Stage | Command | What it does |
|---|-------|---------|--------------|
| 1 | **intake** | `finder intake` | Free-form prompt → a structured `student-profile.json` |
| 2 | **universe** | `finder universe` | National registries → a complete institution checklist |
| 3 | **catalog** | `finder catalog` | Finds every in-scope program at every institution |
| 4 | **enrichment** | `finder enrichment` | Pulls requirements, costs, funding, and scholarships |
| 5 | **scoring** | `finder scoring` | Scores each program on 7 goal-weighted dimensions |
| 6 | **reporting** | `finder reporting` | Renders the spreadsheet, shortlist, and report |

Six countries are preloaded: **UK, US, Canada, Australia, Germany, Netherlands.**

---

## Install

Requires **Node.js ≥ 20**.

```sh
git clone https://github.com/jalol-otanazar/FInder.git
cd FInder
npm install
npm run build
```

Run the CLI with `node bin/finder.js <command>` — or `npm link` once to get a global
`finder` command.

---

## Get started

```sh
# 1. Configure an LLM provider. Free tiers work fine — Groq, OpenRouter, Google Gemini.
node bin/finder.js setup

# 2. Describe yourself — intake extracts your profile and sets the run scope.
node bin/finder.js intake --run my-run
#    Scriptable form:  intake --run my-run --prompt "Uzbek CS student, funded MS in US/UK…"

# 3. Fetch the registries, then build the institution checklist.
node bin/finder.js universe refresh --all
node bin/finder.js universe build    --run my-run

# 4-6. Find programs, enrich them, score them against your profile, and report.
node bin/finder.js catalog build     --run my-run
node bin/finder.js enrichment build  --run my-run
node bin/finder.js scoring build     --run my-run
node bin/finder.js reporting build   --run my-run
```

Every build command is **idempotent and resumable** — safe to re-run at any time.

---

## What you get

All artifacts land in `runs/<run-id>/`:

- **`student-profile.json`** — your durable, re-readable profile
- **`universe.json`** — every in-scope institution, each with a processing status
- **`catalog.json`** — every in-scope program, enriched with requirements / costs / funding
- **`scholarships.json`** — scholarships in scope, with eligibility
- **`results_scored.json`** — every program scored and ranked _for you_
- **`report/spreadsheet.csv`** — the full list, one row per program (ineligible ones flagged)
- **`report/report.md`** — ranked shortlist, per-country visa briefs, a personal gap
  report, a deadline calendar, and a **computed coverage report**

---

## Principles

- **Registry, never memory.** The institution list is _fetched_ from authoritative
  registries — the search is complete by construction, not by luck.
- **Show everything.** Ineligible programs appear in the output, flagged with the reason —
  never silently dropped. You see the true size of the field.
- **Every fact is sourced.** Each program, scholarship, and visa fact carries a source URL
  and a `last_verified` date. Unverified model knowledge never reaches the final report.
- **Coverage is computed, never estimated** — `checked ÷ registry-total`. FInder never
  claims a 100% search.
- **Goal-aware.** Your stated goal sets the scoring weights; an instrumental goal — "the
  degree is a means to relocate" — is legitimate and fully supported.
- **Model- and vendor-agnostic.** Any OpenAI-compatible API, local models (Ollama, LM
  Studio), or free tiers — chosen at `setup`. No provider SDKs; your key stays on your
  machine, never in the repo or any run artifact.

---

## Development

```sh
npm test         # vitest — 163 offline tests
npm run lint     # eslint
npm run typecheck
```

Network-touching tests are opt-in: `FINDER_LIVE_SMOKE=1 npm test`. Registry and search
endpoints can drift — each is overridable via a `FINDER_*` environment variable. The
design specifications that drive the build live in `skills/`, `rules/`, `schemas/`, and
`docs/` (start with `docs/stage-a-retrospective.md`).

---

## Status

All six pipeline skills are built and the CLI runs end to end. The pipeline logic is
covered by 163 offline tests (stub LLM / fetch / search); live LLM, fetch, and search
behaviour is exercised only by the opt-in `FINDER_LIVE_SMOKE` suite — a real end-to-end
run against your own provider key is worthwhile validation before relying on the output.

## License

MIT
