# "Known for: Big Greek life"

> Status: **planned** (not built). Needs [greek-life.md](greek-life.md) (built), whose "Known for" section records
> the threshold this spec exists to act on.

## Goal
Give colleges where fraternity and sorority life is a big part of campus a "Known for: Big Greek life" badge,
alongside the site's other "Known for" tags (`lib/insights.ts`), computed from `school.reported.greek`
(`lib/cds/greek.ts`, `lib/cds/greek-display.ts`).

## Why now
[greek-life.md](greek-life.md)'s "Known for" section set `KNOWN_FOR_MIN_REPORTERS = 50`
(`lib/cds/greek-display.ts`) as the point at which a top-decile badge would be meaningful rather than noise. That
threshold was met 2026-10-10, with 102 colleges reporting an undergrad fraternity-or-sorority percentage
(`specs/backlog.md` tracks the open item). This spec is the build: the rule, the wiring, and lifting the
partial-coverage guard for this one new use.

## What's already there
- `school.reported.greek.{frat,sor}_pct_undergrad` (CDS F1), merged and lineage-cited, with a
  `greek-f1-ratio` units-mix-up check — all built ([greek-life.md](greek-life.md)).
- The profile card, Compare rows, and Explore's participation filter already read these fields.
- `greekReporters`/`fratMedian`/`sorMedian` (`lib/cds/greek-display.ts`) already compute over reporting colleges
  only.
- A partial-coverage guard (`tests/cds-greek.test.mts`) that fails if any Greek field reaches `lib/insights.ts`
  (where "Known for" badges are computed), METRICS, a rank, a percentile, a median outside `greek-display.ts`, a
  sort, or Home facts — this spec's build is the one place that guard must be deliberately, narrowly lifted.

## What this build adds
- **The rule**: what counts as "Big Greek life" — most likely a top-decile cut on `frat_pct_undergrad` or
  `sor_pct_undergrad` (never their sum, per [greek-life.md](greek-life.md)'s Rules) among `greekReporters`, with a
  floor so a small reporting pool near the threshold can't crown one college by a fluke. Needs an owner decision on
  the exact cut and floor, the same way other "Known for" badges were calibrated.
- **The wiring**: a case in `lib/insights.ts`'s badge computation, reading `reported.greek` for reporting colleges
  only (never inferring anything for non-reporters) and citing the figure the same way the profile card and Compare
  already do.
- **Lifting the guard**: `tests/cds-greek.test.mts`'s partial-coverage guard currently fails the build the moment
  `lib/insights.ts` names a Greek field at all. It needs a narrow exception for exactly this one badge, not a
  blanket removal — the rest of the guard (METRICS, ranks, percentiles, medians, sorts, Home facts) should keep
  holding.

## Complexity
Small: the data, the display module, and the guard tests already exist. What's left is one rule, one badge
computation, and one guard exception — no new source, no new profile section.
