# Skill: Intake

> Pipeline stage 1 of 6. Turns one free-form prompt into a structured, durable profile.

## Purpose

Convert whatever the student writes — however unstructured — into a complete
`student-profile.json`, asking targeted follow-ups only for what is missing _and_ needed.
The student never faces a form or a wall of blank fields.

## Inputs

- One free-form natural-language prompt from the student.
- (On re-run) the existing `student-profile.json`, to be updated rather than rebuilt.

## Outputs

- `student-profile.json` — see `schemas/student-profile.md`.

## Procedure

1. **Read existing state.** If `student-profile.json` exists, load it. Intake is
   re-runnable: a later message ("I can take Duolingo") updates the file in place.
2. **Extract.** Parse the prompt and fill every profile field you can. The schema is your
   internal checklist — do not show it to the student.
3. **Establish the real goal.** This is the most important extraction. Ask directly if it
   is unclear: _why_ this degree, _why_ these countries. Capture instrumental goals
   honestly (e.g. "degree as a vehicle to relocate") and set `real_goal.scoring_profile`
   to one of the presets in `docs/scoring-model.md`.
4. **Capture custom preferences.** Anything that does not fit a field goes into
   `custom_notes` verbatim — it becomes a scoring factor later.
5. **Ask follow-ups progressively — and only as needed.** Do not interrogate. Ask for a
   missing field only when a downstream step actually needs it, and prefer to begin the
   search on partial data. Batch related questions; keep it conversational.
6. **Write the profile.** Save `student-profile.json` with an updated `last_updated`.
7. **Confirm scope.** Before handing off to `universe`, confirm the two things that
   define the run: the **field(s)** and the **countries/regions**. These set the scope
   that everything else is exhaustive _within_.

## What to ask vs. what to defer

| Ask early (the search cannot start without it)   | Defer (ask when a step needs it)                          |
| ------------------------------------------------ | --------------------------------------------------------- |
| Field(s) of study                                | Exact GPA scale conversion                                |
| Target countries / regions                       | Reference-letter strength self-assessment                 |
| The real goal                                    | Proof-of-funds capacity                                   |
| Funding need (funded-only / partial / self-fund) | Specific coursework detail                                |
| Nationality (drives visa scoring)                | Project specifics (URLs, stack) — useful but not blocking |

## Rules enforced

- **Profile is the single source of truth** (`rules/03-orchestration.md`). Everything
  personal lives here, on disk — never only in chat.
- **No forms** (`rules/00-iron-rules.md`). One prose prompt in; follow-ups are
  conversational and minimal.
- **Goal-aware** (`rules/00-iron-rules.md`). The run is shaped by `real_goal`, captured
  here.

## Failure modes prevented

- _Context rot_ — because the profile is a file, a 500-message session and a fresh one
  behave identically. The Stage A mid-run Duolingo change was absorbed cleanly precisely
  because intake re-runs and rewrites the file.
- _Interrogation fatigue_ — progressive, need-driven questions instead of a 40-field form.
- _Goal blindness_ — without an explicit `real_goal`, scoring would default to prestige
  and mis-rank everything for a location-driven student.

## Handoff

→ `skills/universe.skill.md`, with confirmed scope (fields + countries) recorded in
`run-manifest.json`.
