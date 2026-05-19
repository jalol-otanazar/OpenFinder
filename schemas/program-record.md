# Schema: Program Record

One graduate program. The unit of the catalog. Created by `catalog` (identity + a stub),
filled in by `enrichment`, scored by `scoring`.

- **File:** stored as catalog shards during a run, merged into `catalog.json`.
- **Provenance is mandatory** — every record carries `last_verified` and
  `source_confidence`. See `rules/02-data-provenance.md`.
- **Reusable** — the catalog is shared across students; only scoring is per-student.

## Structure

```json
{
  "schema_version": "1.0",
  "id": "uk_sheffield_msc_ai",
  "institution_id": "uk_university_of_sheffield",

  "identity": {
    "university": "University of Sheffield",
    "program": "MSc in Artificial Intelligence",
    "department": "Department of Computer Science",
    "country": "UK",
    "city": "Sheffield",
    "degree_type": "MSc",
    "language": "English",
    "duration_months": 12
  },

  "requirements": {
    "min_gpa": { "raw": "2:2 UK honours", "us_4_0_equivalent": 2.7 },
    "required_background": "CS / Math / Engineering with programming",
    "prerequisites": ["programming", "linear algebra"],
    "gre": "not_required",
    "english_tests": {
      "ielts": "6.5 overall (6.0 each component)",
      "toefl": "88 iBT",
      "duolingo": "120",
      "pte": "61"
    },
    "english_waiver": {
      "available": true,
      "basis": "English-medium instruction; registrar letter accepted",
      "confidence": "web-verified"
    },
    "reference_letters": 2,
    "other_documents": ["CV", "statement of purpose", "transcripts"]
  },

  "logistics": {
    "application_deadlines": ["2027-05 (rolling; apply Dec 2026 for scholarships)"],
    "intake_terms": ["September"],
    "application_fee": "0 GBP",
    "application_portal": "https://www.sheffield.ac.uk/postgraduate/apply",
    "decision_timeline": "4-8 weeks, rolling"
  },

  "cost_and_funding": {
    "tuition_international": { "amount": 26590, "currency": "GBP", "period": "year" },
    "living_cost_estimate": { "amount": 10000, "currency": "GBP", "period": "year" },
    "scholarships_for_internationals": [
      "Sheffield Merit: 3000 GBP automatic + up to 10000 GBP competitive"
    ],
    "funding_likelihood": "partial",
    "fully_funded": false
  },

  "outcomes": {
    "field_ranking": "Top 15 UK (CS); Russell Group",
    "post_study_work_rights": "UK Graduate Route — 2 years",
    "placement_info": "strong NLP research lineage (GATE toolkit)"
  },

  "provenance": {
    "source_urls": [
      "https://www.sheffield.ac.uk/postgraduate/taught/courses/2027/artificial-intelligence-msc",
      "https://www.sheffield.ac.uk/postgraduate/fees/scholarships"
    ],
    "last_verified": "2026-05-18",
    "source_confidence": "web-verified",
    "verification_notes": "Fetched from official program + scholarship pages."
  }
}
```

## Field reference — highlights

| Group            | Field                       | Notes                                                                                                                                                                |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity         | `degree_type`               | MS / MEng / MSc / MCS / PhD / etc. — kept verbatim per institution.                                                                                                  |
| requirements     | `min_gpa.us_4_0_equivalent` | Normalized so scoring can compare to the profile; `raw` preserves the original.                                                                                      |
| requirements     | `english_tests`             | Per-test accepted scores. **Absence of `duolingo` means DET is not accepted** — a real distinction (CMU SV, Georgia Tech, Waterloo, UIUC).                           |
| requirements     | `english_waiver`            | Whether an English-medium-instruction waiver is possible, the basis, and how confident.                                                                              |
| cost_and_funding | `funding_likelihood`        | `full` \| `partial` \| `none` \| `unknown` — feeds the funding dimension.                                                                                            |
| cost_and_funding | `fully_funded`              | Hard boolean: does a path exist that covers tuition + living for an international student?                                                                           |
| outcomes         | `post_study_work_rights`    | Country work-visa pathway — feeds the visa & immigration dimension.                                                                                                  |
| provenance       | `source_confidence`         | `web-verified` \| `model-knowledge` \| `community`. **`model-knowledge` records are excluded from final output** until web-verified (`rules/02-data-provenance.md`). |
| provenance       | `last_verified`             | Date the facts were confirmed against the source. Stale records are flagged for refresh.                                                                             |

## Lifecycle

1. `catalog` creates the record with `identity`, `institution_id`, and a provenance stub.
2. `enrichment` fills `requirements`, `logistics`, `cost_and_funding`, `outcomes`, and
   completes `provenance` with fetched `source_urls` + `last_verified`.
3. `scoring` reads it (read-only) and emits a separate scored entry — see
   `schemas/run-manifest.md` and `skills/scoring.skill.md`.

## Related

- `schemas/scholarship-record.md` — scholarships are separate entities, linked by country / eligibility.
- `docs/scoring-model.md` — how these fields become a score.
