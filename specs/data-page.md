# Data Page (`/data`)

> Status: **planned** (not built). Decided 2026-09-28. Expands today's `/sources` page
> ([sources-and-citations.md](sources-and-citations.md)) into a main-nav **Data** tab.

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
4. **How we compare colleges.** Federal data is the baseline for every comparison; newer college-reported figures
   appear only on profiles, labeled. Links to an example.
5. **Newer figures from colleges.** What the ingestion agent collects, the automated checks, what happens when a check
   fails, and the latest accuracy report ([college-reported-data.md](college-reported-data.md)). Count of colleges with
   newer figures.
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

Already released, not used yet: `IC2025` (Jul 28, 2026: institutional characteristics 2025–26, no prices),
`EFFY2025` (12-month enrollment 2024–25), `C2025_A` (completions 2024–25).

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

## Files (planned)
- `app/data/page.tsx` (from `app/sources/page.tsx`), redirect in `next.config.ts`.
- `data/release-calendar.json`; probe step in `scripts/sync-data.mts`.
