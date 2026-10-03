# Cycle Watch: What Changed for the Coming Application Cycle

> Status: **idea** (2026-10-03). After [cds-test-scores-and-policy.md](../data-expansion/cds-test-scores-and-policy.md),
> [cds-admissions.md](../data-expansion/cds-admissions.md),
> [cds-application-logistics.md](../data-expansion/cds-application-logistics.md), and
> [follow-colleges.md](../product/follow-colleges.md) (the change records). Part of [ideas](README.md).

## Question it answers
*What's different this year at the colleges I'm applying to?* Each cycle, dozens of colleges change their test policy,
add or drop early decision or early action, move a deadline, raise the application fee, or start requiring the CSS
Profile. A counselor learns this from newsletters and blogs (College Kickstart's "Over 30 schools have modified early
admission options" is a hand-written post each fall); a family learns it when the application opens.

## Why it's fresh
A generated page with citations, not a column. The CDS records the agent collects
([college-reported-round-3.md](../college-reported-round-3.md)) carry each college's test policy for the coming cycle
(C8), its early rounds and their deadlines (C21, C22), its regular deadline, notification and reply dates, fee and
waiver (C13 to C17), and its aid forms (H8). Comparing editions gives the changes; the events log the site already
keeps (`lib/events.ts`, from [admission-factors.md](../data-expansion/admission-factors.md)) and the publish-time
change records in [follow-colleges.md](../product/follow-colleges.md) are the mechanism. Google Flights' "typical versus
now" and a guidebook's "new this edition" are the patterns; the Quad twist is that every line carries the college's own
words.

## Data
A `cycle_changes` table built at publish from the per-edition records (and from IPEDS where the item is federal), one
row per college × kind × cycle, keeping both editions' values with their years and the quote:

| Kind | From | Example line |
|---|---|---|
| Test policy | CDS C8 for the coming cycle against the prior edition; IPEDS `ADMCON7` history | "Requires the SAT or ACT again for fall 2027 applicants (optional since 2020)" |
| Early rounds | C21, C22 | "Adds Early Decision II, deadline January 5" · "Drops Early Action" |
| Deadlines | C14, C16, C17 | "Regular deadline moves to January 2 (was January 15)" |
| Fee and waiver | C13; IPEDS application fee | "Application fee $85 (was $75)" |
| Aid forms | H8 | "Now requires the CSS Profile" |
| What counts | the events log | "Now considers demonstrated interest" (these events exist today) |
| Admission to majors | [getting-into-the-major.md](getting-into-the-major.md), once it exists | "Computer science now admits directly from high school" |

A row without a quote or that fails the agent's checks isn't published.

## Display
- **`/cycle/{entry-year}`** (public): "For students applying in fall 2026 (entering 2027)": counts by kind; the
  changes grouped by kind, each a college row with the sentence, both values with their years, and the citation
  popover; filters by state, type, and selectivity; "updated with the {release} data"; and the count of colleges with
  a coming-cycle edition on file, so silence isn't mistaken for no change.
- **Profile**: the college's own changes in the admissions card and in the public "What changed" panel from
  [follow-colleges.md](../product/follow-colleges.md).
- **`/me`**: "2 colleges on your list changed something for your cycle", with the lines.
- **Follow digest**: a `policy` change kind, so a family following a college hears the day it's published.
- **The brief**: an opt-in email, monthly in season, from the same digest engine: the cycle's changes across all
  colleges, new [guides](guides.md), and the release calendar. Written for counselors, open to anyone, free, with no
  tracking beyond delivery. It is the content channel the [counselor portal](../product/counselor-portal.md) needs.

## Rules
- A change is reported only between two editions the agent has read; a first edition is "on file", never "changed".
- Each value says which cycle it is for in the college's own words (C8 asks about "fall 2027 first-year applicants").
- Nothing is predicted. A policy a college announces on its website before filing it is captured by the agent's
  class-profile route, with the quote, and labeled "announced".

## Tier
Free, including the brief.

## Complexity
Medium: a change table built at publish from the agent's editions, one public page, a digest kind, and an email
variant.

## Open questions
1. Year one covers only colleges with two editions on file; publish the count and let the page grow with the archive.
2. Should the brief carry Quad's own release notes too? Yes, briefly: a reader who follows the data should hear when
   the site changes.
