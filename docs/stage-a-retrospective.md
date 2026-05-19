# Stage A Retrospective

**Read this first.** Every design choice in this repository traces back to something
Stage A got right or got wrong. This document explains the _why_.

---

## What Stage A was

Stage A was the **validation spike**: a throwaway prototype, run inside Claude Code, whose
only job was to answer one question — _can graduate-program data be sourced exhaustively
at scale?_ It was never meant to become the product.

It ran the full pipeline for a real student:

- **Student:** an Uzbek national, New Uzbekistan University, Economics & Data Science,
  GPA ~2.67/4.0, no English test yet, no research, full funding required, goal = physical
  presence in Silicon Valley to build a startup (degree as a vehicle).
- **Scope:** CS / AI / ML / Data Science master's and PhD programs across the US, Canada,
  and the UK, Fall 2027 intake.
- **Output:** 51 programs across 41 institutions, scored on 7 dimensions; a master
  spreadsheet, ranked shortlist, per-country briefs, gap report, coverage report.

## What passed

- **The method works.** Scoped, batched search returned a real ranked catalog, not a
  sampled ten. The advisor framing — eligibility, admission odds, funding, visa, logistics
  folded in per student — produced genuinely decision-ready output.
- **US coverage ~90%, Canada ~85%.** Within reasonable effort.
- **The profile-on-disk design held.** Mid-run, the student said "I can take Duolingo."
  Because the profile was a file and scoring re-derived from it, the change propagated
  cleanly through every subsequent program's score. This is the continuity the product
  promises, demonstrated.
- **The decision gate was answerable** with measured-ish numbers — enough to make a
  build/no-build call.

## What failed — and the verdict

**UK coverage was ~60%.** The decision gate (≥90%) was not met for the UK. Verdict:
**conditional pass** — the method scales, but the sourcing strategy needed a specific fix
before the real product was built.

## The seven failures, and the Stage B fix for each

| #   | Stage A failure                                                                                             | Root cause                                                                                                                                                                    | Stage B fix                                                                                                                                                                                        | Lives in                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **UK coverage ~60%**                                                                                        | The search asked the model which UK universities exist. The model returned the ones it knows well and silently omitted Southampton, Leeds, Glasgow, Warwick, and dozens more. | **Universe-then-check.** Enumerate every institution from an authoritative registry into `universe.json`; nothing is searched unless it is a row there. The model is never the source of the list. | `skills/universe.skill.md`, `rules/01-search-completeness.md` |
| 2   | **Coverage was estimated** ("~60%"), guessed after the fact                                                 | No data structure held the true universe, so there was no denominator to divide by.                                                                                           | **Coverage is computed:** `checked ÷ registry-total`, from the universe checklist.                                                                                                                 | `docs/coverage-methodology.md`, `skills/reporting.skill.md`   |
| 3   | **Stale scholarship data** (Vanier — reported from training knowledge; the programme had been restructured) | Model knowledge looked identical to verified fact. No freshness or confidence signal.                                                                                         | **Provenance on every record:** `last_verified` + `source_confidence`. `model-knowledge` records are excluded from final output until web-verified.                                                | `rules/02-data-provenance.md`, `schemas/program-record.md`    |
| 4   | **Completed Canada & UK results were lost** when the long session compacted                                 | Results were held in the conversation, not persisted.                                                                                                                         | **Persist immediately:** workers write disk shards before returning; the orchestrator holds only an index; `run-manifest.json` makes runs resumable.                                               | `rules/03-orchestration.md`, `schemas/run-manifest.md`        |
| 5   | **Rate-limit crashes** — 4 unbounded parallel agents hit the account limit, three times                     | Unbounded fan-out.                                                                                                                                                            | **Bounded concurrency** (default 2 workers) + a per-worker tool-call budget + batch sizing to the budget.                                                                                          | `rules/03-orchestration.md`                                   |
| 6   | **Mid-run profile change handled ad hoc** (the Duolingo update worked, but by luck of timing)               | No formal rule that the profile is re-read every run.                                                                                                                         | **Profile is the single source of truth, re-read by every skill on entry;** scoring always re-derives.                                                                                             | `rules/03-orchestration.md`, `skills/intake.skill.md`         |
| 7   | **Scope was implicitly capped** — the search gravitated to "prominent" universities                         | "Prominent" is how an LLM samples. Without a hard completeness definition, partial felt complete.                                                                             | **"Complete" = zero `unchecked` rows** in `universe.json`. Ranking affects scoring, never whether an institution is searched.                                                                      | `rules/01-search-completeness.md`                             |

## The one lesson

Failures 1, 2, and 7 are the same failure wearing three hats: **the LLM sampled instead of
enumerated, and nothing measured the gap.** That is precisely the failure FInder was
created to defeat — and it had crept into FInder's own validation prototype.

Stage B's answer is structural, not a better prompt: a registry-fed `universe.json`
checklist that _is_ the list of work, a hard definition of "complete," and a coverage
number computed from that checklist. You cannot forget Southampton if Southampton is a row
in a file you must drive to zero.

## Implication for Stage B sourcing

The build must treat the **registry layer as first-class infrastructure**, equal to the
LLM adapter and the storage layer. `docs/country-registries.md` is therefore a core
document, not an appendix: it names the authoritative registry per country and the recipe
for adding any new country. Get the universe right and the rest of the pipeline — already
proven in Stage A — simply works.
