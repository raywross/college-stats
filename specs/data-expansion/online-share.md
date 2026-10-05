# Online Share: Undergraduates Studying Entirely Online (IPEDS Fall Enrollment, distance education)

> Status: **planned**. Specified 2026-10-05. Needed by [Study 7](../trends/where-students-go.md)'s campus-based panel;
> replaces the reviewed `data/trends/online-first.json` that the movers' growth lists use
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
