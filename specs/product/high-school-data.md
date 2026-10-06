# High School Data: Rigor, Outcomes, and Where Graduates Go

> Status: **built** 2026-10-05 on `feature/high-school` (all four phases; see the "As built" sections at the end).
> Graduation rates come from ED Data Express school-level files (Class of 2021 for now; see
> [graduation rates and history](#as-built-graduation-rates-and-history-2026-10-05)).
> [scattergrams.md](scattergrams.md) and [counselor-portal.md](counselor-portal.md) build on it; the
> [student-profile.md](student-profile.md) high school picker now uses it. Part of [product](README.md).

## Goal
Give every public high school (and later private ones) a page and a record the rest of the site can join to: how
rigorous it is (AP/IB access and pass rates), how its graduates do (graduation rate, share going to college), its
grading scale, and which colleges its graduates attend. Families ask "do kids from *our* school get into
Michigan?" and admissions officers read applications in the context of the school profile; the site should be able
to show both.

The same rules as colleges: cited, dated, no grades or ranks. Niche grades high schools and sells college leads
against them; Quad describes.

## Sources (research 2026-10-02)
| Tier | Source | What | Access | Coverage and refresh |
|---|---|---|---|---|
| **1** | **NCES Common Core of Data (CCD)** | Canonical `ncessch` id, name, district, address, lat/lng, grades served, enrollment by grade/race/sex, charter/magnet, Title I, student-teacher ratio | Bulk CSV from NCES, or the **Urban Institute Education Data API** (`schools/ccd/directory`, `schools/ccd/enrollment`), free, no key | ~24,000 public high schools; annual |
| **1** | **EDFacts** via the same API | Adjusted cohort graduation rate per school | `schools/edfacts/grad-rates` | Annual, ~1 year lag |
| **1** | **Civil Rights Data Collection (CRDC)** | AP course enrollment, AP exam takers and passers, IB enrollment, dual enrollment, by school; also discipline and staffing | Public-use file from civilrightsdata.ed.gov, or the API (`schools/crdc/…`) | Biennial (2021–22 latest at research time; 2023–24 expected) |
| **1** | **NCES Private School Survey (PSS)** | Directory and enrollment for private schools | Bulk CSV | Biennial |
| **2** | **State report cards** | Test proficiency, AP pass rates, college-going rate, chronic absence; some states (e.g. California's CDE, Texas TEA, New York's NYSED, Florida) publish downloadable files | One adapter per state, bulk CSV/XLSX | Annual; start with 4–5 large states |
| **2** | **National Student Clearinghouse** district reports | College enrollment, persistence, and completion by high school; the most complete source for "where graduates go" | Not public as data; districts receive StudentTracker reports and some post them (school board packets, state portals: South Carolina's EOC and Connecticut's EdSight publish them for every public high school) | Opportunistic; state-level adapters where a state publishes |
| **3** | **School profile PDFs** | GPA scale and distribution, weighting, AP/IB courses offered, SAT/ACT ranges, college matriculation list, class size | Crawled from the school's site with the [college-reported engine](../college-reported-data.md#how-it-works) (a recipe per school, cheap re-extraction when the file changes) | Annual (Sept–Nov); the highest-value source and the hardest |
| **3** | Matriculation lists → `unit_id` | "Where the class of 2025 enrolled" matched to IPEDS ids | Name matching against `schools.json` with a review queue for ambiguous names | Per profile |

Not used: Niche or other ratings (proprietary, graded), GreatSchools (licensed), test-prep company data.

## Pipeline
```
CCD / EDFacts / CRDC / PSS ──► data/high-schools/schools.json (one row per school; ~24K public + private later)
state report cards ───────────► data/high-schools/state/{xx}.json (merged by ncessch)
school profile PDFs ─────────► data/high-schools/detail/{ncessch}.json (GPA scale, courses, matriculation)
```
- `npm run sync-high-schools`: fetches the tier 1 sources (API or bulk), normalizes codes, writes the files; the
  same lineage rules as colleges (`lib/fields.ts` registration, `SourceKey`s `nces-ccd`, `edfacts`, `crdc`,
  `nces-pss`, `state-{xx}`, `hs-profile`; `npm run check:lineage` validates).
- **Entity resolution:** `ncessch` is the key everywhere. State files map state ids to `ncessch` with the CCD
  crosswalk; profiles are keyed by the school's `ncessch` in its recipe.
- **Normalization:** GPA scales recorded as the school states them (unweighted 4.0, weighted 5.0, 100-point) with
  the conversion rule in the detail file; the student profile uses it
  ([student-profile.md](student-profile.md#fields)). Never convert a weighted GPA to unweighted without the
  school's rule.
- **Small cells:** any count under 5 (CRDC and state files already suppress) is `null` with a `suppressed` flag;
  the site shows "fewer than 5".
- **Size:** 24K rows × ~1 KB is ~25 MB, too big for the in-memory dataset pattern. Store in Supabase
  `high_schools` (and `high_school_details`) and query by id and by search; no in-memory copy. Git keeps the files
  for review and diffs, published like history ([supabase.md](../supabase.md)).
- **Profile PDFs** reuse the recipe store, conditional fetching, and the review queue of the college-reported
  agent, with a `kind: "hs-profile"` extraction schema (GPA scale, GPA distribution bands, AP/IB list, score ranges,
  matriculation entries with counts). Checks: distribution sums to 100% ± 2; matriculation counts ≤ class size;
  every matched college is a real `unit_id`.

## Display
- **`/high-schools/{ncessch}`** (public): name, district, type, enrollment; **Rigor** (AP/IB courses offered, share
  of students in an AP course, AP exam pass rate, dual enrollment, each against the state median); **Outcomes**
  (graduation rate, college-going rate where the state has it, persistence where a Clearinghouse report exists);
  **Grading** (the school's scale, from its profile); **Where graduates go** (matriculation list with links to
  college profiles, counts when the profile gives them); sources and dates at the bottom.
- **Search:** `/high-schools` with a name and state search, and a picker component used by the student profile.
- **On a college profile** (for a signed-in student with a high school): "From your high school: 6 enrolled in
  2023–2025 (school profile, 2025)", and the scattergram when it exists ([scattergrams.md](scattergrams.md)).
- **Glossary:** `ncessch`, `adjusted-cohort-graduation-rate`, `ap-access`, `college-going-rate`, `school-profile`,
  `weighted-gpa`.

## Phases
1. **Tier 1 for all public high schools** (CCD, EDFacts, CRDC): sync, tables, pages, search, picker. No crawling.
2. **State report cards** for California, Texas, New York, Florida, Illinois (one adapter each; add states by
   demand), and the two states that publish Clearinghouse reports for every school.
3. **School profile pilot:** 100 high schools in three metro areas (chosen for coverage of the site's early users),
   measuring findability, extraction accuracy against hand-read profiles, matriculation match rate, and cost per
   school. Then expand by the high schools of signed-in students (demand-driven crawl), never all 24K at once.
4. Private schools (PSS) and their profiles.

## Rules
- Describe, don't grade: no composite score, no rank, no "A+". Comparisons are to the state median, labeled.
- Never show student-level data; profile distributions are the school's own published aggregates.
- Access rules of the college-reported engine apply (robots.txt, crawl delays, no bypassing protections).

## Files (planned)
- `scripts/sync-high-schools.mts`, `scripts/lib/education-data-api.mts`, `data/high-schools/**`,
  `lib/high-schools.ts` (server queries), `app/high-schools/`, `components/high-schools/`, migration
  `…_high_schools.sql`, `tests/high-schools.test.mts` (normalization, suppression, matriculation matching).

## Open questions
1. Is the Urban Institute API reliable enough for a scheduled sync, or should the sync use NCES bulk files with the
   API as a probe? Recommendation: bulk files for the sync (same approach as IPEDS), API for ad-hoc checks.
2. Which metro areas for the profile pilot? Depends on where early users are ([telemetry.md](telemetry.md) will
   show state distribution of signed-in students).
3. Private schools' profiles are often behind counselor-only pages; expect lower coverage.

## As built (foundation, 2026-10-05)
The shared contracts every later unit builds on; the federal, private, state, UI, and profile units fill them in.
- **Types** `lib/high-school-types.ts` (types only): `HighSchool` rows (id = 12-digit `ncessch` or 8-character PSS
  `ppin`), `HighSchoolShard`, `HighSchoolMeta`, `HighSchoolStateFile`, `StateMedians`, `HighSchoolDetail`,
  `HighSchoolView`, `HighSchoolHit`, `PublishedHighSchool` (a row with its state report merged in). Beyond the brief:
  `state_school_id` (CCD `ST_SCHID`, for state crosswalks) and `rigor.enrollment` (CRDC's own enrollment, so AP/IB/dual
  shares never divide one year's count by another year's enrollment).
- **Helpers** `lib/high-school-core.ts` (pure): ids and FIPS↔USPS (50 states + DC), grades (`offersGrade12`,
  `gradeSpan`), `suppress` (counts 1–4 and source privacy codes → null + suppressed; zero is shown), `parseRateRange`
  (EDFacts "GE80"/"90-94" stay ranges), `normalizeHighSchool` (canonical key order), `mergeStateReport`,
  `computeStateMedians` (public schools only, at least 5 values; a graduation range no wider than 10 points counts at
  its midpoint inside the median only, open ranges are left out), `searchRows`, and the validators
  (`validateHighSchoolRow`, `validateShard`, `validateStateFile`, `validateHighSchoolDetail`, `validateHighSchoolMeta`,
  `validateMedians`).
- **Fields and citations** `lib/hs-fields.ts`: `HS_FIELDS` (stored paths, `derived.*` shares, `state.*` report fields
  cited to their state file section, `detail.*` profile fields cited to the profile with its quote), `citeHsField` /
  `citeHsView`, `hsSourcesForFields`. Private rows' directory fields cite PSS. `lib/lineage.ts` gained `AnyCited` /
  `AnyCitedSource` (`Cited` and `CitedSource` are now generic with college defaults), and the ⓘ (`InfoTip`,
  `MetricLabel`, `SourceTip`) and `SourceItem`/`SourceLine` accept either kind.
- **Data access** `lib/high-schools.ts` (server only; `getHighSchool`, `searchHighSchools`, `getHighSchoolMeta`,
  `getStateMedians`; fail-soft) over `lib/high-school-store.ts` (json mode, lazy per-state shards) and
  `lib/supabase-high-schools.ts`. `HIGH_SCHOOLS_DIR` points json mode at another directory, e.g.
  `HIGH_SCHOOLS_DIR=tests/fixtures/high-schools DATA_SOURCE=json npm run dev` for UI work before real data.
- **Supabase** `supabase/migrations/20261005170000_high_schools.sql`: `high_schools` (trigram index on `search`),
  `high_school_details`, `high_school_files` (meta, medians), staging tables and functions, and
  `search_high_schools(p_q, p_state, p_limit)`. Tested on PGlite (`tests/high-schools-policies.test.mts`).
  `publish-data` writes the live tables in batches and reads them back (like history: ~25 MB is too big for one
  swap), and skips high schools with a message until the migration is applied.
- **Syncs** `npm run sync-high-schools [-- --only ccd,pss --dry-run --offline --allow-shrink]` and
  `npm run sync-hs-states -- --state ca`. Adapters in `scripts/lib/high-schools/` (contract `types.mts`, registries
  `index.mts` and `states/index.mts` already list every adapter as a stub; units replace only their own file). Merge
  rules (`merge.mts`): directory adapters (CCD public, PSS private) own their kind's rows and fields; enrichment
  adapters (EDFacts `grad_rate`, CRDC `rigor`) fill their fields on existing rows; a rerun touches only the run
  adapters' fields; a stub changes nothing. Shards are one school per line, sorted; a run refuses invalid rows or a
  drop of more than 10% of a kind.
- **Checks** `npm run check:lineage` validates `data/high-schools/` when it exists (shards, meta, fresh medians, state
  files, detail files with real college ids). Fixture: `tests/fixtures/high-schools/` (two states, a rich public school
  with a state report, profile detail, suppressed cells, and an EDFacts range; a sparse public school; a private school).

## As built (federal sync, 2026-10-05)
`npm run sync-high-schools` fills public rows from NCES and ED bulk files (cached in `.cache/high-schools/`):
- **CCD 2024–25 final** (`ccd.mts`): directory (029), membership (052, streamed: 2.3 GB of CSV), staff (059: ratio =
  membership ÷ FTE teachers, kept only between 1 and 100), school characteristics (129: virtual = exclusively or
  primarily virtual), lunch (033: FRL share = free + reduced-price eligible ÷ membership, dropped when it exceeds
  membership), and NCES EDGE geocodes (lat/lng, urban-centric locale). High school = open (Open, New, Added, Changed
  Boundary/Agency, Reopened), highest grade 12 or 13, 50 states + DC: 27,815 schools (incl. alternative, special
  education, career and technical, virtual, and K–12 schools). `state_school_id` is CCD's `ST_SCHID` as published
  (e.g. `CA-1975309-1995786`: state prefix, state district id, state school id), for state crosswalks.
- CCD stopped publishing **Title I** and **magnet** status after 2021–22: Title I comes from the 2021–22 school
  characteristics file (lineage year 2021–22), magnet from the CRDC school characteristics file (lineage source CRDC).
- **CRDC 2023–24** (`crdc.mts`, released August 2026): AP courses, AP enrollment, IB, dual enrollment, CRDC enrollment.
  AP exam takers and passers are no longer collected (null for every school). AP/IB indicators of -9 are "not
  reported", never zero; dual enrollment "No" is zero.
- **EDFacts ACGR** (`edfacts.mts`): ed.gov's EDFacts data-files page is gone; the school files now come from ED Data
  Express, hand-downloaded into `.cache/high-schools/`. See
  [graduation rates and history](#as-built-graduation-rates-and-history-2026-10-05). The old
  `acgr-sch-sy{YYYY}-{YY}-long.csv` layout is still read when no Data Express folder is cached.
- Small cells: CCD "Suppressed" flags, CRDC codes -11/-12, EDFacts "PS", and student counts 1–4 → null + `suppressed`.
  Tests on fixture extracts: `tests/high-schools-federal.test.mts` (`tests/fixtures/high-schools/federal/cache/` holds
  directories named like the zips).

## As built (graduation rates and history, 2026-10-05)
Branch `feature/high-school-grad`. `npm run sync-high-schools -- --only edfacts --offline` fills `grad_rate` and
`grad_history` on public rows.

**Source.** ed.gov's EDFacts data-files page is gone. Since SY 2021–22 the files live on ED Data Express
(<https://eddataexpress.ed.gov/download/data-library>), which `meta.sources.edfacts` cites (publisher "U.S. Department
of Education, ED Data Express (EDFacts)"; retrieved = the day the folders were unzipped, on the local calendar, or
`--edfacts-retrieved YYYY-MM-DD`).

**File naming.** Each download is a folder `SY{code}_FS150_FS151_DG695_DG696_{level}_data_files/` with
`…_{level}.csv`, a README, and a `…_data_notes.csv`. `{level}` is `SCH` (school), `LEA` (district) or `SEA` (state):
only `_SCH_` files are read. `{code}` is the school year (`SY2021` = 2020–21 = Class of 2021) or a span (`SY1018` =
2010–11 to 2017–18 in one file); the "School Year" column, not the name, decides. Where two files hold the same school
year, the file whose name sorts last (the later release) wins, and repeats are counted in the run's notes. Flags:
`--edfacts-file <csv>` (either layout, told apart by its header) and `--edfacts-dir <folder>`.

**Reading.** Subgroup "All Students in School" (older files: "All Students"), Population "All Students", Data Group
695. Value is the rate, Denominator the cohort. Value spellings: `93%`, `86.70%`, `80-84%`, `>=90%`, `>50%`, `<=10%`,
`<50%`, and `S` (suppressed); older files use the EDFacts codes `GE90`, `LT50`, `PS` and whole numbers, and (in the
SY1018 district file at least) spreadsheet-mangled ranges like `14-Oct` (= 10–14), which `repairRateCell` restores.
`parseRateRange` takes every spelling; ranges stay ranges (low/high), never midpoints; cohorts under 5 are suppressed.

**Newest class and history.** The newest school year across all files becomes `grad_rate` (`vintages.edfacts-acgr`,
e.g. "Class of 2021"). A school missing from that year has no current rate, even if an older class has one. Every
class a school has becomes `grad_history`: `{ year: "Class of 2019", value, low, high, cohort, suppressed?: true }[]`,
oldest → newest, written only with two or more classes (one would repeat `grad_rate`; null otherwise).
`vintages.edfacts-acgr-history` is the span ("Classes of 2011–2021"), which the history's ⓘ cites. Guards
(`validateGradHistory`, `validateHighSchoolMeta`; tests in `tests/high-schools-grad.test.mts`): "Class of YYYY" years,
oldest → newest, no repeats, shares 0–1, exact or a range, suppressed entries without a rate, newest entry equal to
`grad_rate`, newest class equal to `vintages.edfacts-acgr`, private rows null.

**Page.** Under the Outcomes stats, a "Four-year graduation rate by class" card (`components/charts/ClassTrend.tsx`)
appears only when two or more classes have a rate: exact rates are dots (joined only between neighbouring exact
classes), ranges are interval bars, suppressed classes a hollow ring on the floor, skipped classes gaps; hover or tap a
column for its class, rate and cohort. The caption is the summary sentence (`gradTrendSummary`: "From 86% (Class of
2019) to between 90% and 94% (Class of 2023). Suppressed for privacy: Class of 2020. …") plus a screen-reader list of
every class.

**Coverage (first run, SY2021 only: the Data Library has one school-level set today).** 22,066 schools in the file;
21,141 matched a CCD 2024–25 high school (925 didn't: closed since, or no longer a grade-12 school). Of 27,815 public
rows: 5,900 exact rates, 14,301 ranges (10,660 no wider than 10 points, which count toward medians at their midpoint;
3,641 open, like ≥90%), 940 suppressed, 6,674 none. No school has two classes yet, so every `grad_history` is null and
no trend is drawn: each page shows the Class of 2021 rate as the graduation rate, with its year in the ⓘ. Medians
cover 48 states + DC (Illinois and Washington have no 2020–21 school rates, see below).

**How to add a year.** Download the school-level FS150/FS151 file from ED Data Express (Data Library, or the Data
Download Tool), unzip its `SY…_SCH_data_files` folder into `.cache/high-schools/`, and rerun
`npm run sync-high-schools -- --only edfacts --offline`. History and the trend appear on their own; commit the
regenerated `data/high-schools/**`.

**State caveats in the 2020–21 data notes.** Illinois suppressed its ACGR at LEA and school level for 2018–19 and at
all levels for 2019–20 and 2020–21 (data quality); Washington did not report 2020–21; the Bureau of Indian Education's
2020–21 rates are suppressed; states could change diploma requirements for COVID-19, so ED advises caution comparing
2019–20 and 2020–21 with earlier classes; Massachusetts sent rates without cohort counts for 141 schools (cohort null);
Delaware, Massachusetts and New Mexico report rates that differ from rates computed from their counts for some schools.
