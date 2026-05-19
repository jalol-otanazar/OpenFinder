# Rule 00 — Iron Rules

The non-negotiables. Every skill obeys these. If a design decision conflicts with one of
these, the rule wins. One screen — read it whole.

---

### 1. Never enumerate universities from memory. Always from a registry.

LLMs _sample_ ("here are 10 good options"); they do not _enumerate_. The institution list
is always **fetched** from an authoritative registry, never recalled by the model. This
is the single most important rule. Detail: `rules/01-search-completeness.md`.

### 2. Exhaustive by scope.

"Every program on earth" is infinite. "Every CS master's in the UK" is finite and
finishable. FInder enforces a scope (field + countries), then searches it **completely** —
"complete" means zero `unchecked` rows in `universe.json`.

### 3. The chat is not the brain. State lives on disk.

Profile, universe, catalog, results, run manifest are **files**. They are re-read every
run. A fresh session and a 500-message session behave identically. Detail:
`rules/03-orchestration.md`.

### 4. Show everything. Flag, do not drop.

Every in-scope program reaches the output. Ineligible programs are **displayed with the
reason**, never silently removed. The student sees the true size of the field.

### 5. Every fact carries a source and a date.

Each program, scholarship, and visa fact has a source URL and a `last_verified` date.
Unverified model knowledge does not reach the student. Detail: `rules/02-data-provenance.md`.

### 6. Coverage is computed, never estimated.

Completeness is `checked ÷ registry-total`, derived from `universe.json` — a measured
fact, not a vibe. Never claim 100%. Detail: `docs/coverage-methodology.md`.

### 7. Advisor, not directory.

FInder does not just list programs — it reasons about each one against _this_ student:
eligibility, admission odds, funding, visa, logistics. Judgment over complete data.

### 8. Goal-aware.

The degree may be a _means_, not the end. Intake establishes the student's **real goal**;
it drives the scoring weights. An instrumental goal ("degree as a vehicle to relocate") is
legitimate and fully supported. Detail: `rules/04-honesty-and-scope.md`.

### 9. No forms.

The student describes themselves once, in prose. Follow-ups are conversational, minimal,
and asked only when a step needs the missing field.

### 10. Honest about the hard things.

No fake admission percentages. Honest about visa and work-authorization rules. FInder is
decision _support_, not official advising, and it will not help misrepresent intent on an
application. Detail: `rules/04-honesty-and-scope.md`.

---

These ten are why FInder is different from a chatbot and different from a directory.
Everything else in `rules/`, `skills/`, and `docs/` is the detailed execution of them.
