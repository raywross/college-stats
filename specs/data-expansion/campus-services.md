# Campus Services and Athletics (IPEDS IC)

> Status: **built** 2026-09-30. Wave 2. New file: `IC{Y}` (institutional characteristics, not the `_AY` price file).
> Research 2026-09-28; codes checked 2026-09-30 against the IC2025 (and IC2015, IC2018, IC2021) data dictionaries. See
> [As built](#as-built).
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

## As built
- **Source.** A new `SourceKey`/`VintageKey` `ipeds-ic-char` ("2025–26", edition IC2025), not a second vintage of
  `ipeds-ic`: a source carries one edition and URL, and `ipeds-ic`'s describe the price files. `sync-data` loads
  `IC{next year}`, then `IC{Y}` newest-first, and fails if the file lacks the athletics/program columns. The Data page's
  "not used yet" list drops IC2025; the July release entry now brings IC2026 (`ipeds-ic-char`).
- **Checkboxes.** IC codes 1 "Yes", 0 "Implied no" (not ticked), −2 "Not applicable". Unticked reads **"Not listed"** in
  the UI, never "No".
- **Conference table: `lib/conferences.ts`** (a typed module, not `data/reference/conferences.json`: the app's event
  sentences need names, and app code never reads `data/*.json`). 138 current codes with names from the IC2025
  dictionary and a hand-assigned level (`I-FBS`, `I-FCS`, `I`, `II`, `III`, `NAIA`, or null for ECAC, NCAA regional
  independents, and "Other"), plus 22 retired codes named from older dictionaries for events.
  - Checked against Wikipedia's "List of NCAA conferences" (2025–26) and, in `tests/campus-services.test.mts`, against
    members' own answers: no NCAA-level conference has an NAIA-only member and vice versa. The data corrected one
    assumption: the "Independent Midwest/Northeast/Southeast Region" codes are NCAA, not NAIA.
  - **Codes are stable**: IC2015 and IC2025 differ only in abbreviations and renames of the same conference (Iowa
    Intercollegiate → American Rivers, Commonwealth Coast → Conference of New England, Gulf Coast → HBCU Athletic,
    North Eastern → United East). No code was reused.
  - One code serves a conference's football and other sports (123 = Missouri Valley in basketball, Missouri Valley
    *Football* Conference in football), so **FBS vs FCS comes from the football conference only**: FBS conferences
    and 113 (FBS independents) → FBS; any other Division I football conference → FCS; no football → plain "I".
  - `FBS_INDEPENDENTS`: UConn codes football as 112 (all Division I independents), so it's listed by hand.
  - Review the table every year with the July release (realignment).
- **Store** (as planned, with: `campus.athletics.associations[]`, `conference` and `football_conference` as
  `{code, name}`, `division`; `campus.programs.intellectual_disability_program`; `undergrad_research` null before
  IC2022, when it was first asked; `demographics.disability_services` = `{ share }` over 3%, else `{ three_or_less }`).
- **Coverage** (1,893 colleges): athletics for all; FBS 136, FCS 128, D-I without football 99, D-II 289, D-III 415,
  NAIA-only 215. Football 762. ROTC 900 (Army 819, Air Force 550, Navy 157). Study abroad 1,423; undergraduate research
  program 756; AP credit 1,745; semesters 1,635, quarters 102.
- **History and events.** Family `services` (IC2014 on) stores `athletic_association` (1 NCAA, 2 NAIA only, 3 neither),
  `conference`, `football_conference` (unit `conference`, validated against the table), and `rotc`. Categorical series
  get no change figures or national stats (`isCategorical`). The end-point check compares them at the newest IC year.
  Events: "Moved from the Pacific-12 Conference to the Big Ten Conference", "Football moved from … to …" (only when the
  rest of the college didn't make the same move), "Moved from the NAIA to the NCAA", "Began offering ROTC" / "No longer
  lists ROTC". An independent's switch from its home conference's code to an independents code is a reporting fix
  (UConn, Notre Dame), not an event. About 35 conference moves a year; the Pac-12 exodus shows in 2024–25.
  Known limit: other one-off miscodings stay as reported (e.g. Maine football "from the Atlantic 10" in 2019).
- **Display.**
  - Profile, Campus life ("Housing, sports, and programs"): an **Athletics & programs** card: division and conference
    (links to Explore by conference), football's conference when different, the four sports IPEDS asks about, recent
    moves (last 3 IC years), ROTC branches, study abroad, undergraduate research, calendar, student services, and the
    disability-services share.
  - Admissions: "Grants credit for AP exams".
  - Explore: a **Sports & programs** filter section: division (D-I FBS, D-I FCS, D-I, D-II, D-III, NAIA), has football,
    ROTC branch, undergraduate research, study abroad; `conference=` from the profile link; active-filter chips.
  - Compare: athletics, conference, ROTC, study abroad, undergraduate research, calendar, AP credit.
  - Glossary: `ncaa-division`, `athletic-conference`, `rotc`, `study-abroad`, `undergrad-research`,
    `academic-calendar`, `ap-credit`, `disability-services`.
- Not built: `RELAFFIL` (left for [religious-life.md](../religious-life.md)), a conference picker in the filter panel
  (138 conferences; reached from profiles instead).
- Tests: `tests/campus-services.test.mts`.
