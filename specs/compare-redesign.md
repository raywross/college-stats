# Compare Redesign: Overview Cards and a Page per Topic

> Status: **planned** (not built). Decided 2026-10-02, the day the profile redesign shipped
> ([profile-redesign.md](profile-redesign.md)): the same review, the same four kinds of proposal, and the same
> winner, so a comparison reads like the profiles it is built from. Replaces the single page in
> [comparison.md](comparison.md).

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
2. **Cards**: the six compare topic cards and the comparative takeaways; the overview shrinks to header,
   differences, radar, cards, table link.
3. **Pilot**: two, three, and four colleges, including one that reports little (an open-admission college with no
   scores), at three widths with the measurement script; a test that the union of the pages' table rows equals
   today's `TABLE_ROWS`.

## Files (planned)
- `app/compare/page.tsx` (overview), `app/compare/{admissions,students,academics,cost,outcomes,history,table}/page.tsx`,
  `components/compare/CompareHeader.tsx` (pills row), `CompareTopicCard.tsx`, `CompareTopicCards.tsx`,
  `CompareTopicPage.tsx` (the frame), `DifferencesOnly.tsx` (the table switch, client),
  `lib/compare-topics.ts` (topics, routes, the table rows by topic, fields per page), `lib/compare-insights.ts`
  (comparative takeaways), `tests/compare-topics.test.mts`.
- Specs to update when built: [comparison.md](comparison.md) (becomes the as-built description),
  [mobile.md](mobile.md), [trends-design.md](trends-design.md) (Then & now moves to the history page).

## Open questions
1. Should "Key differences" stay on the overview only, or should each topic page open with its own differences
   for that topic ("On cost: Ohio State costs $17.6K less…")? Recommendation: both; the per-topic list is the
   same function filtered by domain and makes a natural page opener.
2. Should the table page be the default for people who arrive from a data link? Recommendation: no; the overview
   is the default and the table is one pill away, with its anchors (`/compare/table?ids=#cost`) for deep links.
3. Four colleges on a phone: the bar rows hold four, but the score ranges and race bars get tight. Recommendation:
   keep four and let those two blocks scroll sideways inside their cards, as the table does.
