# Online Share: Undergraduates Studying Entirely Online (IPEDS Fall Enrollment, distance education)

> Status: **built** 2026-10-12 (see [As built](#as-built-2026-10-12)). Specified 2026-10-05. Needed by
> [Study 7](../trends/where-students-go.md)'s campus-based panel;
> replaced the reviewed `data/trends/online-first.json` that the movers' growth lists used
> ([top-10-lists.md](../trends/top-10-lists.md), rule 2), gives [Study 3](../trends/shrinking-colleges.md) its
> "campus-based colleges only" toggle, and gives Explore a filter. Listed in the backlog's National trends section
> since the trends build.

## Why
Online-first colleges are a different thing from campuses, and the data treats them the same. Southern New Hampshire
University (163,000 undergraduates, 98% of them entirely online) counts toward New Hampshire; Grand Canyon toward
Arizona; the University of Maryland Global Campus toward Maryland. Any view of enrollment by state, size, or control
is dominated by them unless they can be set aside, and today the site sets them aside with a hand-reviewed list
(110 colleges, built once from the fall 2024 file). A stored share makes the rule a field: current with each release,
evaluable in any fall, and visible on the college's own page.

## Source
IPEDS Fall Enrollment, distance-education file `EF{Y}A_DIST`, fall Y, one row per college per level (`EFDELEV`;
the undergraduate total is one of them: confirm the code against the dictionary when probing, as the residence entry
in `scripts/history/registry.mts` did). Columns: `EFDETOT` (students at that level), `EFDEEXC` (enrolled exclusively
in distance-education courses), `EFDESOM` (some but not all), `EFDENON` (none). Collected every fall since 2012; the
first file is `EF2012A_DIST`.

Fall 2020 and fall 2021 are the pandemic falls: campuses reported much of their enrollment as distance education.
The series keeps those years as reported (they are real), but no rule evaluates "online-first" in those falls; a
window that starts in 2020 or 2021 evaluates it at fall 2019 and the method note says so.

## Store
| Field | What | Source |
|---|---|---|
| `demographics.online_share` | Share of undergraduates enrolled exclusively online in the newest fall (0–1; null when not reported) | `EFDEEXC ÷ EFDETOT` |
| `demographics.online_any_share` | Share enrolled in at least one online course (exclusively or some) | `(EFDEEXC + EFDESOM) ÷ EFDETOT` |
| History series `online_share` | The exclusive share by fall, from fall 2012 | registry family `ef-a-dist`, read like `ef-a` |

Both fields register in `lib/fields.ts` with a new source `ipeds-ef-a-dist` (label "IPEDS Fall Enrollment survey,
distance education") and its release year in `meta.json`; the series registers in `history/meta.json` as the others
do. The derived rule **online-first** = `online_share > 0.5` (the glossary's existing definition) is a function in
`lib/history.ts` (`onlineFirstAt(h, year)`), not a stored flag, so it's evaluable in any fall.

## Display
- **Profile, Students page**: one line in the student body section, "19% of undergraduates take every course online"
  (and "another 23% take some" when `online_any_share` − `online_share` ≥ 5%), cited with `citeField`, with the
  glossary's `online-first` term extended to explain the shares. Shown when the exclusive share is 5% or more, since
  nearly every campus has a few.
- **Explore**: a three-way filter, Any · Campus-based (50% or less entirely online) · Mostly online (more than 50%),
  as `online=campus|mostly` in `lib/params.ts`; a "Mostly online" chip on cards whose share is over 50%.
- **Trends**: the movers' growth lists, Study 3's toggle, and Study 7's panel evaluate online-first at the window
  start from the series. `data/trends/online-first.json` is retired once the build reproduces its nonprofit and
  public members from the field; the build prints any difference for review before the list is deleted.

## Checks
- Sync: shares within 0–1; `EFDEEXC + EFDESOM + EFDENON = EFDETOT` on every row read; the undergraduate row's
  `EFDETOT` within 10% of `demographics.undergrad_enrollment` for the same fall (same survey), flagged otherwise.
- Build test: recompute two colleges' shares from the cached file (Southern New Hampshire ≈ 98%, a campus college
  under 5%); the online-first set from the field matches the nonprofit and public members of
  `data/trends/online-first.json` for fall 2024 (the list was built from the same file), with every difference
  printed.
- `npm run check:lineage` finds both fields; the hard-coded-year guard applies to the profile line as usual.

## Complexity
Small: one more IPEDS file the sync and the history build read, two fields, one series, one filter; the rule it
feeds already exists as a reviewed list.

## Open questions
1. **Threshold.** More than 50% exclusively online, as the glossary says, or count "some online" too? Recommendation:
   keep 50% exclusive; it matches the glossary and the reviewed list, and campuses with hybrid courses stay campuses.
2. **A three-way bar on the profile** (all online · some · none) instead of one line? Recommendation: later, if
   readers ask; one line now.

## As built (2026-10-12)
- **Level 2 (all undergraduates)** is both shares' denominator: `lib/online-share.ts` `onlineSharesFrom` reads the
  pivoted `EF{Y}A_DIST` row (`EFDETOT_2`, `EFDEEXC_2`, `EFDESOM_2`, `EFDENON_2`; levels 1 all students, 2 all
  undergraduates, 3 degree-seeking undergraduates, 11 non-degree, 12 graduate). A blank part is 0 (NCES leaves a part
  blank, flagged `A` "not applicable", when no students are in it: every blank part in EF2012A_DIST and EF2024A_DIST);
  a blank total, a negative count, or a row whose parts don't add up gives null, so a stored share is always 0–1.
  sync-data, history, and the tests share the reader.
- **Fall 2024:** 1,892 of 1,893 colleges have a share (Southern University Law Center has no all-undergraduates row);
  Southern New Hampshire 97.8%, Vanderbilt 0%. Add-up rule on all 8,764 level rows at 1,892 colleges: 0 failures (the
  sync stops above 1%). The 10% enrollment check uses **level 3** (degree-seeking, Scorecard `student.size`'s
  population; level 2 includes non-degree students): 1 of 1,892 flagged (Southern University and A&M College, 6,126
  vs 5,519), a warning only.
- **History:** family `ef-a-dist`, series `online_share` (fall 2012 on; 1,757 colleges in 2012, 1,892 in 2024).
  Colleges over half entirely online by fall: 48 (2012), 69 (2014), 101 (2019), **411 (2020)**, 158 (2021), 161 (2024),
  the pandemic falls kept as reported. Rule 1 compares the last point with `demographics.online_share`.
- **The rule:** `ONLINE_FIRST_SHARE` (0.5), `PANDEMIC_DISTANCE_FALLS` (2020, 2021, read at fall 2019),
  `onlineFirstEvalYear`, and `onlineFirstAt(h, year)` (null when not reported; callers count null as campus-based) in
  `lib/history.ts`. `isCampusBased` / `campusExclusionOf` in `lib/movers.ts` apply it at a window's start for panels
  (Study 7, Study 3's toggle, state flows). The movers' growth lists apply it at **both ends** of each change: judged at
  the start alone, colleges that went online-first inside the window (University of the Cumberlands, National Louis,
  LSU Alexandria, Point, National University) took the top of "Grew the most".
- **The reviewed list is retired:** before `data/trends/online-first.json` was deleted, the field rule (public and
  nonprofit, share over 0.5, fall 2024) matched it exactly: 110 of 110, no differences either way. `movers.json`
  records `rules.onlineFirstShare` instead of the list's count. Against the list, "Grew the most" lost Everglades
  University (online-first at the window's start, not today) and gained Embry-Riddle Prescott (10 years) and Eastern
  University (5 years) at tenth place.
- **Display:** the Students page's Campus size block shows "N% of undergraduates take every course online" (+ ", and
  another M% take some" when that gap is 5 points or more) from 5% entirely online, with the `online-first` InfoTip
  cited to `demographics.online_share`; the glossary entry explains the two shares and the pandemic falls. Explore:
  `online=campus|mostly` (`SearchFilters.online`; campus keeps colleges with no share), an "Online" chip row in the
  Campus section with counts, a Toolbar chip, and a "Mostly online" card standout; "Grew the most"'s Explore link adds
  `online=campus`. The Data page lists the source; the release calendar's spring entry names `EF{Y}A_DIST`.
