# Skill: Enrichment

> Pipeline stage 4 of 6. Fills each program stub with the detail needed to score it.

## Purpose

Take the identity-only program stubs from `catalog` and pull the facts that matter:
requirements, deadlines, costs, funding, English-test and waiver policy, outcomes — each
from official sources, each stamped with provenance. Also gather the scholarships in scope.

## Inputs

- `catalog.json` — program stubs from `catalog`.
- `student-profile.json` — to know which scholarships are nationality-relevant.

## Outputs

- Enriched program records in catalog shards → merged `catalog.json`. See
  `schemas/program-record.md`.
- `scholarships.json` — scholarship records. See `schemas/scholarship-record.md`.
- Updated `run-manifest.json`.

## Procedure (orchestrator)

Same batched, bounded-concurrency model as `catalog` (see `rules/03-orchestration.md`):
slice programs into batches, run ≤ `max_parallel_workers`, each worker has a tool-call
budget, results written straight to shards, manifest updated after each batch.

## Procedure (per worker — program enrichment)

For each program in the batch:

1. **Fetch from official sources first.** The program page and the university's graduate
   admissions / fees / funding pages. Use the **tiered fetch strategy**:
   plain HTTP fetch → headless browser (JS-heavy pages) → real-browser mode (only when a
   site blocks automation; ToS still applies).
2. **Fill the record:** `requirements` (GPA, background, GRE, per-test English scores,
   English waiver, reference letters, other documents), `logistics` (deadlines, intakes,
   fee, portal), `cost_and_funding` (tuition, living estimate, scholarships/assistantships
   for internationals, `funding_likelihood`, `fully_funded`), `outcomes` (ranking,
   post-study work rights).
3. **Be precise about English tests.** Record each accepted test separately. If a program
   does **not** accept the Duolingo English Test, omit `duolingo` — that absence is
   meaningful data (CMU SV, Georgia Tech, Waterloo, UIUC in Stage A). Record whether an
   English-medium-instruction **waiver** is possible and on what basis.
4. **Stamp provenance.** Every record gets `source_urls`, `last_verified` (today's date,
   when confirmed against the source), and `source_confidence`:
   - `web-verified` — confirmed on an official page this run.
   - `model-knowledge` — not yet confirmed; **must not appear in final output** until
     verified (`rules/02-data-provenance.md`).
5. **Flag conflicts.** If two sources disagree (e.g. tuition figures), record both and
   flag it rather than silently picking one.

## Procedure (per worker — scholarship enrichment)

- Identify scholarships in scope: national-government schemes for the student's
  nationality, university awards open to internationals, intergovernmental and
  research-council funding.
- Write a `scholarship-record.md`-shaped entry each: funder, type, eligibility
  (nationalities, countries of study, conditions), value, application, provenance.
- Government-scheme details drift — verify eligibility and current cycle; flag
  `model-knowledge` entries for verification (Stage A found the Vanier programme had been
  restructured while the model's knowledge was stale).

## Rules enforced

- `rules/02-data-provenance.md` — `last_verified` + `source_confidence` on every record;
  unverified records excluded from final output; conflicts flagged.
- `rules/03-orchestration.md` — batched, bounded, persisted-immediately, resumable.

## Failure modes prevented

- **Stale facts** — the `last_verified` + confidence stamp makes freshness visible and
  blocks unverified model recall from reaching the student.
- **English-test traps** — modeling each test separately catches "DET not accepted here"
  before it becomes a rejected application.

## Handoff

→ `skills/scoring.skill.md`.
