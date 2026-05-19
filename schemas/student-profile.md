# Schema: Student Profile

The student's durable, on-disk profile. Single source of truth for everything personal.
Written by the `intake` skill, re-read by every other skill, never held only in chat.

- **File:** `student-profile.json` (one per student)
- **Lifecycle:** created at intake; updated whenever the student says something new;
  re-read at the start of _every_ skill invocation (see `rules/03-orchestration.md`).
- **Privacy:** contains passport, GPA, finances — sensitive. Self-host: stays on device.
  Hosted: per-student isolation, minimize retention. See `rules/04-honesty-and-scope.md`.

## Design notes

- The schema is the agent's **internal checklist**, never shown to the student as a form.
- Every field may be `null` / `"unknown"` — FInder begins searching on partial data and
  asks follow-ups only when a step actually needs a missing field.
- `real_goal` drives scoring weights. `custom_notes` is free text converted to scoring
  factors. Both are first-class, not afterthoughts.

## Structure

```json
{
  "schema_version": "1.0",
  "created": "2026-05-17",
  "last_updated": "2026-05-18",

  "identity": {
    "nationality": "Uzbek",
    "country_of_residence": "Uzbekistan",
    "languages": ["Uzbek", "Russian", "English (academic)"]
  },

  "academics": {
    "institution": "New Uzbekistan University",
    "degree": "Bachelor's in Economics & Data Science",
    "year_status": "3rd year (Junior) — completed May 2026",
    "expected_graduation": "2027-06",
    "gpa_raw": "3.0 / 4.5",
    "gpa_us_4_0": 2.67,
    "gpa_notes": "Recent years (2nd, 3rd) ~2.93-3.02/4.0; freshman year ~2.0/4.5 drags cumulative.",
    "instruction_language": "English-medium throughout",
    "key_coursework": ["machine learning", "statistics", "data structures"]
  },

  "tests": {
    "gre": { "status": "none", "score": null, "planned_date": null },
    "english": {
      "status": "planned",
      "test_type": "Duolingo English Test (DET)",
      "score": null,
      "target": "DET 120+",
      "notes": "Strategy: (A) English-medium waiver letter from registrar; (B) DET as backup; (C) IELTS/TOEFL last resort. DET NOT accepted by CMU SV, Georgia Tech, Waterloo, UIUC."
    },
    "other": []
  },

  "experience": {
    "research_publications": "none",
    "internships": "none",
    "projects": "coding projects — GitHub portfolio (details to be supplied)",
    "achievements": []
  },

  "references": {
    "count_confirmed": 0,
    "potential_sources": ["project mentors", "current professors"],
    "self_assessed_strength": "unknown"
  },

  "financial": {
    "budget": "full scholarship required — cannot self-fund tuition",
    "funding_need": "fully_funded",
    "proof_of_funds_capacity": "unknown",
    "external_scholarships": ["El-Yurt Umidi Foundation (Uzbek govt) — to apply"]
  },

  "preferences": {
    "target_countries": ["US", "Canada", "UK"],
    "target_intake": "Fall 2027",
    "fields": ["Computer Science", "Artificial Intelligence", "Machine Learning", "Data Science"],
    "program_types_acceptable": ["MS", "MEng", "PhD (if funded)"],
    "language_of_instruction": "English",
    "location_priority": "Silicon Valley / Bay Area #1; Canada / UK fallback",
    "deal_breakers": ["unfunded programs the student cannot pay for"]
  },

  "real_goal": {
    "primary": "Physical presence in the Silicon Valley ecosystem to build a startup",
    "degree_role": "vehicle — a means to a US student visa and physical location",
    "post_graduation_intent": "Stay via F-1 OPT / STEM OPT; build a startup",
    "scoring_profile": "program-as-vehicle"
  },

  "custom_notes": [
    "Location and funding outweigh prestige, ranking, and research rigor.",
    "Low-research-burden programs preferred, but a funded research PhD is acceptable as a vehicle."
  ]
}
```

## Field reference

| Group        | Field               | Notes                                                                                                                        |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| identity     | `nationality`       | Drives the visa & immigration scoring dimension.                                                                             |
| academics    | `gpa_us_4_0`        | Normalized GPA; `gpa_raw` keeps the original scale. Never silently convert in output — show both.                            |
| tests        | `english.test_type` | One of: IELTS, TOEFL, Duolingo (DET), PTE, none. Acceptance varies per program — see `program-record.md`.                    |
| references   | `count_confirmed`   | Many programs need 2–3; a shortfall is surfaced in the gap report.                                                           |
| financial    | `funding_need`      | `fully_funded` \| `partial_ok` \| `self_fund`. Gates the funding dimension.                                                  |
| real_goal    | `scoring_profile`   | One of the presets in `docs/scoring-model.md`: `phd-academia`, `immigrate-settle`, `program-as-vehicle`, `cheapest-fastest`. |
| custom_notes | —                   | Free text. The `scoring` skill converts each note into a weighted factor.                                                    |

## Related

- Written by `skills/intake.skill.md`
- Consumed by `skills/scoring.skill.md` (and read by all skills)
- Goal → weights mapping in `docs/scoring-model.md`
