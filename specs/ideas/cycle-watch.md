# Cycle Watch: What Changed for the Coming Application Cycle

> Status: **idea** (2026-10-03; **rewritten** 2026-10-26 after the roadmap review). The first draft diffed CDS editions.
> Since then the **Common App Requirements Grid** ([../data-expansion/common-app.md](../data-expansion/common-app.md),
> built 2026-10-25) gives, for 1,025 member colleges every cycle, the test policy, the early rounds offered, every
> deadline, the fee and fee waiver, the essay and recommendation requirements, and the aid forms, stamped with the
> cycle and an update date, with every edition kept
> (`data/common-app/grid/<cycle>_<updated>.json`); the test-optional study already has a "this cycle" block from it
> ([../trends/test-optional.md](../trends/test-optional.md), 2026-10-25). The change records and the digest exist
> ([../product/follow-colleges.md](../product/follow-colleges.md)), and the planner reads the grid's deadlines. So the
> idea shrinks to a diff of the grid between editions, with the CDS editions as the second source. Part of [ideas](README.md).

## Question it answers
*What's different this year at the colleges I'm applying to?* Each cycle, dozens of colleges change their test policy,
add or drop early decision or early action, move a deadline, raise the fee, or start requiring the CSS Profile. A
counselor learns this from newsletters (College Kickstart's "Over 30 schools have modified early admission options" is a
hand-written post each fall); a family learns it when the application opens.

## Why it's fresh
A generated page with citations, not a column. The grid changes within a cycle (its update stamp moves through the
summer and fall) and between cycles (a new edition each August), and the site stores every edition. Comparing them is a
table of changes in the college's own terms, dated to the stamp. Google Flights' "typical versus now" and a guidebook's
"new this edition" are the patterns.

## Data
A `cycle_changes` file built at publish by diffing grid editions (and, where a college is not a member, CDS editions),
one row per college × kind × cycle, keeping both values with their stamps:

| Kind | From | Example line |
|---|---|---|
| Test policy | grid `apply.test_policy` (codes A, F, I, N, S); CDS C8 for non-members; IPEDS `ADMCON7` history as the long view | "Requires the SAT or ACT again for fall 2027 applicants (optional since 2020)" |
| Early rounds | grid `apply.deadlines.{ed, ed2, ea, ea2, rea}` present or absent; CDS C21, C22 | "Adds Early Decision II, deadline January 5" · "Drops Early Action" |
| Deadlines | grid `apply.deadlines.*`; CDS C14, C16, C17 | "Regular deadline moves to January 2 (was January 15)" |
| Fee and waiver | grid `apply.fee.us`, `apply.fee_waiver`; CDS C13 | "Application fee $85 (was $75)" · "Now takes the fee waiver" |
| Requirements | grid `apply.essay_required`, `.writing_supplement`, `.recommendations.*`, `.courses_grades_required` | "Now asks for two teacher evaluations (was one)" |
| Aid forms | CDS H8 | "Now requires the CSS Profile" |
| What counts | the events log (`lib/events.ts`, from admission factors) | "Now considers demonstrated interest" (built) |
| Admission to majors | [getting-into-the-major.md](getting-into-the-major.md), once its second wave exists | "Computer science now admits directly from high school" |

Rules: a change is reported only between two editions the site holds; the first edition is "on file", never "changed".
Each row names the cycle in the source's own words. Nothing is predicted; a policy a college announces before the grid
or its CDS records it is captured by the agent's class-profile route, with the quote, and labeled "announced". A row
without a source stamp is not published.

## Display
- **`/trends/this-cycle`** (public), beside the built "This season on the Common App" block: "For students applying in
  fall 2026 (entering 2027)": counts by kind; the changes grouped by kind, each a college row with the sentence, both
  values with their stamps, and the citation popover; filters by state, type, and selectivity tier; the count of
  colleges with an edition on file, so silence isn't mistaken for no change.
- **Profile**: the college's own changes in the "What it takes to apply" card and in the public "What changed" panel.
- **The plan**: a move, "2 colleges on your list changed something for your cycle", opening the lines; the planner's
  deadlines already follow the grid, so a moved deadline moves the calendar on its own.
- **Follow digest**: a `policy` change kind in the built digest, so a family following a college hears the day it's
  published.

## Rules
- Both values and both stamps on every line; the newer edition never silently replaces the older in the sentence.
- The grid is the source for members; the CDS for the rest; IPEDS gives the long view only.

## Tier
Free, like the trends pages.

## Complexity
Small: a diff over files the site already stores, one trends page, a digest kind, and a move. (Medium in the first
draft, when it needed its own change table from CDS editions.)

## Open questions
1. The first cycle-to-cycle diff is possible in August 2027, when the 2027-28 grid arrives; within-cycle diffs (the
   update stamp moving) are possible as soon as the sync stores a second stamp. Start with the within-cycle page.
2. Should the "brief", the opt-in monthly email for counselors from the first draft, stay? Yes, but as a digest kind for
   people who follow many colleges, not a separate product; it is the content channel the counselor portal needs.
