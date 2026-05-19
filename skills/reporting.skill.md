# Skill: Reporting

> Pipeline stage 6 of 6. Renders the decision-ready deliverables.

## Purpose

Turn `results_scored.json` into polished, human-facing outputs — and, critically, report
**how complete the search actually was**, using a computed figure, not a guess.

## Inputs

- `results_scored.json` — from `scoring`.
- `universe.json` — for the coverage computation.
- `run-manifest.json` — scope, per-country coverage counters.
- `student-profile.json` — for the gap report and per-country briefs.

## Outputs

Six deliverables:

1. **Master spreadsheet** — every in-scope program = one row, all columns, **including
   ineligible ones flagged with the reason**. This is the full list, nothing hidden.
2. **Ranked shortlist** — `Priority` / `Apply` / `Backup` tiers (Reach/Match/Safety
   within), a short narrative per program, and a concrete next action.
3. **Per-country brief** — visa process, proof-of-funds amount, post-study work rights,
   for the student's nationality.
4. **Personal gap report** — for each gap (English test, references, GPA, etc.): severity,
   a realistic fix, a deadline.
5. **Deadline calendar** — counts backward from each deadline using document lead times;
   flags what is no longer feasible.
6. **Coverage report** — see below.

## The coverage report — computed, not estimated

This is the deliverable that answers "did we actually find everything?" — and the one
Stage A got wrong (it _estimated_ "~60%"). Here it is **computed** from `universe.json`:

```
coverage(country) = count(status in {checked, no-programs, unreachable})
                    / count(all institutions in country)
```

The coverage report states, per country:

- institutions in the registry (the denominator),
- institutions checked (the numerator),
- the ratio,
- programs found,
- `unreachable` institutions, listed by name as **known gaps**,
- the registry source used.

It never claims 100%. If any institution is `unchecked`, the run is **not done** — see
`rules/01-search-completeness.md` — and reporting should say so rather than paper over it.

## Procedure

1. Load all inputs.
2. Compute per-country coverage from `universe.json`. Cross-check against
   `run-manifest.json` counters.
3. Render the master spreadsheet — all programs, all columns, ineligible flagged.
4. Render the ranked shortlist from the `recommendation_tier` field.
5. Render per-country briefs (visa/funds/work-rights) keyed to nationality.
6. Render the gap report from eligibility `FAIL`/`UNCERTAIN` flags + profile gaps.
7. Render the deadline calendar — work backward from each deadline.
8. Render the coverage report. If coverage < target for any country, say so plainly and
   list what is missing.

## Rules enforced

- `rules/01-search-completeness.md` — coverage is computed from the universe checklist.
- `rules/04-honesty-and-scope.md` — show everything (ineligible flagged, not dropped);
  never claim 100%; visa facts cited with source + date.
- `rules/02-data-provenance.md` — every fact in every output carries a source + a
  `last_verified` date.

## Failure modes prevented

- **Invisible incompleteness** — a computed coverage figure makes a partial search
  obvious instead of letting it pass as complete (the core Stage A reporting failure).
- **Silent drops** — every program reaches the spreadsheet; eligibility failures are
  visible with reasons, so the student is never misled about the size of the field.

## Handoff

End of pipeline. To **add a country**, re-run from `universe` for the new country only;
results append and re-rank. To **update the profile**, re-run from `intake`; only
`scoring` + `reporting` need to re-run (the catalog is profile-agnostic and reusable).
See `docs/workflow.md`.
