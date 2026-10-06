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
- **Supabase** `supabase/migrations/20261005180000_high_schools.sql`: `high_schools` (trigram index on `search`),
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

## Pilot results (profile PDFs, 2026-10-05)
Phase 3's pipeline is built and its free half has run on the 100 pilot schools. **The model half has not run:** this
environment has no `ANTHROPIC_API_KEY`, so no extraction, no paid search step, and no spend ($0.00 of the $30 cap).
Findability below comes from a hand search standing in for the search step; extraction accuracy waits for one command
(see "To finish the pilot").

### What was built
- `npm run sync-hs-profiles` (`scripts/sync-hs-profiles.mts`; modules in `scripts/lib/high-schools/profiles/`):
  `select` (pilot choice), `discover` (finding the profile), `document` (PDF/HTML → numbered lines, the profile gate),
  `extract` (the `hs-profile` schema and call), `checks` (answer → `HighSchoolDetail`), `match` (college names →
  `unit_id`), `budget` (the spend cap), `run` (one run, measurements), `score` (accuracy vs the answer key), `store`.
- **Discovery ladder** (CCD has no website column): 0 known recipe URL (conditional GET once a model has read it) → 1
  scan the school's known site and pages, one level down to counseling/college pages, following a "School Website" link
  from a district or NYC DOE directory page → 2 seeds (candidate URLs from the owner or a hand search, `--seeds`) → 3
  search (Sonnet 5, web search only, ≤ 2 searches, no fetch; our code fetches the candidates) → 4 Haiku picks a link from
  the pages fetched. Every request goes through the college-reported engine's `PoliteHttp` (robots.txt, ≥ 1 s per host
  or the Crawl-delay, honest user agent `QuadCollegeData/1.0 (high school profiles; …)`, no retries past refusals).
  Drive share links are rewritten to their direct download only where robots.txt allows; Docs export as PDF.
- **Profile gate** before any model call: the document names the school (half its distinctive words) and carries three
  of seven profile markers (profile, CEEB code, GPA, AP/IB, SAT/ACT, class of a year, college list); a web page needs
  four including GPA and a class year, since navigation and news hit markers by chance.
- **Extraction** (Haiku 4.5 by default, structured outputs): numbered layout lines in, every value back with the ids of
  the lines it is printed on; our code builds quotes and pages from those lines and copies the school's GPA conversion
  rule verbatim from its cited lines. One escalation re-read with Sonnet 5 only for fields that failed a check a re-read
  can fix (quote, distribution sum, count bound, scale kind, names, range, plausibility), as the engine does.
- **Checks**: document level (wrong school, missing or pre-2023–24 edition → nothing written); field level (a failing
  field is withheld and queued, the rest publish): numbers on their cited lines, distribution sums to 1 ± 0.02 (counts
  become shares of their total), matriculation counts ≤ class size (else CCD's 12th grade), scale kind agrees with its
  maximum, SAT 400–1600 / ACT 1–36, AP/IB names must appear in the document, class size ≤ 3 × CCD 12th grade + 50.
  `validateHighSchoolDetail` runs before any detail file is written.
- **College matching** (`match.mts`): an official-name key (punctuation-blind, "&" = "and", leading "The" dropped), an
  alias key (`data/aliases.json`), the name minus an IPEDS "-Main Campus", then name + "University"/"College". A state
  hint ("Miami University (OH)") narrows candidates. Two or more colleges at the first rule that answers is ambiguous:
  `unit_id` stays null and the review queue lists the candidates. Never a guess.
- **Spend cap**: every call reserves its worst case (all input uncached, the whole output budget, its searches) and is
  not started if that would pass the cap; the real cost replaces the reservation. `--cap` is the pilot's whole budget:
  spend recorded by earlier runs (`spent_total_usd` in `profile-pilot.json`) counts toward it.
- Files: `data/high-schools/profile-pilot.json` (rule, the 100 schools, latest run and measurements, `key_match`),
  `profile-recipes.json`, `review-queue.json`, `detail/{id}.json` (passing schools only; none yet),
  `data/reference/hs-profile-answer-key.json`; tests `tests/high-schools-profiles.test.mts` (34, each check proven to
  fail on a broken extraction).

### The pilot schools
Rule (recorded in `profile-pilot.json`): circles of 40 km (Los Angeles), 55 km (Dallas–Fort Worth) and 30 km (New York)
in CA, TX and NY; rows with 10+ students in grade 12; public schools regular and not virtual; per metro two thirds
public and one third private, each split into three size bands; within a band a fixed sha256 shuffle. 34 + 33 + 33
schools: 67 public (charters, magnets, NYC small schools, large comprehensives), 33 private (Catholic, Jewish day
schools and yeshivas, independent day schools, Fusion Academy campuses). A test re-runs the rule on the shards.

### Measurements
| Measure | Result |
|---|---|
| Official URL found by hand search (1–2 searches per school, school or district domains only) | 75 / 100 |
| **Profile found and fetchable** (findability) | **6 / 100** (5 distinct documents; all private) |
| Profile located but robots.txt or a viewer forbids fetching it | 12 / 100 (7 public, 5 private) |
| Profile located at all | 18 / 100 |
| Public schools with a fetchable profile | 0 / 67 |
| Requests / time, free discovery | 437 requests, 15 s per school (crawl delays; 6 in parallel) |
| Extraction accuracy per field | **not measured** (no API key); answer key ready |
| College-name match rate (hand-read lists, 635 names, 6 schools) | **87.2%** matched, 0.2% ambiguous, 12.6% unmatched |
| Cost per school | $0 so far; estimate below |

- **Where profiles live, and why most can't be fetched**: Google Drive (`/uc` downloads are disallowed by Drive's
  robots.txt; Arcadia, Polytechnic, Notre Dame Sherman Oaks, Episcopal School of Dallas, Belmont Prep), Edlio's file host
  `*.files.edl.io` (disallows all; El Dorado, Ferrahian, Townsend Harris, West End, New Utrecht), Blackbaud's
  `myschoolcdn.com` (disallows all; Hockaday's PDFs), ParentSquare's file host (Hoover), Issuu (a viewer with no file;
  St. Ann's). Fetchable ones sat on the school's own site (WordPress uploads, Finalsite resource manager, a plain PDF
  folder) or were the profile page itself (Hockaday publishes its profile as an HTML page).
- **Public schools**: none fetchable. LAUSD, Dallas ISD, Fort Worth ISD and NYC DOE schools mostly publish no profile
  at a findable address; NYC schools that do use Edlio or Drive. Profiles are made for counselors to attach in Naviance /
  Common App, not for the public web.
- **Matching**: rule 1 (official name) carries 538 of 554 matches. Unmatched names are mostly correct "no": colleges
  abroad (St Andrews, McGill, Bocconi), community colleges outside the 4-year set, and service academies' variants.
  The fixable part is big universities whose IPEDS name carries a campus ("University of Michigan" → "-Ann Arbor",
  "Texas A&M University" → "-College Station", "Columbia University" → "in the City of New York", "Arizona State
  University" → "Campus Immersion", "University of Oklahoma", "University of Washington", "Tulane University", SUNY campuses): about 40
  of the 80 unmatched. These want curated aliases (`data/aliases-curated.json`), not a looser rule: "University of
  Michigan" is also a prefix of Dearborn and Flint.
- **Answer key** (`data/reference/hs-profile-answer-key.json`): 12 profiles hand-read from their text layers (the brief
  asked for 15; only 5 distinct pilot profiles were fetchable, so 7 come from other high schools in the three metros
  found by hand search: Palos Verdes, Beverly Hills, Crespi, Poly Prep, Regis, Cistercian, Nolan Catholic). What they
  print, which sizes the extraction's job: class size 9 / 12, a GPA scale 11 / 12 (two 100-point, one 4.5 base),
  a real GPA distribution 3 / 12 (others print percentile cut-offs, a bar chart without numbers, or refuse to publish),
  AP lists 8 / 12 (three schools offer no AP), SAT middle 50% 4 / 12 and ACT 5 / 12 (others print means), an
  enrollment list 6 / 12 (four with counts; the rest list acceptances, and Cistercian marks enrollment in bold, which
  the text layer drops).
- **Cost estimate** (not measured): extraction of a 2–6 page profile ≈ 6–15 K input + 2–6 K output tokens on Haiku 4.5
  ≈ $0.02–0.05 per found profile, plus a Sonnet re-read for perhaps a third ≈ $0.03; the search step ≈ $0.04–0.08 per
  school (two searches + results). A full pilot run is about $6–10, inside the $30 cap.

### To finish the pilot
With `ANTHROPIC_API_KEY` in `.env.local`: `npm run sync-hs-profiles -- --pilot --cap 30` (search step for the 94
schools without a fetchable profile, extraction for the 6 found), `npm run sync-hs-profiles -- --answer-key --cap 30` (extracts
the 12 key profiles; recipes are known), `npm run sync-hs-profiles -- --score` (field accuracy into
`profile-pilot.json`). The cap counts every run's spend. Then fill the accuracy row above.

### Recommendation: demand-driven, and don't count on crawling
- Expand only by signed-in students' high schools, as planned, but expect a fetchable public profile for roughly
  1 school in 20 and a located-but-forbidden one for another 1 in 10. A crawl of all 24 K schools would find little and
  cost mostly search calls.
- Add an upload path: let a student or counselor upload their school's profile PDF (or paste its link when the host
  forbids crawlers), then run the same gate, extraction and checks. This reaches the Drive, Edlio and Blackbaud profiles
  without bypassing anyone's robots.txt, and fits the counselor portal.
- Ask the owner whether to email schools whose profile sits behind a disallowing host; never fetch it another way.
- Curate aliases for the ~40 big-campus names before matching at scale; the review queue lists them per school.
