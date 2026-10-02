# Admission Factors (IPEDS ADM)

> Status: **built** 2026-09-29 (the last wave 1 spec). Source file already downloaded by `sync-data` and `sync-history`.
> Research 2026-09-28; every admissions file probed 2026-09-29. Part of [data-expansion](README.md).

## As built (2026-09-29)
- **Snapshot:** `admissions.factors` for 1,586 colleges, read by `factorsFrom()` in `lib/derive.ts` (fall 2024 counts match
  the table below exactly). Values `"required" | "considered" | "not_considered"`; the snapshot is always fall 2022 or
  later, so "recommended" never appears in it. `test_policy` keeps its own reader.
- **Columns by year (probed):** ADMCON1–6 and 8 in IC2001–IC2004, ADMCON9 from IC2005, ADMCON10–12 from ADM2022. Codes:
  1, 2, 3, 4 (don't know) through fall 2015; 5 appears from fall 2016; only 1, 3, 5 from fall 2022. 4, 9, and
  negatives are dropped.
- **Profile:** "What they look at" on the admissions page, after the funnel and yield (`components/school/AdmissionFactors.tsx`): each
  factor's use, GPA first, and "Considers whether an applicant's parent attended (legacy status)" when it does. A "Recent
  change" line appears for factor changes from fall 2023 on (both years in the modern codes).
- **Explore:** "What they look at" filter: "Doesn't consider legacy", "Essay not required", "GPA required"
  (`lib/factors.ts`). **Compare:** one row per factor. **Glossary:** `admission-factor`, `legacy-status`,
  `secondary-school-record`, `college-prep-program`.
- **History:** one code series per factor (`factor_{name}`), stored raw like `test_policy` (so meanings stay era-aware),
  plus `live_on`, `tuition_guarantee`, and `promise` (1 yes, 2 no) for the housing policies. The ADM/IC eras split at
  2005 and 2022 where the columns change; the build checks each series ends on the snapshot's value.
- **Events** (`lib/events.ts`), derived from those series, never hand-kept: required ↔ not required in any era; any
  change once both years are fall 2022+; **not** a change out of "recommended" across the 2021 → 2022 redesign (a
  re-coding: Vanderbilt's recommendations went from recommended to required that year); and not a change undone within
  two years. Shown in **Over time → Changes** for the last 10 years only, with a note that a change can reflect how a
  college answered the survey.
- **Why only 10 years:** older events cluster in single years, which points to survey changes rather than decisions
  (e.g. 433 "stopped requiring first-years to live on campus" in 2010–2012 after 111 went the other way in 2005–2007; 55
  "stopped offering a tuition guarantee" in 2009 alone). Across all years the rules give 5,468 events at 1,544 colleges;
  2,627 in the last 10.
- **Home fact:** "Fewer colleges weigh legacy" (`facts.legacy`): of 1,559 colleges reporting legacy in fall 2022 and
  fall 2024, those considering it fell from 502 (32%) to 431 (28%): 88 stopped, 17 started. Four facts sit 2 × 2.

## Question it answers
*What does this college look at?* Is high school GPA required? Do essays, recommendations, or **legacy status** count?
This is the only GPA information federal data has for every college. It says whether GPA is used, not what GPAs
admitted students had ([cds-admissions.md](cds-admissions.md) covers the numbers).

## Source
IPEDS Admissions survey, `ADM{Y}` (and `IC{Y}` through fall 2013). One code per factor.

| Column | Factor | Years |
|---|---|---|
| `ADMCON1` | Secondary school GPA | fall 2001 on (verified in IC2005, IC2013, ADM2014–ADM2024) |
| `ADMCON2` | Secondary school rank | same |
| `ADMCON3` | Secondary school record | same |
| `ADMCON4` | Completion of college-preparatory program | same |
| `ADMCON5` | Recommendations | same |
| `ADMCON6` | Formal demonstration of competencies | same |
| `ADMCON7` | Admission test scores (**already used** as `test_policy`) | same |
| `ADMCON8` | English proficiency test | same |
| `ADMCON9` | Other test (Wonderlic, WISC-III, etc.) | same |
| `ADMCON10` | Work experience | **fall 2022 on** |
| `ADMCON11` | Personal statement or essay | fall 2022 on |
| `ADMCON12` | Legacy status | fall 2022 on |

**Codes** (the same eras as `ADMCON7`, see `registry.mts`): 1 required; 2 recommended (through fall 2021);
3 neither required nor recommended, which from fall 2022 means **not considered, even if submitted**; 5 considered
but not required (from fall 2016); 4 (don't know) and negatives count as not reported. Only "required" means the same
thing in every era.

### What the files show (site colleges, 2026-09-28)
| Factor | Fall 2024 (1,586 reporting) |
|---|---|
| GPA | required 1,383 · considered 135 · not considered 68 |
| Class rank | required 88 · considered 769 · not considered 729 |
| Recommendations | required 471 · considered 612 · not considered 503 |
| Essay | required 517 · considered 645 · not considered 424 |
| Legacy status | considered 439 · not considered 1,147 |

**Legacy is falling:** 507 of 1,577 colleges considered it in fall 2022, 439 of 1,586 in fall 2024. On a fixed panel of
1,559 colleges, **89 stopped and 18 started**. Class rank has moved from "required" to "considered" for a decade
(required: 257 in 2014, 88 in 2024).

Vanderbilt fall 2024: GPA required, rank considered, essay required, legacy considered.

## Ingest
- `sync-data`: read `ADMCON1`–`12` from the ADM table it already loads; map codes with one function shared with
  `test_policy` (move `POLICY_BY_ADMCON7` into a per-era `admissionFactor(code, year)` in lib/derive.ts).
- Values: `"required" | "considered" | "recommended" | "not_considered" | null`. `recommended` appears only before 2022.
- Assert all 12 columns exist from fall 2022; 1–9 before.

## Store
```ts
admissions.factors: {
  gpa, class_rank, hs_record, college_prep, recommendations, competencies,
  english_test, other_test, work_experience, essay, legacy
}: Record<string, FactorUse | null>   // test scores stay in admissions.test_policy
```
Registered as one field `admissions.factors` (source `ipeds-adm`, vintage `ipeds-adm`). ~200 bytes per college.

## Display
- **Profile, admissions page:** "What they look at": a compact grid of factors with Required / Considered /
  Not considered, GPA first. Legacy gets its own line when considered ("Considers whether a parent attended").
  When a college has a CDS C7 answer ([cds-admissions.md](cds-admissions.md)), that richer 4-level weighting replaces
  the grid, with the federal answer in the citation.
- **Explore filters:** "Doesn't consider legacy", "Essay not required", "GPA required".
- **Compare:** one row per factor in "All the numbers".
- **Glossary:** `admission-factor`, `legacy-status`, `secondary-school-record`, `college-prep-program`.

## Keep history?
**Events, plus a national series.** The events log built here also takes the policy events that
[housing-and-policies.md](housing-and-policies.md) deferred to it: first-years' live-on requirement, tuition plans, and
Promise program participation (history family `characteristics`).
- Per college, factor changes are **events** (e.g. "Stopped considering legacy status, fall 2023"). Only compare within
  an era: a 2021 → 2022 change from "neither" (3) to "not considered" (3) is the same code but a new meaning, and
  "recommended" → anything in 2022 is a re-coding, not a decision. Record events only for: required ↔ not
  required (all eras), and any change within the fall 2022+ era.
- Store the full yearly code per factor in the shard's admissions family (cheap: 11 small ints a year), so events are
  derived, not hand-kept.

## Top-level trend?
- **Home fact: yes, the strongest candidate from this wave.** "Fewer colleges consider legacy status": fixed panel,
  fall 2022 → newest year, with the count that stopped. Link to the Explore filter. Refresh each December.
- **Hero indicator: no.** A policy, not a measure; most colleges never change.
- **Profile:** events appear on the Over time page's Policy changes group, and one line under the admissions page's headline when a change
  happened in the last 3 years.

## Open questions
1. Show "recommended" (pre-2022 only) at all? Recommendation: only in history, never in the current grid.
2. Legacy wording must be neutral ("considers legacy status"), consistent with the no-verdict rule for trends.
