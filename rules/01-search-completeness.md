# Rule 01 — Search Completeness

The detailed rule behind Iron Rules 1, 2, and 6. This is the rule that exists because of
the Stage A UK failure. Read `docs/stage-a-retrospective.md` for the story.

---

## The problem this prevents

Stage A produced ~60% UK coverage. Not because of a tooling limit — because the search
**asked the model which universities exist**. The model answered with the universities it
knows well (Edinburgh, Imperial, UCL, Manchester, Sheffield, …) and omitted the rest
(Southampton, Leeds, Glasgow, Warwick, Newcastle, and dozens more). The omission was
invisible: nothing measured it, so "~60%" was a guess made after the fact.

That is the LLM-sampling failure the entire product exists to defeat — and it had leaked
into the prototype. Rule 01 makes it structurally impossible.

## The rule

### 1.1 — Universe-then-check is mandatory

Every search runs in two ordered phases:

1. **Universe** — enumerate _every_ institution in the scoped countries from an
   authoritative registry into `universe.json`.
2. **Check** — process every institution in that file.

The `catalog` skill **may not** search any institution that is not a row in
`universe.json`. There is no path from "the model thinks of a university" to "the
university gets searched."

### 1.2 — The model is never the source of the institution list

The institution list is **fetched** from a registry (see `docs/country-registries.md`),
never recalled. If a registry cannot be fetched, that is a **blocking error to surface to
the user** — not permission to improvise the list from memory. A partial, registry-based
list is acceptable (and flagged); a memory-based list is not.

### 1.3 — "Complete" has a precise definition

A run is **complete** when `universe.json` contains **zero entries with
`status: "unchecked"`**. Every institution must end as `checked`, `no-programs`, or
`unreachable`. Until then, the run is in progress and reporting must say so.

### 1.4 — Coverage is computed, not estimated

```
coverage(country) = count(status in {checked, no-programs, unreachable})
                    / count(all institutions in country)
```

The denominator is the **true registry count** recorded by the `universe` skill. Coverage
is a measured fact. "Estimated coverage" is forbidden language. See
`docs/coverage-methodology.md`.

### 1.5 — Multi-source union within each institution

Enumerating the universe from a registry fixes _which institutions_ are checked. Finding
_programs_ within each institution still uses a multi-source union — official program
pages first, then aggregators (Studyportals, FindAMasters/FindAPhD) and web search as
supplements. One source is never trusted alone.

### 1.6 — Scope is enforced, breadth is not capped

The agent enforces the scope (field + countries) the student set. Within that scope it
does **not** narrow to "prominent" or "top-ranked" institutions. Every institution in the
registry is in scope. Ranking affects _scoring_, never _whether an institution is
searched_.

## Enforcement checklist

- [ ] `universe.json` exists and its `total` per country equals the registry count.
- [ ] No `catalog` worker was given an institution absent from `universe.json`.
- [ ] At run end, no `unchecked` entries remain.
- [ ] The coverage figure in the report is computed from `universe.json`, not typed.
- [ ] `unreachable` institutions are listed by name as known gaps.

## Related

- `skills/universe.skill.md` — implements 1.1–1.4.
- `skills/catalog.skill.md` — bound by the 1.1 hard gate.
- `docs/country-registries.md` — the registry sources for 1.2.
- `docs/coverage-methodology.md` — the math for 1.4.
