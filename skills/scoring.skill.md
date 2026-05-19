# Skill: Scoring

> Pipeline stage 5 of 6. Scores every program against the student on 7 goal-aware dimensions.

## Purpose

Turn the enriched, profile-agnostic catalog into a per-student ranked assessment. This is
where FInder stops being a directory and becomes an advisor: every program gets a
scorecard reasoned against _this_ student's profile and _this_ student's real goal.

## Inputs

- `catalog.json` (enriched) + `scholarships.json`.
- `student-profile.json` — **re-read fresh at the start of this skill** (the profile may
  have changed since `catalog` ran; `rules/03-orchestration.md`).

## Outputs

- `results_scored.json` — every program with a full scorecard, sorted by weighted score.

## The 7 dimensions

Scored per (student × program). Full definitions in `docs/scoring-model.md`.

1. **Eligibility** — hard gates (GPA, background, tests, English, deadline still open) →
   `PASS` / `FAIL` / `UNCERTAIN`. A `FAIL` is **shown and flagged, never dropped**.
2. **Admission chance** — profile vs. typical admitted cohort → `Reach` / `Match` /
   `Safety` + reasoning. **No fake percentages.**
3. **Academic / research fit** — field alignment; faculty match for research programs.
4. **Funding fit** — affordability + likelihood of funding for an international applicant,
   including scholarships from `scholarships.json`.
5. **Location & ecosystem fit** — location preferences, cost of living, _and_ the
   surrounding ecosystem (industry, startup scene, research community, diaspora).
6. **Visa & immigration** — for the student's nationality: visa difficulty, proof-of-funds
   amount, processing time, post-study work rights, PR pathway.
7. **Logistics feasibility** — can every document be assembled before the deadline, given
   today's date and realistic lead times (transcripts, apostille, language tests, LORs)?

## Procedure

1. **Re-read the profile.** Always. Scoring is a pure function of the _current_ profile.
2. **Select the weighting.** Map `real_goal.scoring_profile` to a weight set from
   `docs/scoring-model.md` (`phd-academia`, `immigrate-settle`, `program-as-vehicle`,
   `cheapest-fastest`). Add weighted factors for each `custom_notes` entry.
3. **Score each program** on all 7 dimensions. Eligibility first — a `FAIL` still gets a
   full record, flagged with the reason.
4. **Compute the weighted score** and assign a `recommendation_tier`
   (`Priority` / `Apply` / `Backup` / `Do Not Apply`).
5. **Write a plain-language summary** per program — two sentences, addressed to this
   student.
6. **Write `results_scored.json`**, sorted by weighted score; ineligible programs included
   and flagged.

## Worked example (Stage A, `program-as-vehicle` weighting)

Weights: Funding 35% · Location/Ecosystem 30% · Admission 15% · Visa 10% · Logistics 10%.
Northeastern's Oakland (Bay Area) MS scored highest **not** because it is the most
prestigious but because location (5/5) and a US F-1 → STEM-OPT visa path (5/5) dominate
the weighting this student's goal selected. The same catalog under `phd-academia`
weighting would rank funded research PhDs first. Same data, goal-driven weighting.

## Rules enforced

- `rules/00-iron-rules.md` — goal-aware; advisor not directory.
- `rules/04-honesty-and-scope.md` — no fake percentages; Reach/Match/Safety + reasoning;
  ineligible programs shown, flagged, never dropped.
- `rules/03-orchestration.md` — profile re-read fresh; scoring re-derives, never caches a
  stale verdict.

## Failure modes prevented

- **Stale scoring** — re-reading the profile means a mid-run change (Stage A's Duolingo
  update) is reflected everywhere, not just in programs scored afterward.
- **False precision** — buckets + reasoning instead of invented "73% chance" numbers.
- **Hidden rejections** — a `FAIL` is surfaced with its reason, so the student learns
  _why_, which feeds the gap report.

## Handoff

→ `skills/reporting.skill.md`.
