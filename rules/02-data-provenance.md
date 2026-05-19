# Rule 02 — Data Provenance

The detailed rule behind Iron Rule 5. Every fact FInder shows a student must be traceable
and dated. Detail behind the Stage A "stale data" failure.

---

## The problem this prevents

In Stage A, the agent reported a scholarship (Vanier) using the model's training
knowledge. The programme had since been restructured. Nothing in the data flagged that the
fact was unverified and possibly stale — it looked exactly as trustworthy as a fact
fetched from an official page that morning. A student could have planned around a
scholarship that no longer worked as described.

Provenance metadata makes the difference between "verified today" and "the model thinks"
**visible and enforceable**.

## The rule

### 2.1 — Every record carries provenance

Every program record and scholarship record has a `provenance` block with:

- `source_urls` — the official page(s) the facts came from.
- `last_verified` — the date the facts were confirmed against those sources.
- `source_confidence` — one of:
  - **`web-verified`** — confirmed on an official source during this run.
  - **`model-knowledge`** — taken from the model's training; **not yet confirmed**.
  - **`community`** — supplied by a community contributor (hosted/open-source
    crowdsourcing); treated as unverified until checked.

### 2.2 — Unverified data does not reach the student

A record whose `source_confidence` is `model-knowledge` or `community` is **excluded from
final output** (spreadsheet, shortlist, briefs) until it has been web-verified. It may
exist in the working catalog as a lead, clearly marked `UNVERIFIED`, but it is never
presented as fact.

### 2.3 — Prefer official sources

Source priority, highest first:

1. Official university pages (program, admissions, fees, funding).
2. Official government / immigration portals (visa, proof-of-funds).
3. Official national bodies (registries, accreditation, national scholarship schemes).
4. Reputable aggregators (Studyportals, FindAMasters/FindAPhD, QS/THE) — for _discovery_,
   cross-checked against official sources before a fact is recorded as verified.

### 2.4 — Conflicts are flagged, not silently resolved

If two sources disagree (e.g. two tuition figures), record **both**, cite both, and flag
the conflict. Do not pick one and hide the other. The student decides with full
information.

### 2.5 — Freshness has a shelf life

`last_verified` is not decoration. A record older than the refresh policy is **stale** and
must be re-verified before reuse — especially deadlines, tuition, and requirements, which
change every admission cycle. The hosted catalog refreshes on a schedule (more often as a
cycle's deadlines approach); a self-host run re-verifies anything past its shelf life.

### 2.6 — Every output fact is sourced

In the master spreadsheet, briefs, and reports, every non-obvious fact shows its source
link and `last_verified` date, and the student is told to confirm officially before
relying on it. FInder is decision support, not the system of record.

## Enforcement checklist

- [ ] No record reaches final output with `source_confidence` ≠ `web-verified`.
- [ ] Every record has a non-empty `source_urls` and a `last_verified` date.
- [ ] Conflicting facts appear as conflicts, with both sources.
- [ ] Records past the refresh shelf life were re-verified, not reused blind.
- [ ] Visa / proof-of-funds facts cite an official government source + date.

## Related

- `schemas/program-record.md`, `schemas/scholarship-record.md` — the `provenance` block.
- `skills/enrichment.skill.md` — stamps provenance; runs the tiered fetch.
- `rules/04-honesty-and-scope.md` — the honesty obligations provenance supports.
