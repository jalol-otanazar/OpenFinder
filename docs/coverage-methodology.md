# Coverage Methodology

How FInder measures — and reports — how complete a search actually was. This is the
discipline that turns Stage A's guessed "~60%" into a fact.

---

## The principle

> Coverage is **computed from the universe checklist**, never estimated.

Stage A reported "~60% UK coverage" as a post-hoc judgement. There was no universe file,
so there was no denominator — the number was a guess. In Stage B the universe checklist
_is_ the denominator, so coverage is arithmetic.

## The formula

For each country in scope:

```
coverage(country) =
    count(institutions where status in {checked, no-programs, unreachable})
    ─────────────────────────────────────────────────────────────────────
    count(all institutions in that country in universe.json)
```

- **Denominator** — the true registry count, recorded by the `universe` skill from the
  authoritative registry (`docs/country-registries.md`). Not a sample.
- **Numerator** — institutions actually processed.

## What counts as "checked"

An institution counts toward the numerator if its universe status is:

- **`checked`** — processed; programs found and recorded.
- **`no-programs`** — processed; genuinely offers nothing in the scoped field. It _was_
  checked, so it counts. (Excluding it would understate the work done.)
- **`unreachable`** — processing was attempted and failed (site down, blocked past the
  real-browser tier). It counts as _attempted_ but is also reported as a **known gap**.

An institution with status `unchecked` does **not** count. While any `unchecked` entry
remains, the run is **not complete** (`rules/01-search-completeness.md`) and reporting must
say so rather than present a partial run as finished.

## The coverage report

`reporting` produces a coverage report stating, per country:

- registry institutions (denominator) and the registry source used,
- institutions checked (numerator) and the coverage ratio,
- programs found,
- `unreachable` institutions, **listed by name** as known gaps,
- whether any `unchecked` entries remain (i.e. the run is incomplete).

It also states overall coverage and an honest summary of limitations — for example, a
country whose universe was built from a union of independent lists rather than an official
register carries a **lower-confidence** note.

It never claims 100%.

## The decision gate

The validation gate from the blueprint:

> **≥ ~90% coverage at reasonable effort → the method scales.**

In Stage B this gate is applied to a _computed_ number, per country. Stage A's outcome,
recomputed under this discipline:

| Country | Stage A coverage | Gate (≥90%) |
| ------- | ---------------- | ----------- |
| US      | ~90%             | met         |
| Canada  | ~85%             | near        |
| UK      | ~60%             | **failed**  |

The UK failure is exactly what Rule 01 and the `universe` skill exist to prevent. With a
registry-fed universe, the UK denominator is the real institution count and the numerator
is driven to it — the gate becomes achievable and, more importantly, _verifiable_.

## Honesty obligations

- Never claim a search is total. ~90–95% is a realistic target; 100% is not claimed.
- Always show the known gaps (`unreachable` institutions) by name.
- If a registry could not be fully fetched, say so — a smaller, honest denominator with a
  noted limitation beats a confident wrong number.
- Distinguish official-registry coverage from union-of-lists coverage in the report.

See `rules/04-honesty-and-scope.md`.

## Related

- `schemas/universe-entry.md` — the `status` field the formula counts.
- `skills/universe.skill.md` — records the denominator.
- `skills/reporting.skill.md` — renders the coverage report.
- `rules/01-search-completeness.md` — "complete" = zero `unchecked`.
