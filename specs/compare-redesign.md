# Compare Redesign: Overview Cards and a Page per Topic

> Status: **built** 2026-10-05 (#84). Decided 2026-10-02, the day the profile redesign shipped
> ([profile-redesign.md](profile-redesign.md)): the same review, the same four kinds of proposal, and the same
> winner, so a comparison reads like the profiles it is built from. Replaced the single compare page;
> [comparison.md](comparison.md) describes the result.

## Why
The compare page grew the way the profile did: every data wave added a group of metric cards and a few dozen rows
to the table at the bottom. Measured on 2026-10-02 with three colleges (Harvard, Ohio State, UCLA):

| Width | Page height | Screens | Longest sections |
|---|---|---|---|
| Desktop 1440 | 10,077px | ~11 | All the numbers 4,639 · Cost & outcomes 1,114 · Students 663 |
| Tablet 810 (iPad) | 12,203px | ~11 | All the numbers 5,607 · Cost & outcomes 1,314 · Students 841 |
| Phone 390 | 15,328px | ~18 | All the numbers 6,481 · Cost & outcomes 2,026 · Students 1,583 |

190 SVG charts on one page. What the review found:
- **The first screen is right**: the sticky school chips, "Key differences" (six sentences with gap bars), and
  the radar answer "how do these differ?" at once. Everything after it is a long walk.
- **"All the numbers" is half the page**: 91 rows, 4,639px on desktop and 6,481 on a phone, placed last, with no
  way to jump into it or to see only what differs. It is the page's accessible view and must stay, but as a last
  section it mostly adds scrolling.
- **Ten sections, no navigation.** Key differences, Shape, 10-year direction, Admissions, Test scores, Students,
  Cost & outcomes, Your major, Then & now, All the numbers: there is no section nav or pills, so the only way to
  reach "Your major" is to scroll past six sections.
- **Two sections cover the same decade** (10-year direction near the top, Then & now near the bottom), 2,000px apart.
- **Cost & outcomes mixes three topics** as the old profile did (price, aid, outcomes), with net price by income
  under them.
- **The metric cards work** (`CompareMetric`: one bar per college in its slot color, the extreme flagged
  neutrally); there are just 30 of them in a row.
- **Profiles and comparisons no longer match.** A profile is an overview of topic cards plus six topic pages; the
  comparison of the same colleges is one page with different section names ("Cost & outcomes", "Students" without
  campus life). Someone moving from a profile to a comparison has to relearn the map.
- Keeps: the sticky header with slot-colored chips and the add-school picker, Key differences, the radar, the bar
  cards, the shared-axis score ranges, net price by income, "Your major", Then & now, the table with its per-cell
  source chips, and the empty and one-school states.

## Research (2026-10-02)
- **Comparison tables** ([NN/g](https://www.nngroup.com/articles/comparison-tables/)): keep to five items (two on
  phones), put the attributes that matter first, offer a "highlight differences" switch, and on phones turn
  columns into tabs or lists rather than shrinking the table. Content matters more than layout: consistent
  attributes, plain terms.
- **GSMArena** compares two phones row by row in spec groups under a sticky product header; differences are
  implicit in the side-by-side values. **Versus.com** (from the earlier [design research](design-research.md))
  leads with "N reasons why A beats B", then per-property rows, which "Key differences" already borrows.
- **College Scorecard** compares up to ten colleges as one card per metric with a bar per college, the pattern
  `CompareMetric` uses; **Niche** compares two at a time in a grade table. Neither offers topic pages for a
  comparison; both grow long.
- The profile's own research applies: tabs hide what people compare across, accordions on desktop add decisions,
  more than two disclosure levels loses people, and a page split by topic beats in-page anchors when people need
  only a few topics ([profile-redesign.md](profile-redesign.md#research-2026-10-02)).

## Proposals
Four ways to reorganize the same content. All keep the sticky header, Key differences, the radar, the empty and
one-school states, and the URL as the source of truth (`?ids=a,b,c`).

**A. Tabs on one route.** Pills under the header switch between Overview, Getting in, Students, Academics, Cost &
aid, Outcomes, Over time, and All the numbers with `?topic=`; one shows at a time.

**B. Overview cards and topic pages (hub and spoke), mirroring the profile.** `/compare?ids=` becomes an
overview: the header with topic pills, Key differences and the radar, then one card per topic with two or three
headline metrics compared (a bar per college) and a link to `/compare/{topic}?ids=`. Topic pages hold today's
cards and charts for that topic; `/compare/table?ids=` holds All the numbers with a "differences only" switch.

**C. One page, re-chunked.** Keep one page, add a sticky pill row that jumps to sections, merge the two decade
sections, split Cost & outcomes in two, and collapse All the numbers behind a "Show the table" button.

**D. Side-by-side profiles.** Render each college's profile overview cards in parallel columns (two on desktop,
swipeable on phones), so a comparison is literally profiles next to each other.

### Scoring
Same criteria and weights as the profile.

| Criterion (weight) | A Tabs | B Cards + pages | C Re-chunked | D Side-by-side |
|---|---|---|---|---|
| First screen answers "how do these differ?" (25) | 4 | 5 | 4 | 2 |
| Depth kept and findable (20) | 4 | 4 | 4 | 3 |
| Phone experience (15) | 3 | 5 | 3 | 2 |
| Tablet works like desktop (10) | 4 | 4 | 3 | 2 |
| Related numbers visible together (10) | 3 | 4 | 5 | 2 |
| Deep links, sharing, search engines (10) | 3 | 5 | 3 | 3 |
| Build cost and fit with existing code (10) | 3 | 4 | 4 | 2 |
| **Weighted score (out of 5)** | **3.55** | **4.55** | **3.80** | **2.30** |

Notes behind the scores:
- D fails the first criterion: a comparison's job is the differences, and parallel profiles make the reader find
  them. On a phone it is two long columns to swipe between.
- A and C keep the ten sections on one route; C's collapsed table and jump pills are cheap and worth doing even in
  B's world, but neither matches the profile's map.
- **B wins**, and scores higher here than it did for the profile, because the pieces exist: the pills, compact
  header, `TopicPage` frame, and `Panel` headers from the profile redesign; the bar cards and charts from today's
  compare page. The topic keys are the profile's, so a reader who learned the profile map knows the comparison map.

## Before and after
The "before" images are the live site on 2026-10-02 with Harvard, Ohio State, and UCLA. The "after" images are a
static mockup in the site's type and colors with real figures, to show the shape of the design.

![The compare page today and the overview mockup, whole pages at the same scale](/roadmap/compare-redesign/desktop-length.jpg)
*Whole pages at the same scale, desktop: 10,077px today against about 1,900px for the overview. The table and the
detail move to their own pages.*

![First screen on desktop, today and in the mockup](/roadmap/compare-redesign/desktop-fold.jpg)
*The first screen on a desktop. The school chips and Key differences stay; a row of topic pills joins the sticky
header, and the radar sits beside the differences as today.*

![The compare overview mockup on desktop](/roadmap/compare-redesign/after-overview-desktop.png)
*The overview mockup at full size: Key differences and the radar, then six topic cards with two or three compared
metrics each, then the link to the full table.*

![The compare overview on a phone, today and in the mockup](/roadmap/compare-redesign/phone.jpg)
*On a phone: today's first screen and 15,328px page; the mockup's first screen; and the whole mockup overview at
about 3,500px.*

## Design: compare overview and topic pages

### Routes
| Route | Content |
|---|---|
| `/compare?ids=` | Overview: compact header (chips, add school, topic pills), Key differences, the radar, six topic cards, the table link. Empty and one-school states as today |
| `/compare/admissions?ids=` | Getting in: acceptance, applicants, admitted, yield, men and women; SAT and ACT ranges on a shared axis; submission rates and test policy; the admission-factors grid (the table's factor rows as a card) |
| `/compare/students?ids=` | Students and campus: undergrads, Pell, first-gen, diversity, race and ethnicity bars; men, part-time, adults; residence and transfers; campus chips (setting, housing, athletics, ROTC, programs) |
| `/compare/academics?ids=` | Majors and faculty: students per faculty, full-time share, salary; spending and endowment (same accounting form only, as today); bachelor's awarded, top majors; "Your major" |
| `/compare/cost?ids=` | Cost and aid: average cost, aid generosity, net price with grants, sticker prices, grants and average grant, net price by family income, tuition guarantee and Promise rows |
| `/compare/outcomes?ids=` | Outcomes: earnings, graduation, retention, debt and loans, 4- and 8-year credentials, transfer-out, graduation by group and the Pell gap |
| `/compare/history?ids=` | Over time: the 10-year direction table and Then & now, together |
| `/compare/table?ids=` | All the numbers: today's table grouped by topic with a sticky header row and first column, a "Differences only" switch (NN/g), and anchors per group |

The topic keys and labels are the profile's (`lib/profile-topics.ts`), with `table` added for compare. Every page
keeps `?ids=` (and `?major=` on academics) and 404s on an unknown topic; a topic page with nothing to compare (no
college reports the topic) shows one line and the pills, not a 404, because the set of colleges is the user's.

### Overview page
1. **Header** (`CompareHeader`, extended): the slot-colored chips and add-school picker as today, with a second
   row of topic pills (Overview + seven) in the same `TopicPills` style as profiles; sticky under the site header,
   swipeable on phones.
2. **Key differences and the radar**, side by side as today, with the differences list capped at six.
3. **Topic cards**, one per topic, 2 columns from `sm`, stacked on phones, the whole card a link
   (`components/compare/CompareTopicCard.tsx`, sharing the shell with the profile's `TopicCard`):
   - eyebrow with the topic and its year from lineage, a title, and a **comparative takeaway** sentence
     (`lib/compare-insights.ts`: "Harvard admits 3.6%, UCLA 9.0%, Ohio State 61%; Harvard's yield is the highest
     nationally"), built from the metrics the card shows and the existing `keyDifferences` phrasing;
   - **two or three metrics as bar rows** (`CompareMetric` in a compact size), one bar per college in slot
     colors, the extreme flagged neutrally as today: Getting in = acceptance rate, SAT (or ACT) range; Students =
     undergrads, Pell share; Academics = students per faculty, most popular major (text row); Cost = average
     total cost, aid generosity; Outcomes = median earnings, graduation rate; Over time = applications change,
     with the direction words;
   - a footer link naming what the page holds.
   Every figure keeps its (i) citation; a college that doesn't report a metric shows "Not reported" in its row.
4. **All the numbers** link card: "Every figure for these colleges in one table, with differences highlighted".
5. Sources: `MultiSourceNote` for the overview's fields, as the cards' footers do today.

### Topic pages
- The frame is the profile's `TopicPage` adapted for a set of colleges: the extended `CompareHeader` instead of the
  college header, an "On this page" list of the page's blocks, today's blocks moved as-is (metric card grids, the
  score ranges, race bars, net price by income, Your major, Then & now), previous/next topic links, and the page's
  `MultiSourceNote`.
- **Over time** joins the 10-year direction table and Then & now, which today sit 2,000px apart.
- **All the numbers** keeps every row and source chip, adds a sticky header row (college names) and the
  "Differences only" switch (rows where every college reports the same value, or where only one reports, are
  hidden), and groups rows under topic headings that match the pills.
- Tablet: metric card grids 2-wide; the table scrolls inside its box. Phone: today's phone treatment (pill bar,
  sticky first column, swipeable rows).

### Budget
Overview content at most **2,500px on desktop and 4,000px on a phone** for three colleges; topic pages at most
4,000px on desktop. `scripts/measure-profile.mts` gains a `--compare ids` mode that measures the compare overview
and its pages the same way.

### What gets simpler
- Ten sections and a 91-row tail become an overview and seven pages that mirror the profile's map; the sticky
  header gains the pills profiles already have.
- One decade section instead of two; cost, aid, and outcomes separated as on profiles.
- `app/compare/page.tsx` (706 lines, with the 91-row table definition) becomes a layout, an overview, seven short
  route files, and `lib/compare-topics.ts` holding the table rows grouped by topic (the same rows, now reused by
  the topic pages' "All the numbers" anchors).

## Build order
1. **Routes and moves**: the compare topic pages built from today's sections, the extended header with pills,
   `/compare/table` with the switch; the overview keeps today's sections above a link list until the cards land.
   *Built 2026-10-05* (`feature/compare-redesign-foundation`): `lib/compare-routes.ts` and `lib/compare-topics.ts`,
   the extended `CompareHeader`, the `CompareTopicPage` frame, `CompareTopicNav`, `CompareMetric`'s `row` variant,
   `ScoreCompare`, `CompareTable`, `DifferencesOnly`, and the stub topic routes (frame + "This page is being built")
   so pills and typechecking worked before the page units landed. Alongside it, *built 2026-10-05*
   (`feature/compare-redesign-measure`): the `--compare` mode in `scripts/measure-profile.mts` and its budgets.
   Then, each replacing its stub whole, *built 2026-10-05* (`feature/compare-redesign-admissions`, `-students`,
   `-academics`, `-cost`, `-outcomes`): the six non-table topic pages, each with the components its page alone
   needed (`AdmissionFactorsGrid`, `CampusChips`, `RaceCompare`, `LgbtqPolicyTable`).
2. **Cards**: the six compare topic cards and the comparative takeaways; the overview shrinks to header,
   differences, radar, cards, table link.
   *Built 2026-10-05* (`feature/compare-redesign-cards`): `lib/compare-cards.ts`, `lib/compare-insights.ts`,
   `CompareTopicCard`/`CompareTopicCards`/`CompareCardRows`, `tests/compare-cards.test.mts`,
   `tests/compare-insights.test.mts`.
3. **Pilot**: two, three, and four colleges, including one that reports little (an open-admission college with no
   scores), at three widths with the measurement script; a test that the union of the pages' table rows equals
   today's `TABLE_ROWS`.
   *Built 2026-10-05* (`feature/compare-redesign-qa`): measured two-, three-, and four-college sets at three
   widths, fixed small layout defects (overflow, clipped pills, misaligned bars), and confirmed every page inside
   its budget except the full table, which has none. Documented here (`feature/compare-redesign-docs`): this spec,
   [comparison.md](comparison.md), [mobile.md](mobile.md), [trends-design.md](trends-design.md), and the roadmap
   index updated to match what was built.

## As built
What differed from the design above, and why:
- **`lib/compare-routes.ts` split out** from `lib/compare-topics.ts`: the topic list, keys, `compareHref`,
  `adjacentCompareTopics`, `TOPIC_DIFF_METRICS`, and the shared types live there; `lib/compare-topics.ts` re-exports
  all of it (`export * from "./compare-routes.ts"`) and adds the "All the numbers" rows and the per-page field
  lists. Only the client `CompareHeader` imports `compare-routes` directly, so its bundle doesn't ship the ~700
  lines of table-row definitions the design's single `lib/compare-topics.ts` would have carried into every page.
- **No `layout.tsx`**, as the profile redesign also found unnecessary: `loadComparison` is `React.cache`d, so a page
  and its metadata share one load, and each page renders its own `CompareTopicPage` frame directly.
- **The table page is exempt from the height budget**, not merely unbudgeted by omission: it's the dataset's
  complete view by design (130 rows, 7,328px for three colleges at 1440px), so `compareHeightBudget` returns `null`
  for it everywhere, the one page the measurement script never fails on height.
- **Pills always list all seven topics** and hide only below two colleges (every topic would redirect straight
  back to the overview); a topic page itself redirects to the overview with fewer than two resolvable colleges
  (`requireComparison`), which then shows the one-college or empty state — never a half-built topic page.
- **Each topic page opens with its own Key differences**, filtered to `TOPIC_DIFF_METRICS[topic]` and capped at
  three; academics, history, and the table have none (academics has no Key differences metric to begin with, and
  comparing directions or an already-exhaustive table isn't a "difference" in the same sense).
- **Topic cards drop their eyebrow and footer on phones** (a domain-colored bar and an arrow sit beside the title
  instead) — the design didn't specify a phone treatment for the cards, and six full cards with both would have
  pushed the overview past its 4,000px phone budget.
- **The overview's title is compact** ("Head-to-head" at heading size, no eyebrow, less top padding): the mockup
  leads with the school chips and pills, and the title band was the difference between 2,526px and the 2,500px
  desktop budget once the sources block was collapsed like the profile's.
- **The Over time card is a text row, not a bar**: a direction icon, the direction word, and the signed ten-year
  change per college — the clearest way to show "grew" vs. "fell" side by side, where a bar would need its own
  scale per college and say less.
- **The score row switches from SAT to ACT only when no compared college reports SAT but at least one reports
  ACT**, and keeps a row at all while a college is test-blind (labeled "Test-blind", never blank) — dropping the
  row entirely would hide a real, comparable fact: that a college doesn't consider scores.
- **A topic card hides completely when no compared college has any of its figures** (owner assumption 8), rather
  than rendering empty bars or an all-"Not reported" card.
- **Instruction spending and endowment compare as bars only when every compared college that reports finances
  shares one accounting form** (public/GASB or private/FASB); otherwise each college's own figure and form show as
  text, the same strings "All the numbers" already used — dollar figures on the two forms aren't directly
  comparable, so a bar chart would imply a comparison that isn't there.
- **The LGBTQ+ policy checklist lives on the Students & campus page**, not the table (owner assumption 6): it needs
  each college's *detail* file alongside the school record, which the generic table-row functions (`School` only)
  don't thread through, so it was always its own small section, now placed where campus life already lives.
  Correspondingly, **debt and loan rows sit under Outcomes**, not Cost (owner assumption 7) — the opposite of
  where the profile keeps them, because the compare spec asked for it and a comparison table groups by what the
  figure measures, not by which page is shorter.
- **The CDS residency-based acceptance-rate and yield rows** ([cds-residency-admissions.md](data-expansion/cds-residency-admissions.md))
  stay table-only rather than moving to the Admissions topic page: that spec's own text once said the redesign
  would move them there unchanged, but the page unit kept the topic page to the funnel, by-sex rates, scores, and
  the factors grid, leaving the residency breakdown to the full table (fixed in that spec alongside this one).
- **Comparative-takeaway sentences** (`lib/compare-insights.ts`) say "former students earn" (never "graduates
  earn," since not every entrant graduates), use the comparative ("higher," "larger") rather than a superlative
  for exactly two colleges, and name a college once rather than twice when it leads both clauses of a sentence
  ("Ohio State costs about $17.6K less a year than Harvard on average, and its grants cover the larger share of
  its price" — not "Harvard's grants cover…" as a second, repetitive clause).
- **Measured heights** (1440 / 810 / 390 desktop/tablet/phone, content to the end of `<main>`, three colleges —
  Harvard, Ohio State, UCLA):

  | Page | Desktop 1440 | Tablet 810 | Phone 390 |
  |---|---|---|---|
  | Overview | 2,466 | 3,036 | 3,721 |
  | Getting in | 2,802 | 3,077 | 4,198 |
  | Students & campus | 3,762 | 4,350 | 5,488 |
  | Academics | 2,193 | 2,706 | 3,477 |
  | Cost & aid | 2,976 | 3,454 | 3,780 |
  | Outcomes | 2,256 | 2,727 | 3,311 |
  | Over time | 1,585 | 1,706 | 2,070 |
  | All the numbers | 7,328 | 9,416 | 10,433 |

  Today's single page, for the same three colleges, measured 10,077 / 12,203 / 15,328px (the table at the top of
  this spec). Four colleges add roughly 200px to any page.

## Files (as built)
- `lib/compare-routes.ts` (topics, routes, `compareHref`, `adjacentCompareTopics`, `TOPIC_DIFF_METRICS`),
  `lib/compare-topics.ts` (re-exports the above; the "All the numbers" rows grouped by topic, `TABLE_GROUPS`,
  `tableGroupFields`; the fields each page cites, `COMPARE_TOPIC_FIELDS` and `COMPARE_OVERVIEW_FIELDS`),
  `lib/compare-data.ts` (server-only: `loadComparison`, `requireComparison`, `loadCompareDetails`,
  `loadCompareHistories`, `compareMetadata`), `lib/compare-cards.ts` (the topic cards' rows, titles, footers),
  `lib/compare-insights.ts` (the comparative takeaways).
- `app/compare/page.tsx` (overview), `app/compare/{admissions,students,academics,cost,outcomes,history,table}/page.tsx`.
- `components/compare/`: `CompareHeader.tsx` (chips, add-school picker, the pills row), `CompareTopicPage.tsx` (the
  frame: Key differences opener, "On this page", source note, `BaselineNote`, `CompareTopicNav`), `CompareTopicNav.tsx`,
  `CompareMetric.tsx` (`card`/`row` variants), `ScoreCompare.tsx`, `CompareTable.tsx`, `DifferencesOnly.tsx`,
  `CompareTopicCards.tsx`, `CompareTopicCard.tsx`, `CompareCardRows.tsx`, `AdmissionFactorsGrid.tsx`,
  `CampusChips.tsx`, `RaceCompare.tsx`, `LgbtqPolicyTable.tsx`; `NetPriceCompare.tsx`, `ThenAndNow.tsx`, and
  `YourMajor.tsx` carried over unchanged onto their topic pages.
- `components/ui/pill-row.tsx` (the generalized pill row both the profile and Compare use);
  `components/profile/TopicPills.tsx` kept as a thin wrapper so the profile didn't change.
- `scripts/measure-profile.mts` + `scripts/lib/profile-measure.mts` (the `--compare` mode, `comparePagePath`,
  `compareHeightBudget`), `tests/profile-measure.test.mts`.
- `tests/compare-topics.test.mts`, `tests/compare-cards.test.mts`, `tests/compare-insights.test.mts`,
  `tests/helpers/compare-schools.mts` (fixture colleges shared by the cards and insights tests); the existing guard
  tests (`tests/reported-guards.test.mts`, `tests/cds-cost-and-debt.test.mts`, `tests/lgbtq.test.mts`,
  `tests/cds-academics.test.mts`) extended to scan the new `lib/compare-*.ts` modules and `app/compare/**`.
- `app/globals.css` (the `[data-differences-only="true"] tr[data-same]` rule); `lib/metrics.ts` imports now end in
  `.ts` so pure modules can import it under node; `lib/cds/compare-rows.ts` comment path fixed.
- Specs updated: [comparison.md](comparison.md) (becomes the as-built description), [mobile.md](mobile.md),
  [trends-design.md](trends-design.md) (Then & now and the 10-year direction table now live on `/compare/history`),
  [README.md](README.md), [backlog.md](backlog.md).

## Open questions
1. Should "Key differences" stay on the overview only, or should each topic page open with its own differences
   for that topic ("On cost: Ohio State costs $17.6K less…")? Recommendation: both; the per-topic list is the
   same function filtered by domain and makes a natural page opener.
   **Decided:** both, as recommended — each topic page opens with up to three `keyDifferences()` sentences
   filtered to `TOPIC_DIFF_METRICS[topic]` (none for academics, history, table).
2. Should the table page be the default for people who arrive from a data link? Recommendation: no; the overview
   is the default and the table is one pill away, with its anchors (`/compare/table?ids=#cost`) for deep links.
   **Decided:** no, as recommended — `/compare` is the default landing and every other page links to
   `/compare/table?ids=#{topic}` for its own rows.
3. Four colleges on a phone: the bar rows hold four, but the score ranges and race bars get tight. Recommendation:
   keep four and let those two blocks scroll sideways inside their cards, as the table does.
   **Decided:** kept four, as recommended — `ScoreCompare` and `RaceCompare` scroll sideways inside their own card
   rather than shrinking their bars illegibly thin.
