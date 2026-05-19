# Scoring Model

How FInder turns a profile-agnostic catalog into a per-student ranked assessment. Used by
`skills/scoring.skill.md`.

---

## Principle

Same seven dimensions for every student. **The student's real goal sets the weights.** A
location-driven applicant and a research-driven applicant, scored against the identical
catalog, get correctly different rankings — because the weighting, not the dimensions,
changes.

## The 7 dimensions

### 1. Eligibility — `PASS` / `FAIL` / `UNCERTAIN`

Hard gates: minimum GPA, required degree background, prerequisites, GRE requirement,
English-test requirement, application deadline still open. A `FAIL` is **shown, flagged
with the reason, never dropped** (`rules/04-honesty-and-scope.md`). `UNCERTAIN` when the
data is incomplete — paired with what the student must confirm.

### 2. Admission chance — `Reach` / `Match` / `Safety`

The student's profile vs. the typical admitted cohort, with written reasoning. **No fake
percentages** — buckets and reasoning only.

### 3. Academic / research fit — `0–5`

Field alignment; depth of relevant coursework; for research programs, faculty whose work
matches the student's interests.

### 4. Funding fit — `0–5`

Affordability plus the _likelihood_ of funding for an international applicant: tuition vs.
the student's funding need, assistantships/scholarships open to internationals, and
relevant external scholarships from `scholarships.json`.

| Score | Meaning                                                                 |
| ----- | ----------------------------------------------------------------------- |
| 5     | Full funding — tuition + living covered (funded PhD, full scholarship). |
| 4     | Most costs covered (>50%).                                              |
| 3     | Partial (25–50%) — e.g. co-op income, competitive TA.                   |
| 2     | Small scholarship (<25%).                                               |
| 1     | Fee waiver only / negligible.                                           |
| 0     | No funding; full self-pay.                                              |

### 5. Location & ecosystem fit — `0–5`

Location preferences, cost of living, language, safety — **and** the surrounding
ecosystem: industry presence, startup scene, research community, diaspora. Ecosystem is
explicit because for an instrumental goal it can be the whole point.

### 6. Visa & immigration — `0–5`

For the student's nationality: visa difficulty, proof-of-funds amount, processing time,
post-study work rights, PR pathway.

### 7. Logistics feasibility — `0–5`

Can every document be assembled before the deadline, given today's date and realistic
lead times — transcripts, apostille/legalization, language tests, reference letters?

## Goal-weighting presets

`real_goal.scoring_profile` (set at intake) selects a preset. Eligibility is always a hard
gate first; the weights distribute across the remaining decision.

| Preset               | Funding | Location/Ecosystem | Admission             | Visa | Logistics | Academic/Research |
| -------------------- | ------- | ------------------ | --------------------- | ---- | --------- | ----------------- |
| `phd-academia`       | 25%     | 5%                 | 15%                   | 10%  | 10%       | 35%               |
| `immigrate-settle`   | 20%     | 30%                | 15%                   | 25%  | 10%       | 0%                |
| `program-as-vehicle` | 35%     | 30%                | 15%                   | 10%  | 10%       | 0%                |
| `cheapest-fastest`   | 35%     | 10%                | 25% (Safety-weighted) | 10%  | 20%       | 0%                |

Weights are a starting point, tuned per build. The point is that they are **derived from
the stated goal**, not fixed.

### Worked example — Stage A

The Stage A student's goal was `program-as-vehicle` (be physically in Silicon Valley;
degree is a means). Under that preset, a Bay Area professional master's with a clear
F-1 → STEM-OPT visa path outranked more prestigious, better-funded research programs
elsewhere — correctly, _for that student_. The same catalog under `phd-academia` would put
funded research PhDs on top. One catalog, one scoring model, goal-driven weights.

## Custom criteria

Free-text `custom_notes` from the profile become additional weighted factors. Examples
from Stage A: "location and funding outweigh prestige" → up-weight dimensions 4 and 5,
down-weight prestige signals in dimension 3. The `scoring` skill translates each note into
an explicit factor and shows it in the scorecard, so the student sees how their own words
affected the ranking.

## Output

Each program in `results_scored.json` gets: the seven dimension scores, the eligibility
verdict, the admission bucket, a weighted total, a `recommendation_tier`
(`Priority` / `Apply` / `Backup` / `Do Not Apply`), and a two-sentence plain-language
summary addressed to the student.

## Related

- `skills/scoring.skill.md` — applies this model.
- `schemas/student-profile.md` — `real_goal` and `custom_notes`.
- `rules/04-honesty-and-scope.md` — buckets not percentages; flag don't drop.
