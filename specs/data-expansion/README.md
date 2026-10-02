# Data Expansion: Public Data Not Yet on the Site

> Status: **planned** (nothing built). Research 2026-09-28: NCES bulk files and data dictionaries downloaded and read,
> College Scorecard API probed for coverage across all 1,893 colleges, and two colleges' Common Data Set workbooks
> (Vanderbilt 2024–25, Cornell 2025–26) read cell by cell. Values are verified unless marked *unverified*.

## Why
Today the site uses about 40 Scorecard fields and a few columns from IPEDS ADM, SFA, and the price files. Much more
public data exists. Some of it is in files we already download, some needs one more Scorecard field, and some needs a
new NCES file. The most-asked-for item, **high school GPA**, exists only in each college's Common Data Set, so it waits
for the [college-reported data agent](../college-reported-data.md).

Each spec here is a separate unit of work, so pieces can ship when they're useful.

## Specs

### Wave 1: already downloaded or already on the Scorecard call (cheap)
| Spec | Adds | Source |
|---|---|---|
| [admission-factors.md](admission-factors.md) | **Built.** How GPA, class rank, essays, recommendations, **legacy status**, and more are used in admission | IPEDS ADM (downloaded) |
| [admissions-detail.md](admissions-detail.md) | **Built.** Admit rates by sex, true SAT/ACT medians, ACT English/Math | IPEDS ADM (downloaded) |
| [housing-and-policies.md](housing-and-policies.md) | **Built.** Housing capacity, live-on requirement, meal plan, application fee, tuition guarantee, promise program | IPEDS COST1 (downloaded) |
| [student-body.md](student-body.md) | **Built.** Men/women split, part-time share, share 25 and older | Scorecard API |
| [loans-and-repayment.md](loans-and-repayment.md) | **Built.** Share who borrow, debt for Pell and lower-income students, repayment progress | Scorecard API |

### Wave 2: one new NCES file each
| Spec | Adds | Source |
|---|---|---|
| [campus-profile.md](campus-profile.md) | **Built.** City/suburb/town/rural setting, Carnegie 2025 classes, HBCU/tribal/land-grant, map coordinates, MSI flags | IPEDS HD (+ Scorecard flags) |
| [metro-area.md](metro-area.md) | **Deferred.** Metro area and county, for nearby colleges and a metro filter | IPEDS HD |
| [campus-services.md](campus-services.md) | **Built.** Athletics (NCAA/NAIA, conference), ROTC, study abroad, undergraduate research, AP credit, disability services share | IPEDS IC |
| [student-faculty-ratio.md](student-faculty-ratio.md) | **Built.** Students per faculty member | IPEDS EF part D |
| [residence.md](residence.md) | **Built.** Where first-years come from: in-state, out-of-state, international; top home states | IPEDS EF part C |
| [outcome-measures.md](outcome-measures.md) | **Built.** 8-year outcomes for **all** entering students (incl. transfers in and part-time), with transfer-out and Pell splits | IPEDS OM |
| [graduation-by-group.md](graduation-by-group.md) | **Built.** Graduation rates for Pell recipients and by race/ethnicity | IPEDS GR (Pell/SSL file) + Scorecard |
| [finances.md](finances.md) | **Built.** Endowment per student, instruction spending per student | IPEDS F / DRVF (+ Scorecard) |
| [faculty.md](faculty.md) | **Built.** Average faculty salary, share of full-time faculty | IPEDS SAL (+ Scorecard) |

### Wave 3: large per-college tables
| Spec | Adds | Source |
|---|---|---|
| [majors.md](majors.md) | Degrees awarded by field: top majors, fastest-growing | IPEDS Completions (C_A) |
| [field-of-study.md](field-of-study.md) | Earnings and debt by major at each college | Scorecard Field of Study |

### Wave 4: college-specific, after the college-reported data agent
| Spec | Adds | CDS items |
|---|---|---|
| [cds-admissions.md](cds-admissions.md) | **High school GPA** (average and distribution), weighted admission factors, early decision/action, wait list, class rank | C2, C7, C10–C12, C21–C22 |
| [cds-academics.md](cds-academics.md) | Class sizes, CDS student-faculty ratio | I-2, I-3 |
| [cds-transfer.md](cds-transfer.md) | Transfer applicants, admits, enrollees, requirements | D |
| [cds-cost-and-debt.md](cds-cost-and-debt.md) | Next year's tuition before IPEDS has it; graduates' total debt including private loans | G1, H4–H5 |

CDS F1 (fraternity/sorority share) is in [greek-life.md](../greek-life.md); C7 religious commitment and H14 are in
[religious-life.md](../religious-life.md). F1 out-of-state and on-campus shares are covered as CDS supplements in
[residence.md](residence.md) and [housing-and-policies.md](housing-and-policies.md).

## Deciding on history
Every spec answers **"Keep history?"** with one of three answers:

| Answer | When | Storage |
|---|---|---|
| **Series** | The value is a number that changes year to year, NCES or Scorecard publishes it in comparable yearly files, and at least ~8 years exist | A new series in the history shard ([trends-data.md](../trends-data.md#storage)), same rules: latest point equals the snapshot, breaks marked, nulls for gaps |
| **Events** | A category that changes rarely (a policy, a classification, a conference) | A short `events` list in the shard: `{ year, field, from, to }`, e.g. "Stopped considering legacy status, fall 2023" |
| **None** | The value is static, only one cohort exists, or year-to-year changes are method, not reality | Snapshot only |

Events are new. They need a `events` array in `SchoolHistory` (lib/history.ts), validation, and a small "Changes"
list in the profile's "Over time" section. The first spec that needs them ([admission-factors.md](admission-factors.md))
builds them.

## Deciding on top-level trends
The site already surfaces trends at five levels ([trends-design.md](../trends-design.md)). Each spec says where, if
anywhere, its trend belongs:

| Level | Today | Bar to add one |
|---|---|---|
| **Hero trend indicator** | 4: cost, applications, diversity, selectivity ([trend-indicators.md](../trend-indicators.md)) | A question families ask about *every* college; data for most colleges at both ends of 10 years; a wide spread of changes, so up/steady/down all happen; no good/bad verdict needed. Adding one costs space on every card, so at most one or two more |
| **Home "What's changed" fact** | 3 national facts | A national story that is true, surprising, and computable on a fixed panel |
| **"Known for" standout** | Percentile-based chips | A per-college extreme (top 5%) that says something about the college |
| **Explore sort/filter/column** | Change columns and trend filters | Users would pick colleges by it |
| **"Over time" chart only** | Cost, Aid, Admissions groups | Useful context, not a headline |

Recommendations across all specs:
- **Hero indicator candidates:** *Graduation* ("Are more students finishing?") from the existing `grad_rate` history,
  strengthened by [outcome-measures.md](outcome-measures.md). No other new data clears the bar.
- **Home fact candidates:** legacy preference fading ([admission-factors.md](admission-factors.md)), the shift in
  majors ([majors.md](majors.md)), and the Pell graduation gap ([graduation-by-group.md](graduation-by-group.md)).
  Add at most one at a time.
- **"Known for" candidates:** draws students nationally, Pell students graduate at the same rate, very small classes,
  big endowment per student.

## Shared build rules
- **Lineage first.** Every new field is registered in `lib/fields.ts` and cited ([data-lineage.md](../data-lineage.md)).
  New sources get a `SourceKey` (`ipeds-hd`, `ipeds-ef`, `ipeds-om`, `ipeds-gr`, `ipeds-c`, `ipeds-f`, `ipeds-sal`,
  `scorecard-fos`), a `meta.sources` entry, and a `VintageKey` where they have one release year.
- **One fetcher.** New NCES files use `fetchIpedsTable` (scripts/lib/ipeds.mts): both NCES bases, `_rv` preferred,
  headers upper-cased, the header check that fails on a missing column.
- **Normalize codes.** Older files zero-pad codes and newer ones don't (verified: completions `AWLEVEL` is `"05"` in
  C2020_A and `"5"` in C2025_A). Parse codes as numbers.
- **Snapshot size.** `data/schools.json` is ~3.6 MB. Scalars and small objects go in the snapshot. Tables that are big
  per college (majors, home states, field of study) go in a **new per-college detail file**,
  `data/detail/schools/{unitid}.json` (decided 2026-09-28), not the history shard. History keeps its
  latest-point-equals-snapshot contract and year arrays; the detail file holds current snapshot tables only. Specified
  in [majors.md](majors.md#store-and-the-detail-file) and built by whichever of [majors.md](majors.md) or
  [residence.md](residence.md) ships first; [field-of-study.md](field-of-study.md) reuses it.
- **Missing is `null`.** IPEDS uses `-1` (not reported), `-2` (not applicable), and `-3` (not available). All become
  `null`, never 0.
- **Glossary.** Every new term gets an entry in `lib/glossary.ts` and a `<Term>`/`<InfoTip>`.

## Considered and left out
| Item | Why not |
|---|---|
| Scorecard median family income | Year-prefixed values stop at 2016 (verified at Vanderbilt and Michigan); `latest` is stale |
| Scorecard Title IV Pell completion (`completion.title_iv.pell_recip.*`) | Stops at 2019. IPEDS GR Pell and OM Pell are current ([graduation-by-group.md](graduation-by-group.md)) |
| Cohort default rates | 3-year default rates are near 0 for recent cohorts (the 2020–23 repayment pause), so they mislead. Vanderbilt and Michigan show 0 for 2022–24 |
| Threshold earnings ("share earning more than $28k") | A single year of data (2014 key), so no history. Could join the outcomes section later as a snapshot |
| IPEDS 12-month enrollment (EFFY) | Unduplicated headcount over a year. Useful for community colleges, not for picking a 4-year college |
| IPEDS Academic Libraries (AL) | Library collections and spending. Low decision value |
| ACTS (IPEDS admissions supplement) | Not published; watched in [data-page.md](../data-page.md#watching-acts). It would add GPA for every college, and [cds-admissions.md](cds-admissions.md) says how |
