# Campus Profile (IPEDS HD)

> Status: **built** 2026-09-30. Wave 2. New file: IPEDS Institutional Characteristics directory, `HD{Y}`. Research
> 2026-09-28; codes checked 2026-09-30 against the HD2025 data dictionary. See [As built](#as-built).
> Part of [data-expansion](README.md).

## Question it answers
*Is it in a city or the countryside? What kind of college is it: research university, liberal arts, HBCU?
Where is it on a map?*

## Source
`HD2025` is published (5,985 institutions; the newest directory, a year ahead of ADM). Verified columns for Vanderbilt:

| Column | What | Vanderbilt |
|---|---|---|
| `LOCALE` | 12 codes: City/Suburb/Town/Rural × Large/Midsize/Small or Fringe/Distant/Remote | 11 City: Large |
| `CARNEGIEIC` | Carnegie 2025 institutional classification (29 classes) | 7 Mixed Undergraduate/Graduate-Doctorate Medium |
| `CARNEGIERSCH` | Research designation: R1, R2, Research Colleges and Universities, none | 1 (R1) |
| `CARNEGIESAEC` | **Student Access and Earnings**: 6 classes, from "Lower Access, Lower Earnings" to "Opportunity Colleges and Universities – Higher Access, Higher Earnings" | 5 Lower Access, Higher Earnings |
| `CARNEGIESIZE`, `CARNEGIEAPM` | Size and undergraduate program mix | |
| `C21BASIC` | Carnegie 2021 basic (the old scheme; what Scorecard `school.carnegie_basic` has) | 15 |
| `HBCU`, `TRIBAL`, `LANDGRNT` | Flags (1 yes, 2 no) | no, no, no |
| `LATITUDE`, `LONGITUD` (sic) | Coordinates | 36.1466, −86.8034 |
| `CBSA`, `CBSATYPE`, `COUNTYNM` | Metro area | Nashville metro |
| `NPRICURL`, `APPLURL`, `ATHURL`, `DISAURL` | Links | |

Not in HD: Hispanic-Serving and other minority-serving designations, and women's/men's colleges. Scorecard has them
for all 1,893 colleges: `school.minority_serving.{historically_black, predominantly_black, hispanic, aanipi, annh,
tribal, nant}`, `school.women_only`, `school.men_only`. MSI eligibility changes yearly and Scorecard's list vintage is
*unverified*; cite it as Scorecard, not ED's current eligibility list.

## Ingest
- `sync-data` loads `HD{Y}` newest-first (`HD2025`, `HD2024`, …) via `fetchIpedsTable` with `keep` = site ids.
- Also a cross-check: `HD` `INSTNM`, `STABBR` vs Scorecard name/state; warn on mismatch (catches merged/renamed ids,
  which [trends-data.md](../trends-data.md) already worries about; `NEWID`, `CLOSEDAT` flag merges).
- Scorecard MSI and single-sex flags join the existing API call.

## Store
```ts
campus.setting: { locale: 11..43, label: "City: Large", group: "city" | "suburb" | "town" | "rural" } | null
campus.carnegie: { ic: string, research: "R1" | "R2" | "RCU" | null, access_earnings: string | null, size: string } | null
campus.designations: ("hbcu" | "tribal" | "land_grant" | "hsi" | "pbi" | "aanapisi" | "annh" | "nanti" | "women" | "men")[]
location.lat, location.lng: number | null
location.metro: string | null
```
New `SourceKey` `ipeds-hd`, `VintageKey` `ipeds-hd` ("2025–26"). Designations cite per flag source (HD or Scorecard).

## Display
- **Hero:** setting chip ("Big city"), R1 chip, designation chips (HBCU, HSI, Women's college) as glossary terms.
- **Explore:** filters for setting group, research designation, each designation; a **map view** (dots from lat/lng)
  as a new Explore view beside grid/table/chart (charts spec: new `DotMap`).
- **Compare:** setting and Carnegie rows.
- **Home:** "Opportunity colleges" (SAEC class 6) as a browse entry point, if the classification proves useful.
- **Glossary:** `locale`, `carnegie-classification`, `r1`, `student-access-and-earnings`, `hbcu`, `hsi`,
  `land-grant`, `tribal-college`.

## Keep history?
- **Events only**, and only for designations (e.g. "Became Hispanic-Serving") and Carnegie research tier changes.
  Setting and coordinates are effectively static.
- Don't backfill events from old HD files; start the event log at the first sync that stores these fields. Carnegie
  2025 is a new scheme, so there's nothing comparable to diff against before it.

## Top-level trend?
**None.** Classifications aren't trends. A national fact like "N colleges became Hispanic-Serving since 2015" is
possible later from Scorecard year-prefixed flags (*unverified* whether the flags are year-prefixed).

## Open questions
1. Map tiles: an SVG state outline map (no tile server, matches the custom-chart approach) vs a tile library.
   Recommendation: SVG US map with dots, no external tiles.
2. Carnegie SAEC measures access and earnings, which overlaps our own cost/outcomes story. Show it as Carnegie's
   label, cited, not as our judgment.

## As built
- **Ingest.** `sync-data` loads `HD{next year}`, then `HD{Y}` newest-first, keeps the site's ids, and fails if the file
  has no `LOCALE`/`CARNEGIEIC` columns. `HD2025.csv` starts with a byte-order mark, which hid the `UNITID` column;
  `parseCsv` now strips it (tested). Code rules and labels live in `lib/campus-profile.ts` (pure, shared with the UI
  and tests).
- **Store** (as planned, with two changes):
  - Designations are split by source so each cites one: `campus.designations` (HD: `hbcu`, `tribal`, `land_grant`)
    and `campus.msi` (Scorecard: `hsi`, `pbi`, `aanapisi`, `annh`, `nasnti`, `women`, `men`). `designationsOf()`
    joins them.
  - `campus.carnegie` is null outside the Carnegie universe (`CARNEGIEIC` ≤ 0); `research` is null for "none" (0).
  - Not built: `location.metro` (CBSA), the HD/Scorecard name cross-check, the Home "Opportunity colleges" entry,
    and designation events. The events log ([admission-factors.md](admission-factors.md)) has no designation
    history yet; start it once two syncs have stored these fields.
- **Coverage** (1,893 colleges): setting and coordinates for all 1,893 (city 973, suburb 456, town 316, rural 148);
  Carnegie for 1,863; R1 183, R2 129, research colleges 191. Designations: HSI 281, AANAPISI 110, HBCU 84 (Scorecard's
  flag agrees), land-grant 82, men's 45, women's 30, PBI 18, NASNTI 11, ANNH 7, tribal 1.
- **Lineage.** `SourceKey`/`VintageKey` `ipeds-hd` ("2025–26", edition HD2025), with a release-calendar entry for HD2026
  (expected 2027-07). Fields: `campus.setting`, `campus.carnegie`, `campus.designations`, `location.lat`,
  `location.lng` (HD) and `campus.msi` (Scorecard).
- **Display.**
  - Profile hero: setting ("Large city"), research tier (R1, R2, "Research college"), and designation chips, each a
    glossary term.
  - Explore: a **Campus** filter section (setting group, research tier, designation; URL `setting=`, `research=`,
    `designation=`; any chosen value matches, and colleges that don't report never match), active-filter chips, and a
    **Map** view (`view=map`, [charts.md](../charts.md) `DotMap`). The map draws the 50 states and DC; the caption
    counts colleges in territories it leaves out.
  - Compare "All the numbers": setting, Carnegie class, research activity, student access & earnings, and both
    designation groups.
  - Glossary (School types): `locale`, `carnegie-classification`, `r1`, `student-access-and-earnings`, `hbcu`,
    `hsi` (covers the other minority-serving designations), `single-sex`, `tribal-college`, `land-grant`.
- **Open questions, resolved.** (1) An SVG outline with no tiles. (2) SAEC is shown as Carnegie's label, cited, in
  Compare only.
- Tests: `tests/campus-profile.test.mts`.
