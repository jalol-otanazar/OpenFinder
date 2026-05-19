# Skill: Universe

> Pipeline stage 2 of 6. **This is the skill that fixes the Stage A failure.**

## Purpose

Produce a complete, authoritative checklist of _every_ institution in the scoped
countries — `universe.json` — by enumerating from official registries. Nothing downstream
may search an institution that is not a row in this file.

## The rule this skill exists to enforce

> **Never enumerate universities from the model's memory. Always from a registry.**

Stage A asked the model, in effect, "what are the UK universities?" and got a confident,
incomplete answer — Southampton, Leeds, Glasgow, Warwick and dozens more were silently
absent. UK coverage came out at ~60%. This skill makes that impossible: the institution
list is _fetched_, not _recalled_.

## Inputs

- Scope from `intake`: field(s) + countries/regions, recorded in `run-manifest.json`.
- `docs/country-registries.md` — the authoritative registry source per country.

## Outputs

- `universe.json` — an array of universe entries, every one `status: "unchecked"`.
  See `schemas/universe-entry.md`.
- `run-manifest.json` — `coverage.<country>.total` populated.

## Procedure

For **each** country in scope:

1. **Locate the registry.** Read `docs/country-registries.md` for the country's
   authoritative source (e.g. UK → Office for Students Register + SFC + HEFCW + DfE NI;
   US → NCES IPEDS; Canada → Universities Canada). If the country is not listed, follow
   the _add-a-country recipe_ in that doc and record the new source.
2. **Fetch the full list.** Retrieve the registry via the bundled tools (tiered fetch:
   plain → headless → real-browser). Registries are often CSV/searchable databases —
   prefer the bulk export. **Do not stop at "well-known" institutions.**
3. **Filter to in-scope institution types.** Keep degree-granting institutions that can
   plausibly offer graduate programs in the field (e.g. for US, Carnegie "Doctoral" +
   "Master's" institutions). Record the filter applied.
4. **Normalize and deduplicate.** One row per institution. Build the stable `id`
   (`<country>_<institution>`). Merge registry unions (e.g. HESA vs OfS) without
   duplicates.
5. **Write rows.** Each institution becomes a universe entry with `status: "unchecked"`,
   its `official_url`, `registry_source`, and `region`.
6. **Record the total.** Write `coverage.<country>.total = count` into the run manifest.
   This number is the denominator for all coverage math — it must be the _true_ registry
   count, not a sample.
7. **Cross-check (recommended).** Compare the registry count against an independent list
   (a national ranking table, a Wikipedia "list of universities in X"). A large
   discrepancy means the registry fetch was incomplete — investigate before proceeding.

## Hard gates

- `catalog` **may not** process any institution absent from `universe.json`.
- The run is **not complete** while any entry is `status: "unchecked"`
  (`rules/01-search-completeness.md`).
- The model is **never** the source of the institution list. If a registry cannot be
  fetched, that is a _blocking_ problem to surface — not a cue to improvise from memory.

## Rules enforced

- `rules/01-search-completeness.md` — universe-then-check; coverage computed from this file.
- `rules/02-data-provenance.md` — `registry_source` records where each row came from.

## Failure modes prevented

- **The Stage A UK gap.** Enumeration from a registry cannot "forget" Southampton.
- **Invisible incompleteness.** Because `total` is the registry count, a partial run
  _shows_ as <100% coverage instead of looking complete.
- **Aggregator blind spots.** Starting from the registry (not from Studyportals/QS) means
  an institution missing from every aggregator is still on the checklist.

## Handoff

→ `skills/catalog.skill.md`, which iterates the `unchecked` entries in batches.
