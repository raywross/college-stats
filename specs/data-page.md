# Data Page (`/data`)

> Status: **built** 2026-09-28; section 5 ("Newer figures from colleges") built 2026-10-02 with
> [college-reported-data.md](college-reported-data.md)'s display; sections 4 and 5's wording updated 2026-10-03 for
> the newest-first display rule ([college-reported-round-2.md](college-reported-round-2.md) Decision 1).
> Replaced the `/sources` page ([sources-and-citations.md](sources-and-citations.md)) with a main-nav **Data** tab.
> What differed from the plan: [As built](#as-built).

## Goal
Explain, in plain language, where every number comes from, how old it is and why, and when it will next update, with
links. Also explains the federal-baseline rule and how college-reported figures are collected and checked.

## Route & navigation
- New route `/data`; `/sources` redirects to it. "Data" added to the header nav (`components/layout/Header.tsx`); the
  footer and every `SourceNote` "About the data" link point to it.

## Sections
1. **Why the data is a year or more behind.** Federal surveys are collected after the school year and published
   ~9–12 months after collection closes. Short diagram: fall 2025 class → collected Dec 2025–Feb 2026 → published
   ~Dec 2026.
2. **What's on the site now.** One row per topic: source, year shown, next expected update, with a timeline chart
   (per topic: bar from the year shown to today) built with the charts in `components/charts/` (see [charts.md](charts.md)).
3. **Upcoming releases.** From the release calendar below, each with a date, "confirmed" or "estimated", and a link.
4. **How we compare colleges.** Federal data is the baseline for every comparison (Explore, Compare, ranks, medians,
   Home); a college's own profile instead shows the newest figure it has published anywhere, with its year and a
   chip. Links to an example.
5. **Newer figures from colleges.** What the ingestion agent collects, the automated checks, what happens when a check
   fails, and the latest accuracy report ([college-reported-data.md](college-reported-data.md)). Count of colleges with
   newer figures. Profiles show the newest figure as the headline, with the federal figure one line below.
6. **Sources.** Today's `/sources` content: each dataset, edition, coverage, link; colleges with CDS / college-reported
   data; "How we calculate"; suggested citation.
7. **Watching.** Sources not used yet, with status (ACTS, below).

## Release calendar (`data/release-calendar.json`)
Hand-maintained, with automatic status updates:
```json
{
  "reviewed": "2026-09-28",
  "releases": [
    { "id": "ipeds-2025-26-winter", "source": "ipeds", "label": "IPEDS winter release",
      "brings": ["Admissions, fall 2025 (ADM2025)", "Student Financial Aid 2024–25", "Cost 2025–26 (COST1/COST2_2025)", "Graduation rates"],
      "expected": "2026-12", "status": "estimated",
      "basis": "Last year's winter release was 2025-12-09",
      "url": "https://nces.ed.gov/ipeds/survey-components/data-release-schedule",
      "files": ["ADM2025", "SFA2425", "COST1_2025", "COST2_2025"] }
  ]
}
```
- `status`: `estimated` → `confirmed` (date announced) → `published`.
- The scheduled `sync-data` probes each entry's `files` on NCES and flips the entry to `published` when they exist,
  so the page can't claim a release is upcoming after it has shipped. The page shows `reviewed` and warns if it's
  older than 90 days.

### Initial entries (research 2026-09-28)
| Release | Brings | Expected | Basis |
|---|---|---|---|
| IPEDS 2025–26 winter (provisional) | Admissions fall 2025, SFA 2024–25, Cost 2025–26, Grad rates | ~Dec 2026 (estimated) | 2024–25 winter release was Dec 9, 2025 |
| IPEDS 2025–26 spring (provisional) | Fall enrollment 2025 (EF2025A), Finance | ~Jan 2027 (estimated) | 2024–25 spring release was Jan 6, 2026 |
| IPEDS 2024–25 final (revisions) | Revised ADM2024, SFA2324, COST_2024 | ~Dec 2026 (estimated) | Final data follows provisional by ~1 year |
| College Scorecard update | Refreshed IPEDS-derived and FSA metrics | Irregular (last: Jun 10, 2026) | [Scorecard changelog](https://collegescorecard.ed.gov/data/changelog) |
| College class profiles, fall 2026 | Newest admit rates | Aug–Nov 2026 (rolling) | College websites |
| Common Data Set 2026–27 | Fall 2026 admissions, 2026–27 aid | ~Feb–Aug 2027 (rolling) | College websites |

Already released, not used yet: `EFFY2025` (12-month enrollment 2024–25), `C2025_A` (completions 2024–25). (`IC2025` is
used since 2026-09-30: [campus-services.md](data-expansion/campus-services.md).)

### Watching: ACTS
IPEDS **Admissions and Consumer Transparency Supplement**: detailed admissions data (by race, sex, income, test scores,
GPA) for 2019–20 through 2025–26, collected Dec 2025–Mar/Apr 2026. ED said it would publish in summer 2026; as of
2026-09-28 no public file was found on NCES, part of the collection is blocked in court for 170+ colleges, and a new
Federal Register notice (Sept 14, 2026) covers 2026–27. If published at the institution level, it could supply fall
2025 admissions for all four-year colleges ahead of ADM2025. Links: [Federal Register](https://www.federalregister.gov/documents/2026/09/14/2026-18735/integrated-postsecondary-education-data-system-ipeds-2025-26-through-2026-27-admissions-and-consumer),
[FedScoop](https://fedscoop.com/education-department-college-admissions-data-ipeds-nces-ies-statistics/),
[Inside Higher Ed](https://www.insidehighered.com/news/government/science-research-policy/2026/04/14/admissions-data-legal-fight-colleges-want).

## Research findings: vintages as of 2026-09-28
Verified by downloading NCES files and querying the Scorecard API.

| Data | On site | Newest available | Notes |
|---|---|---|---|
| Admissions (IPEDS ADM) | Fall 2024 | Fall 2024 | Current. ADM2025 not yet released. |
| Enrollment & race (Scorecard) | Fall 2024 | Fall 2024 | Vanderbilt 7,208 = IPEDS EF2024A degree-seeking undergrads. |
| Sticker prices (IPEDS) | 2023–24 | **2024–25** | `COST1_2024` holds 2021–22 to 2024–25 (`…AY3` = 2024–25). The sync takes `…AY2` to match the SFA year. Quick win: show 2024–25 sticker prices; keep same-year inputs for the all-student average. |
| Net price by income, aid | 2023–24 | 2023–24 | Current. |
| Scorecard tuition | (not shown) | 2024–25 | Scorecard's year key isn't uniform: key `2024` = 2024–25 for tuition, but 2023–24 for net price. |
| Outcomes | Latest cohorts | Same | Lag is inherent to how they're measured. |

Alternatives considered: College Transitions CDS repository (stops at 2022–23), Urban Institute portal (lags NCES).

## As built

### Files
| File | What |
|---|---|
| `app/data/page.tsx` | The page (from the former `app/sources/page.tsx`). `revalidate = 86400`, so "today", overdue releases and the review warning move without a rebuild. The only UI file allowed to read `meta.sources` / `.edition` directly (`tests/citation-guards.test.mts`). |
| `next.config.ts` | `/sources` → `/data` permanent redirect (308). |
| `components/charts/DataAgeTimeline.tsx` | The timeline chart (see [charts.md](charts.md)). |
| `data/release-calendar.json` | Releases, released-but-unused files, and watched sources. All year labels on the page that don't come from lineage live here. |
| `lib/releases.ts` | Pure helpers: types, `expectedLabel`, `isOverdue`, `isStale` (`STALE_AFTER_DAYS` = 90), `nextReleaseFor`, `periodStart`, and the probe logic (`filesToProbe`, `isPublished`, `applyProbes`). |
| `lib/data.ts` | `getReleaseCalendar()`. |
| `scripts/sync-data.mts` | `updateReleaseCalendar()` runs first in every sync; `npm run sync-data -- --releases-only` runs only it (no API key needed). |
| `tests/releases.test.mts` | Calendar file shape (ids, statuses, `YYYY-MM` dates, known vintage keys, links), every on-site release has a next release, and the helpers. |

### Where each value comes from
- **Years of data on the site**: `citeField(<first stored field of each vintage>)` → label and year; nothing hard-coded.
  Rows are the vintages in `VINTAGE_KEYS` that have stored, non-CDS fields in `lib/fields.ts`.
- **"Used for"**: the vintage's field labels when there are 3 or fewer, else their topics.
- **Lag diagram**: follows the class after the admissions vintage (`periodStart` of `ipeds-adm` + 1), with the IPEDS
  winter collection months (Dec–Feb) and the expected date of the next release that `updates` `ipeds-adm`.
- **Next update per dataset**: `nextReleaseFor(vintage)`, the soonest unpublished release whose `updates` lists it.
- **How we compare**: CDS college count and how many CDS editions are newer than the federal admissions year are
  computed; the example chip is a real `SourceChip` from the first CDS college's lineage.

### Release calendar schema (additions to the plan)
- `updates: VintageKey[]`: which releases on the site the entry brings a newer year of (drives "next update" and the
  timeline markers). Revisions and releases that reach the site only indirectly (IPEDS spring → Scorecard) have none.
- `expected: "YYYY-MM" | null` (null = irregular) and optional `expectedEnd` for rolling windows.
- `filesUpdatedAfter` (ISO date): for revisions. File existence can't detect NCES's final data, because the files
  already exist; the probe instead requires each file's `Last-Modified` to be after this date. (Checked 2026-09-28:
  IC2024's final release added an `_rv.csv`, but ADM2023's final didn't, so `_rv` isn't a reliable signal.)
- `note`, optional `url` (class profiles have no single page), `notUsedYet[]`, and `watching[]` (ACTS lives here, so
  its years and dates aren't in UI code).
- Page states: `Estimated` / `Confirmed` / `Out now`; `No set date` when `expected` is null; `Later than expected`
  (warning icon + label) once the last expected month has passed and the files haven't appeared.

### Differences from the plan
- **"What's on the site now" has one row per federal release (vintage), not per topic.** Topics mix releases (e.g.
  "demographics" has Fall-year race data and most-recent-release Pell shares), so a per-topic row would show the wrong
  year for part of it. Each row lists what the release is used for instead.
- **Section 5 (newer figures from colleges), built 2026-10-02.** Placed after "How we compare" (id `college-reported`,
  matching `meta.sources["college-site"].url`): what the agent collects, the seven automated checks in plain language
  (`lib/reported.ts` `CheckId`, kept in step by hand since the UI can't import the pipeline's comments), what happens
  on a failed check (review queue, federal figure keeps showing), the live count (`all.filter(s =>
  s.reported?.admissions).length`), and the schedule. No accuracy-report link yet: the self-measurement report
  (`data/reports/college-reported-accuracy-*.md`) doesn't exist until the pipeline has run against a second federal
  year; the section can link to it once `scripts/sync-college-reported.mts` exists.
- **The comparison text (section 4) now states the rule plainly**: CDS overrides still replace federal values (today's
  state, 8 colleges), while college-reported class profiles/CDS files read by the ingestion agent never do — they
  show only on that college's profile. A new paragraph in "Where colleges' own figures appear" links to section 5.
- **Sources card for `college-site`** (section 6) links in-page to `#college-reported` instead of opening a new tab:
  its `meta.sources` url is the relative anchor `/data#college-reported`, and `ExtLink` always renders `target="_blank"`
  with an external-link icon, which is wrong for an in-page anchor. The card instead renders a plain `<a href={s.url}>`
  for that one source.
- **Probe runs whenever `sync-data` runs**; there's no schedule yet (backlog: scheduled data refresh).
- **Sections 4 and 5 reworded, 2026-10-03** ([college-reported-round-2.md](college-reported-round-2.md) Decision 1):
  "Where colleges' own figures appear" and the section 5 intro no longer say a newer figure "appears only on that
  college's own profile, under the federal figure" — it's now the profile's headline figure, with its year and a
  chip, and the federal figure moves one line below as the baseline. The computed counts (CDS colleges, colleges with
  a newer college-reported figure) are unchanged.
- **Dates re-checked 2026-09-28** against the [NCES release schedule](https://nces.ed.gov/ipeds/survey-components/data-release-schedule),
  the [Scorecard changelog](https://collegescorecard.ed.gov/data/changelog) and NCES's file server: all initial entries
  held. New facts: the 2024–25 collection's fall *final* release came out Sep 8, 2026 (IC, completions, 12-month
  enrollment), which supports the ~Dec 2026 estimate for the winter finals; Scorecard's previous update was Mar 23, 2026
  (a new IPEDS collection year), before Jun 10. ADM2025, SFA2425, COST1/COST2_2025 and EF2025A are not on NCES; no ACTS
  file was found.
- The 2024–25 sticker-price quick win is left for its own branch.
