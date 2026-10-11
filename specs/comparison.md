# Compare

Routes: `/compare?ids=a,b,c,d` (up to 4) for the overview, plus a page per topic and one for the full table — the
comparison's own map of the profile's six topics ([school-profile.md](school-profile.md)). The URL is the source of
truth; the saved list follows it.

> Built 2026-10-05 from [compare-redesign.md](compare-redesign.md): the single 10,000px page became an overview of
> topic cards plus a page per topic, mirroring the profile, with every block, chart, and citation kept somewhere.

## Building a comparison
- `CompareButton` (cards, table rows, profile hero, similar schools) toggles an id in the saved list
  (`lib/compare.ts`: localStorage + `compare-updated` event + `useCompareIds` via `useSyncExternalStore`).
- `CompareTray`: a floating pill at the bottom with stacked crests (tap to remove), empty slots, Clear, and
  "Compare N →". Hidden on `/compare` and on phones, where the tab bar's Compare badge replaces it ([mobile.md](mobile.md)).
- The header's Compare link (tab bar on phones) shows a lime count badge and links to the current selection.

## Routes
| Route | Content |
|---|---|
| `/compare?ids=` | Overview: header, Key differences, the radar, six topic cards, a link to the full table, sources |
| `/compare/admissions?ids=` | Getting in: the funnel, men and women, SAT/ACT ranges and policy, what each college looks at |
| `/compare/students?ids=` | Students & campus: who's on campus, race & ethnicity, where they're from, campus, LGBTQ+ policies |
| `/compare/academics?ids=` | Academics: faculty, spending and endowment, degrees awarded, Your major |
| `/compare/cost?ids=` | Cost & aid: what students pay, grants, sticker prices, net price by income, guarantees, the colleges' own CDS aid rows |
| `/compare/outcomes?ids=` | Outcomes: earnings and finishing, borrowing, 8-year outcomes, graduation by group |
| `/compare/history?ids=` | Over time: the 10-year direction table and Then & now, together |
| `/compare/table?ids=` | All the numbers: every row, grouped under the same five data topics, with a Differences-only switch |

Every route reads `?ids=` the same way (`lib/compare-data.ts`'s `loadComparison`: unique, unknown ids dropped, at
most four, URL order kept); `/compare/academics` also reads `?major=` for "Your major", and `/compare/table` reads a
`#group` hash in the URL to land just under its sticky header on one group (`#cost`, `#outcomes`, …) — every topic
page's "All … numbers in the table" link uses it. A topic page needs at least two resolvable colleges; with fewer it
redirects to the overview (`requireComparison`), which shows the one-college or empty state below. An unknown topic
(`/compare/nothing`) 404s. A topic page with nothing to compare — no compared college reports anything the page
shows — still renders its header and pills with one line ("None of these colleges reports …"), never a 404: the set
of colleges is the visitor's choice, not the page's.

## Header
`CompareHeader` is sticky under the site header on every compare route: slot-colored school chips (remove ×, a link
to the profile) and an "Add school" searchable picker (base-ui Popover), as before, plus, once two or more colleges
are picked, a second row of topic pills (Overview + the seven, in the profile's pill style, domain-colored dots).
Removing a chip or adding a school keeps you on the page you're viewing when it still makes sense: with two or more
colleges left and a topic page open, it `router.replace`s the same topic with the new id list; drop below two, or
you're on the overview already, and it replaces with the overview (or bare `/compare` when the list is empty). From
`md` the band is a fixed 9.5rem tall (`COMPARE_BAND`), so the table's sticky header row and the topic pages' "On
this page" column line up directly under it.

## Overview
1. **Key differences**: `keyDifferences()` sentences ("Harvard is 2.6× more selective than UCLA"), sorted by gap
   size and capped at six, each with a magnitude bar and an info tip.
2. **The shape of each school**: the same `RadarChart` of percentile ranks (selectivity, test scores, size, Pell
   share, first-gen, diversity), beside Key differences.
3. **Six topic cards** (`CompareTopicCards`, one per profile topic in pill order; a card is left out entirely when
   no compared college has any of its figures): the whole card links to its topic page, with an eyebrow (topic name
   plus the lineage year of its headline figure), a title, a one-sentence **comparative takeaway**
   (`lib/compare-insights.ts`), two or three compared rows, and a footer naming what the page holds. Phones drop the
   eyebrow and footer — a domain-colored bar and an arrow sit beside the title instead — so six stacked cards still
   fit the phone budget. Rows, by topic:
   - **Getting in**: acceptance rate ("Most selective"), SAT middle 50% — or ACT when no compared college reports
     SAT but one reports ACT; a test-blind college still shows "Test-blind" rather than dropping out of the row.
   - **Students & campus**: undergrads ("Largest"), Pell share ("Highest").
   - **Academics**: students per faculty ("Fewest"), most popular major (its title and share, as text).
   - **Cost & aid**: average cost ("Lowest"), aid generosity ("Most").
   - **Outcomes**: median earnings ("Highest"), graduation rate ("Highest").
   - **Over time**: applications' ten-year change as a text row (a direction icon, the word, the signed change) —
     not a bar; the whole card is hidden when no compared college has a usable trend.
4. **All the numbers** link card: "Every figure for these colleges in one table, with differences highlighted."
5. **Sources**: `MultiSourceNote` for `COMPARE_OVERVIEW_FIELDS` (Key differences' metrics, the radar's axes, and
   whatever the cards add) — one quiet line that collapses a college's Common Data Set citations into "Common Data
   Sets from N colleges" past three — then `BaselineNote` ("figures are the newest each college has published;
   years can differ between colleges").

## Topic pages
Every topic page (`CompareTopicPage`) shares one frame: the header above; where `TOPIC_DIFF_METRICS[topic]` names
any metrics (admissions, students, cost, and outcomes do; academics, history, and the table don't), a compact "Key
differences on {topic}" block of up to three sentences from the same `keyDifferences()`, filtered to that topic's
metrics; "On this page" in a side column from `lg`; the page's own blocks; its source footnote (`MultiSourceNote`
for `COMPARE_TOPIC_FIELDS[topic]`, unless the page supplies its own — Over time cites each chart's own history
editions instead); `BaselineNote`; and previous/next links among all seven (`CompareTopicNav`, "Back to Overview"
before the first).

- **Getting in** (`/compare/admissions`): the funnel (acceptance rate flagged "Most selective", applicants,
  admitted, yield) as cards; women's and men's admit rates; SAT and ACT `ScoreCompare` ranges side by side on a
  shared axis, submission rates, and a Test policy line; the admission-factors grid (`AdmissionFactorsGrid`: one row
  per factor, one column per college, the college's own CDS C7 level where it has one, else the federal use — the
  same strings the table shows). The CDS residency-based acceptance-rate and yield rows
  ([cds-residency-admissions.md](data-expansion/cds-residency-admissions.md)) stay table-only, as do Key
  differences and the radar.
- **Students & campus** (`/compare/students`): undergrads, Pell, first-gen, and the diversity index as cards; men,
  part-time, and 25-and-older as unflagged descriptive rows (more isn't better or worse); race & ethnicity
  (`RaceCompare`, one stacked bar per college with a shared legend, scrolling sideways inside its own card at 390px
  with four colleges); where first-years are from (in-state/other states/abroad shares) and new transfers; campus
  chips per college (`CampusChips`, from `campusChips()`: setting, the live-on rule or no housing, athletics level ·
  conference, ROTC, study abroad, undergrad research); the LGBTQ+ policy checklist
  ([lgbtq-life.md](lgbtq-life.md), `comparedChecklist`), its own small section rather than a table row, hidden
  entirely when no compared college has anything verified.
- **Academics** (`/compare/academics`): students per faculty ("Fewest"), full-time faculty share, average salary;
  instruction spending and endowment per student as bars only when every reporting college shares one accounting
  form (public/GASB vs. private/FASB), else each college's own figure and form as text, exactly as the table shows
  it; bachelor's awarded and most popular majors; **Your major** (`YourMajor`), a field picker (broad 2-digit CIP
  families any compared college awards bachelor's in) showing bachelor's count, share with its ten-year change,
  earnings, debt, and programs per college, with `?major=` in the URL.
- **Cost & aid** (`/compare/cost`): average cost, aid generosity, and net price with grants on one shared scale
  ("Lowest"/"Most"/"Lowest"); grants (first-years with grants, average grant, aid from the college); sticker price
  and tuition & fees (in-state/out-of-state) as rows on a second shared scale, plus the public-only "first-years
  paying out-of-state rates"; `NetPriceCompare` by family income (an income slider, $0–$400K in $5K steps, default
  $150K and remembered in this browser only, with each college's price at that income on one shared scale: solid bars
  where the federal data publish it, hatched bars with the word "estimate" where it is the model's estimate, "Full
  price" past the break point, a "Merit possible" note above $110K where the college offers merit, and a Bars | Table
  switch; with estimates hidden, incomes above $110K read "Published data end at $110K"); **Where need-based aid ends,
  merit, and published promises**, a small text table of three rows built by `costByIncomeRows(showEstimates)`
  (`lib/compare-cost-rows.ts`; wording in `lib/cost-at-income.ts`): *Need-based aid up to* (the break point's range with
  "estimate", "Little need-based aid above $110K", or "Published data end at $110K"), *Merit for students without need*
  ("No merit aid", "18% got merit aid, averaging $22K", or the IPEDS proxy labeled "(proxy)"), and *Published promise*
  (the college's income lines with "(in-state)" where they apply to residents only, and the award year); tuition
  guarantee and Promise program as a small text table; the colleges' own CDS aid-process rows ([cds-financial-aid.md](data-expansion/cds-financial-aid.md),
  `compareAidRows`) as another small text table, when any compared college has them — the same strings and rows the
  full table appends to its Cost & aid group, after the same three cost-by-income rows (built at render time because they
  take the accuracy pilot's gate, `estimatesShown()`; the table adds each cell's own year, so the promise row leaves the
  award year out there).
- **Outcomes** (`/compare/outcomes`): median earnings, graduation, and retention (all flagged "Highest"); median
  debt ("Lowest"), federal loan rate, median debt of Pell recipients; credential within 4 and 8 years and enrolled
  elsewhere 8 years on; graduation by group — Pell vs. neither, the Pell gap, and by race & ethnicity (blank, never
  0, under 30 students) — and the colleges' own CDS on-time-progress rows. Each block only renders when a compared
  college has that data; a page with none shows one line.
- **Over time** (`/compare/history`): the 10-year direction table (the four trend indicators per college) and Then
  & now (`ThenAndNow`, a `SlopeChart` for average cost, acceptance rate, applicants, undergrads, or diversity) —
  which sat 2,000px apart on the single page — together on one page. Each cites its own history editions
  (`HistorySourceNote`) rather than the page's default source note; a college with no ten-year history is left out
  of the rows that need it, and the page shows one line when none has any.

## All the numbers (`/compare/table`)
Every row the single page had, in one table (`CompareTable`), grouped under the same five data topics (admissions,
students, academics, cost, outcomes; Over time and the table page itself have no row group of their own) with a
heading row per group that doubles as its anchor. The label column, and from `lg` the header row of college names, stick in place (below
`lg` the whole table scrolls sideways instead, with the label column still sticking). A row or a whole group is
marked when fewer than two colleges have a value or every present value matches; the **Differences only** switch
(`DifferencesOnly`, off by default) hides marked rows with a CSS rule rather than re-rendering the table. A cell
whose own year differs from the row's shows that year small and muted beside the value. "Website" closes the table
as its own row — an actual link per college, not a generic string cell. The colleges' own CDS financial-aid rows
(`compareAidRows`, keyed to the federal aid year) are appended to the Cost & aid group here, identically to how
they appear again on the Cost & aid topic page.

## Page states
- **Empty** (no resolvable ids): "Pick your contenders" plus six preset matchups.
- **One school**: "Pick a rival" with similar-school suggestions that link straight to a two-way compare.
- **Two to four**: everything above.

## Phone and tablet treatment
Topic pills and school chips each scroll sideways in their own row. Four colleges keep their score ranges and race
bars at full width by scrolling sideways *inside* their own card rather than shrinking illegibly thin
([mobile.md](mobile.md#compare-on-phones)). Tablet (640–1024) uses the same layout as desktop with narrower cards;
no compare page needed `ShowMore` folding (unlike the profile's Over time and Outcomes pages) — every page measured
inside its budget without one.

## Measurement
`npm run measure-profile -- --compare a,b,c` (repeatable — several `--compare` sets may be mixed with profile ids)
loads the overview and the seven topic pages at 1440/810/390 and checks them against budgets: the overview at most
2,500px on desktop and 4,000px on a phone; each topic page at most 4,000px on desktop (no budget elsewhere); the
full table is exempt everywhere, since it's meant to be the complete view. See
[compare-redesign.md](compare-redesign.md#as-built) for the measured heights.

## Tests
`tests/compare-topics.test.mts` freezes the single page's old row labels and checks that the table's groups still
cover every one of them (and no others), that every topic has a route file, that `compareHref` /
`adjacentCompareTopics` / `isCompareTopic` behave, and that every `COMPARE_TOPIC_FIELDS` entry — and the table's —
is complete and duplicate-free. `tests/compare-cards.test.mts` checks each card's rows, title, and footer, that a
card with nothing to show is hidden, the SAT→ACT fallback, and the shared score axis. `tests/compare-insights.test.mts`
checks the comparative-takeaway sentences for the pilot colleges, for two and four colleges, ties, and colleges that
report little or nothing — and that one never claims a national rank, a percentile, or a made-up figure.

School colors come from the compare slots in pick order (`SLOT_COLORS`), validated all-pairs for overlap.
