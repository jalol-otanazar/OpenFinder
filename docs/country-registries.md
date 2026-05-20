# Country Registries

**This is core infrastructure, not an appendix.** The Registry Layer is the component
whose absence caused the Stage A UK failure (`docs/stage-a-retrospective.md`). This
document names the authoritative institution registry for each country and gives the
recipe for adding any new one.

The `universe` skill reads this document to know where to fetch the institution list.

---

## Why a registry, not the model

An LLM asked "what universities are in the UK?" returns the ones it knows well and omits
the rest — confidently, invisibly. A **registry** is the official, complete list a
national authority maintains. Enumerating from the registry is the difference between
~60% UK coverage (Stage A) and a measured, near-complete one (Stage B).

A good registry source is: **official** (a government / national body), **complete** (all
degree-granting institutions, not a ranking subset), and **fetchable** (bulk export, API,
or a searchable database — not just prose).

## Preloaded registries

### United Kingdom

| Source                                         | Covers           | Notes                                                     |
| ---------------------------------------------- | ---------------- | --------------------------------------------------------- |
| Office for Students — Register of HE providers | England          | Official regulator register; bulk download.               |
| Scottish Funding Council — funded institutions | Scotland         | Official.                                                 |
| HEFCW / Medr — funded institutions             | Wales            | Official.                                                 |
| Dept. for the Economy — HE institutions        | Northern Ireland | Official.                                                 |
| HESA — list of HE providers                    | Whole UK         | Use as a **union / cross-check** across the four nations. |

**Universe = the union of all four nations**, deduplicated against HESA. Stage A missed
Southampton, Leeds, Glasgow, Warwick precisely because no UK-wide list was ever fetched.

### United States

| Source                                                      | Covers                        | Notes                                                                                                             |
| ----------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| NCES IPEDS                                                  | All Title IV institutions, US | The authoritative federal dataset; bulk download.                                                                 |
| Carnegie Classification of Institutions of Higher Education | Filter                        | Filter IPEDS to "Doctoral" + "Master's" institutions — those that can plausibly offer graduate programs in scope. |

### Canada

| Source                                     | Covers               | Notes                                     |
| ------------------------------------------ | -------------------- | ----------------------------------------- |
| Universities Canada — member institutions  | Universities, Canada | The standard national list.               |
| Statistics Canada — PSIS institution list  | All postsecondary    | Broader; cross-check.                     |
| Provincial designations (e.g. Ontario, BC) | Per province         | For provincially-designated institutions. |

### Australia

| Source                                                  | Covers                                 | Notes                        |
| ------------------------------------------------------- | -------------------------------------- | ---------------------------- |
| TEQSA — National Register of higher education providers | All registered HE providers, Australia | Official regulator register. |

### Germany

| Source                                              | Covers                                       | Notes                                                |
| --------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Hochschulkompass (HRK — German Rectors' Conference) | All recognised higher education institutions | Official; searchable; also lists programs.           |
| DAAD                                                | Cross-check                                  | Authoritative for international-facing program data. |

### Netherlands

| Source                                          | Covers                                   | Notes                                          |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| DUO — register of recognised institutions / RIO | All recognised institutions, Netherlands | Official government register.                  |
| Nuffic / studyfinder                            | Cross-check                              | Authoritative for accredited program listings. |

## Added in this round (Western Europe, Nordics, Asia)

Every provider below accepts a `FINDER_<CC>_REGISTRY_URL` environment variable to swap the
default source URL. Sources marked **lower-confidence** rely on a union of independent
lists (per §3 below) rather than a single official register; the coverage report shows
the flag so students can read the universe in context.

### France

| Source                                                   | Covers                          | Notes                                               |
| -------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| data.esr — "Principaux établissements" CSV               | Universities, grandes écoles    | Official open-data export; semicolon-delimited CSV. |

### Italy

| Source                              | Covers           | Notes                                       |
| ----------------------------------- | ---------------- | ------------------------------------------- |
| MUR ustat — Atenei                  | All universities | Official CSV from the Ministero ustat API. |

### Spain (lower-confidence)

| Source                                              | Covers                                    | Notes                                              |
| --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| Ministerio de Universidades — RUCT directory page   | Recognised Spanish universities           | No public CSV; HTML scrape of the official listing. |

### Switzerland (lower-confidence)

| Source                                | Covers                                                       | Notes                                                |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| swissuniversities — member list       | Cantonal universities, ETH/EPFL, universities of applied sciences | The umbrella organisation of all recognised Swiss HEIs. |

### Austria (lower-confidence)

| Source                                              | Covers                                                                | Notes                                          |
| --------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| BMBWF — Hochschulsystem directory                   | Universitäten, Fachhochschulen, pädagogische Hochschulen, Akademien   | The federal ministry's recognised-HEI listing. |

### Belgium (lower-confidence — union)

| Source                                                | Covers                          | Notes                                                |
| ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| VLIR — Flemish universities                           | Flanders                        | Flemish-community umbrella organisation.             |
| CRef / ARES — Wallonia-Brussels universities          | Wallonia-Brussels               | French-community umbrella organisation.              |

### Ireland (lower-confidence)

| Source                                       | Covers                                                                | Notes                                  |
| -------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| HEA — designated higher-education institutions | Universities, technological universities, IoTs, colleges of education | The Higher Education Authority listing. |

### Sweden (lower-confidence)

| Source                                  | Covers                                                | Notes                                       |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| UKÄ — Swedish HE institutions           | State, independent, and private degree-awarding HEIs  | Swedish HE Authority directory.             |

### Norway (lower-confidence)

| Source                                                | Covers                                              | Notes                                           |
| ----------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| NOKUT / Study in Norway — accredited HE institutions  | Universities + university colleges                  | NOKUT is the accreditation agency.              |

### Denmark (lower-confidence)

| Source                                                  | Covers                                                                 | Notes                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| UFM / Study in Denmark — recognised HE institutions     | Universities, business schools, university colleges, academies         | Ministry of HE and Science directory.            |

### Finland (lower-confidence)

| Source                                              | Covers                                          | Notes                                          |
| --------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| OPH / Study in Finland — universities and UAS       | Yliopisto + ammattikorkeakoulu                  | National Agency for Education directory.       |

### China (lower-confidence)

| Source                                        | Covers                                | Notes                                                                                  |
| --------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| MoE-recognised universities (Wikipedia mirror) | All MoE-recognised HEIs               | The MoE page is partially geofenced; default uses a Wikipedia mirror as cross-check.   |

### Japan (lower-confidence — union)

| Source                                                | Covers                                       | Notes                                                                     |
| ----------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| MEXT-recognised universities (Wikipedia cross-check)  | National, public, private universities       | MEXT publishes HTML in Japanese only; the Wikipedia mirror is reliable.   |
| JAUP — Japan Association of Private Universities      | Private universities                         | Strengthens private-sector coverage.                                      |

### Korea (lower-confidence — union)

| Source                                              | Covers                                | Notes                                                  |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| KCUE — Korean Council for University Education      | Recognised universities               | The national university council.                       |
| KEDI — Korean Educational Development Institute     | National universities                 | National research-and-statistics body.                 |

### Singapore (lower-confidence — union)

| Source                                          | Covers                                | Notes                                  |
| ----------------------------------------------- | ------------------------------------- | -------------------------------------- |
| MOE — autonomous universities                   | The six public autonomous universities | Government-funded universities.        |
| CPE — registered private HEIs                   | CPE-registered private universities    | Committee for Private Education list.  |

## The add-a-country recipe

When the student scopes a country not listed above, the `universe` skill follows this
recipe and records the new source back into this document:

1. **Find the national authority's register.** Look for the ministry of education, the
   national HE regulator, or the national accreditation body. Their register of recognised
   degree-granting institutions is the universe source. (Search pattern: _"\<country\>
   official register of higher education institutions"_, _"\<country\> ministry of
   education accredited universities"_.)
2. **Confirm it is complete and fetchable.** It must list _all_ degree-granting
   institutions and be retrievable as a list (export, API, or searchable database).
3. **If no official register exists** — some countries have none public — build the
   universe from a **union of independent lists**: national university association
   membership + a recognised national ranking table + the relevant "List of universities
   in \<country\>" reference. Mark the universe entries' `registry_source` accordingly and
   the coverage report notes the **lower-confidence** basis. A union of independent lists
   is still enumeration; the model's memory is still never the source.
4. **Record the source here** so the next run reuses it.

## Registry hygiene

- **Deduplicate.** Multi-campus systems, federated universities, and recent mergers cause
  double-counting. One row per institution that grants its own degrees.
- **Filter to relevant types.** Keep institutions that can plausibly offer graduate
  programs in the scoped field; exclude purely vocational or sub-degree providers — and
  record the filter applied, so the coverage denominator is honest.
- **Date the fetch.** Registries change yearly. Record when the list was retrieved.
- **Cross-check the count.** Compare the registry total against an independent national
  count. A large gap means the fetch was incomplete — fix it before `catalog` runs.

## Related

- `skills/universe.skill.md` — consumes this document.
- `schemas/universe-entry.md` — the row each registry institution becomes.
- `rules/01-search-completeness.md` — why the registry is mandatory.
- `docs/coverage-methodology.md` — how the registry count becomes the coverage denominator.
