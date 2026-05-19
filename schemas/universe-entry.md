# Schema: Universe Entry

**This schema is the Stage A fix made concrete.** Stage A failed because no data structure
ever held "the complete list of universities to check" — the model improvised the list
from memory. The universe checklist removes that improvisation: it is the authoritative,
on-disk list of _every_ institution in scope, and it gates all searching.

- **File:** `universe.json` — an array of universe entries, one per institution.
- **Written by:** `skills/universe.skill.md`, from the registries in
  `docs/country-registries.md`.
- **Consumed by:** `skills/catalog.skill.md` (iterates unchecked entries) and
  `skills/reporting.skill.md` (computes coverage).
- **Hard rule:** `catalog` may **never** search an institution that is not a row here.
  See `rules/01-search-completeness.md`.

## Structure

```json
{
  "schema_version": "1.0",
  "run_id": "2026-fall-csai-us-ca-uk",
  "generated": "2026-05-18",
  "registry_sources": {
    "UK": "Office for Students Register + SFC + HEFCW + DfE NI",
    "US": "NCES IPEDS (Carnegie: Doctoral + Master's institutions)",
    "Canada": "Universities Canada membership + StatCan PSIS"
  },
  "institutions": [
    {
      "id": "uk_university_of_sheffield",
      "name": "University of Sheffield",
      "country": "UK",
      "region": "England — Yorkshire",
      "registry_source": "Office for Students Register",
      "official_url": "https://www.sheffield.ac.uk",
      "status": "checked",
      "programs_found": 2,
      "last_checked": "2026-05-18",
      "checked_by_batch": "uk-batch-03",
      "notes": ""
    },
    {
      "id": "uk_university_of_southampton",
      "name": "University of Southampton",
      "country": "UK",
      "region": "England — South East",
      "registry_source": "Office for Students Register",
      "official_url": "https://www.southampton.ac.uk",
      "status": "unchecked",
      "programs_found": null,
      "last_checked": null,
      "checked_by_batch": null,
      "notes": "Missed entirely in Stage A — exactly the failure this file prevents."
    }
  ]
}
```

## Field reference

| Field              | Type           | Notes                                                                                    |
| ------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| `id`               | string         | Stable slug: `<country>_<institution>`. Lower-case, deduplicated.                        |
| `name`             | string         | Official institution name as it appears in the registry.                                 |
| `country`          | string         | In-scope country.                                                                        |
| `region`           | string         | State / province / nation — useful for batch slicing and location scoring.               |
| `registry_source`  | string         | Which registry this row came from. Provenance for the universe itself.                   |
| `official_url`     | string         | The institution's official domain — the trusted root for `catalog`/`enrichment` fetches. |
| `status`           | enum           | `unchecked` \| `checked` \| `no-programs` \| `unreachable`.                              |
| `programs_found`   | int \| null    | Count of in-scope programs found at this institution; `null` until checked.              |
| `last_checked`     | date \| null   | When `catalog` last processed this entry.                                                |
| `checked_by_batch` | string \| null | Which worker batch handled it — supports resumability.                                   |
| `notes`            | string         | Free text — e.g. "site blocked automation", "merged with X in 2025".                     |

## Status semantics

- **`unchecked`** — in scope, not yet processed. **A run is not complete while any
  `unchecked` row remains** (`rules/01-search-completeness.md`).
- **`checked`** — processed; `programs_found` ≥ 0 recorded.
- **`no-programs`** — processed; the institution offers nothing in the scoped field.
  Distinct from `checked` so coverage math is honest (it _was_ checked).
- **`unreachable`** — could not be processed (site down, blocked past the real-browser
  tier). Counts against coverage and is listed as a known gap in the coverage report.

## Why this exists

Coverage is computed directly from this file:

```
coverage(country) = count(status in {checked, no-programs, unreachable})
                    / count(all institutions in country)
```

If the universe file is complete and correct, coverage is a _measured fact_, not a guess.
That is the entire difference between Stage A's "~60%, estimated" and Stage B's computed
figure. See `docs/coverage-methodology.md`.
