# Schema: Scholarship Record

A funding source — government, university, or third-party. Scholarships are **separate
entities** from programs: one scholarship (e.g. a national government scheme) can apply to
many programs across many institutions, and eligibility is often nationality-gated
independently of any program's admission criteria.

- **File:** stored as shards during a run, merged into `scholarships.json`.
- **Written by:** `skills/enrichment.skill.md` (scholarship sub-pass).
- **Consumed by:** `skills/scoring.skill.md` (funding dimension) and `reporting`.
- **Provenance mandatory**, same as program records — see `rules/02-data-provenance.md`.

## Why separate from program records

Stage A surfaced this clearly. The strongest funding lead for the test student was the
**El-Yurt Umidi Foundation** (an Uzbek government scheme) — it is attached to _no single
program_; it funds the student wherever they enroll. Folding scholarships into program
records would have lost it. Conversely, **GREAT** and **Commonwealth** scholarships were
nationality-ineligible for the student regardless of which program — a fact best modeled
once on the scholarship, not repeated on every program.

## Structure

```json
{
  "schema_version": "1.0",
  "id": "el_yurt_umidi",
  "name": "El-Yurt Umidi Foundation Scholarship",
  "funder": "Government of Uzbekistan",
  "funder_type": "national-government",
  "type": "full",

  "eligibility": {
    "nationalities": ["Uzbek"],
    "countries_of_study": ["US", "UK", "Canada", "and others"],
    "degree_levels": ["Master's", "PhD"],
    "other_conditions": [
      "Uzbek citizen",
      "admission to an approved foreign university",
      "may require IELTS/TOEFL independently of any university waiver"
    ]
  },

  "value": {
    "covers": ["tuition", "living stipend", "travel"],
    "amount_note": "Full coverage; varies by destination country"
  },

  "application": {
    "deadline": "Annual cycle — verify at source",
    "portal": "https://eyuf.uz",
    "linked_to_program_admission": false
  },

  "provenance": {
    "source_urls": ["https://eyuf.uz"],
    "last_verified": "2026-05-17",
    "source_confidence": "model-knowledge",
    "verification_notes": "Operational status and current cycle MUST be web-verified before use in final output."
  }
}
```

## Field reference

| Field                                     | Notes                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `funder_type`                             | `national-government` \| `university` \| `intergovernmental` \| `private` \| `research-council`.                                                |
| `type`                                    | `full` (tuition + living) \| `partial` \| `tuition-only` \| `fee-discount`.                                                                     |
| `eligibility.nationalities`               | The single most common disqualifier. Checked against `student-profile.identity.nationality`.                                                    |
| `eligibility.countries_of_study`          | Which destinations the award is valid for.                                                                                                      |
| `application.linked_to_program_admission` | If `true`, awarded with the offer (e.g. an automatic university scholarship); if `false`, a separate application/timeline.                      |
| `provenance.source_confidence`            | Government-scheme details drift (eligibility, cycles). `model-knowledge` records are flagged and excluded from final output until web-verified. |

## Worked examples from Stage A

| Scholarship                                                            | Eligible for an Uzbek student?    | Why                                                                        |
| ---------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| El-Yurt Umidi                                                          | Yes — strongest lead              | Targets exactly this nationality + destinations.                           |
| Chevening                                                              | Eligible country, but **not yet** | Requires ~2 years post-graduation work experience.                         |
| GREAT                                                                  | No                                | Uzbekistan not a participating country.                                    |
| Commonwealth                                                           | No                                | Uzbekistan is not a Commonwealth member.                                   |
| University automatic awards (e.g. Sheffield Merit, Bath International) | Yes                               | Open to all international applicants; `linked_to_program_admission: true`. |

## Related

- `schemas/program-record.md` — programs link to scholarships by country/eligibility.
- `docs/scoring-model.md` — scholarships feed the funding-fit dimension.
