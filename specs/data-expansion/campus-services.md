# Campus Services and Athletics (IPEDS IC)

> Status: **planned**. Wave 2. New file: `IC{Y}` (institutional characteristics, not the `_AY` price file).
> `IC2025` released Jul 28, 2026 and is listed on the Data page as "released, not used". Research 2026-09-28.
> Part of [data-expansion](README.md).

## Question it answers
*Does it play Division I football? Is there ROTC, study abroad, undergraduate research? Will my AP credits count?*

## Source
`IC2025` (5,905 institutions). Verified columns for Vanderbilt:

| Column(s) | What | Vanderbilt |
|---|---|---|
| `ATHASSOC`, `ASSOC1`–`6` | Athletic association: NCAA, NAIA, NJCAA, NSCAA, NCCAA, other | NCAA |
| `SPORT1`–`4`, `CONFNO1`–`4` | Member for football, basketball, baseball, cross country/track; **conference code** for each (131 conferences in the dictionary) | all four, conference 130 = Southeastern Conference |
| `SLO5`, `SLO51`–`53` | ROTC: any, Army, Navy, Air Force | yes: Army, Navy, Air Force |
| `SLO6`, `SLOA`, `SLOB` | Study abroad; undergraduate research; program for students with intellectual disabilities | yes, yes, yes |
| `CREDITS2`–`4` | Credit for life experience, **AP credit**, none | AP |
| `STUSRV2`–`4`, `STUSRV8` | Academic/career counseling, employment services, placement, on-campus child care | yes to all four |
| `DISAB`, `DISABPCT` | Share of undergrads registered with disability services (reported only when over 3%) | 15% |
| `RELAFFIL` | Religious affiliation (phase 1 of [religious-life.md](../religious-life.md)) | none |
| `CALSYS` | Calendar (semester, quarter, …) | semester |

NCAA **division** isn't in IC. The conference implies it for most conferences; map conference → division in a small
checked-in table (`data/reference/conferences.json`) and review it yearly (realignment: the Pac-12 has 2 members in
IC2025).

## Ingest
`sync-data` loads `IC{Y}` newest-first with `keep`. The file year is the academic year starting in fall Y
(IC2025 = 2025–26), a year ahead of admissions; cite its own vintage.

## Store
```ts
campus.athletics: { association: "ncaa" | "naia" | …, conference: string | null, division: "I-FBS" | "I-FCS" | "I" | "II" | "III" | null,
                    sports: ("football" | "basketball" | "baseball" | "track")[] } | null
campus.programs: { rotc: ("army" | "navy" | "air_force")[], study_abroad, undergrad_research, ids_program: boolean | null }
admissions.accepts_ap_credit: boolean | null
campus.services: { counseling, employment, placement, child_care: boolean | null }
demographics.disability_services_share: number | null   // null when "3% or less": store as { le: 0.03 }
campus.calendar: string | null
```
`SourceKey` `ipeds-ic` already exists (for prices); add `VintageKey` `ipeds-ic-char` so the characteristics year
(2025–26) and price year (2023–24) cite separately.

## Display
- **Profile, Campus life:** athletics line ("NCAA Division I · Southeastern Conference · football"), ROTC branches,
  study abroad / undergrad research chips, calendar.
- **Admissions:** "Accepts AP credit".
- **Explore filters:** division, conference, has football, ROTC branch, undergraduate research.
- **Compare:** athletics and calendar rows.
- **Glossary:** `ncaa-division`, `athletic-conference`, `rotc`, `ap-credit`, `disability-services`.

## Keep history?
**Events only:** conference changes ("Joined the Big Ten, 2024–25"), association changes, ROTC added/dropped.
Conference realignment is a story users recognize, and events make it visible without a chart. Backfill conference
events from IC files for 10 years (conference codes are stable across years *unverified*: check the dictionary per year).

## Top-level trend?
- **No hero indicator, no Home fact.**
- **Profile:** a recent conference change (last 3 years) shows as a line under the athletics fact.
