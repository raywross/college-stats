# School Profile

Routes: `/schools/[id]` (the overview) and six topic pages under it. The 50 most-applied-to overviews are
pre-rendered at build; the rest, and every topic page, render on first visit and are cached for a day. The bottom of
the drill-down.

> Phase 1 of the redesign ([profile-redesign.md](profile-redesign.md)) is built: the single long page is split into
> an overview plus topic pages, with the content moved as-is. Phase 2 (topic cards replacing the bento) and phase 3
> (tablet folding, the Over time segmented control) are still to come.

## Routes
| Route | Content |
|---|---|
| `/schools/{id}` | Hero, the at-a-glance tiles, "In detail" links to the topic pages, similar schools, the full sources list |
| `/schools/{id}/admissions` | Getting in: funnel, men and women, yield (+ strip), acceptance-rate strip, what they look at, the admissions map; then Test scores (`#scores`): `ScoreChecker`, who submitted, SAT-midpoint strip |
| `/schools/{id}/students` | Who's on campus: race & ethnicity (+ diversity strip), economic access (+ Pell strip), campus size, where they come from, transfers, who they are; then Campus life (`#campus`) |
| `/schools/{id}/academics` | Majors and faculty: popular majors, top-earning majors, students per faculty, faculty, spending and endowment |
| `/schools/{id}/cost` | What it costs: price calculator link, what students pay, price by family income, debt and payback, borrowing and repayment, who gets aid |
| `/schools/{id}/outcomes` | What it pays: earnings, staying and finishing, 8 years later, graduation by group, cost vs. earnings map |
| `/schools/{id}/history` | Over time: every chart group with the controls ([trends-design.md](trends-design.md)) |

The old "How it ranks" section dissolved: its four strips sit with the measures they describe (SAT midpoint on the
admissions page's test scores, yield under the yield ring, Pell under economic access, diversity under race &
ethnicity) and the admissions map moved to the admissions page. Old in-page anchors keep working: `AnchorRedirect` on
the overview sends `#admissions`, `#scores`, `#students`, `#campus`, `#academics`, `#cost`, and `#history` to the
routes in `ANCHOR_TOPICS` (`lib/profile-topics.ts`); `#overview`, `#ranks`, and `#similar` stay on the overview.

## Code
- `lib/profile-topics.ts` (pure): `PROFILE_TOPICS` (key, label, eyebrow, domain, description), `topicHref`,
  `overviewHref`, `adjacentTopics`, `ANCHOR_TOPICS`, and the fields each page shows: `OVERVIEW_FIELDS`,
  `TOPIC_FIELDS`, `PROFILE_FIELDS` (the union, for the overview's source list).
- `lib/profile-data.ts` (server): `loadProfile(id)` (React `cache`d: the dataset, school, history, detail, and the
  derived values and "has data" flags, plus `topics`, the pages this college has) and `requireTopic(id, key)`, which
  404s for an unknown college or a topic it has no data for (no acceptance rate and no counts → no admissions page;
  no history shard → no history page, and so on, the conditions that hid the sections before).
- `lib/profile-history.ts` (pure): `HISTORY_GROUPS`, `HISTORY_SERIES`, `BANDED` for the Over time charts.
- `lib/profile-cards.ts` (pure): what the overview cards say: `CARD_FOOTERS`, `CARD_TITLES`, `admissionsTitle`,
  `campusChips`, `middleBand`, `sinceLabel`, `tenYear`, `diversityValues` (`tests/profile-cards.test.mts`).
- `components/profile/`: `Panel` (section header: eyebrow, h1 or h2, takeaway, `HeadlineDelta`, `SourceExceptions`,
  and a `SourceNote` for h2 sections), `Block` (an h3 card with an id), `NotReported`, `SourceExceptions`,
  `CompactHeader` (the topic pages' sticky band: crest, name linking to the overview, city · type, Compare,
  `TopicPills`), `OnThisPage` (client scroll-spy of the page's blocks; a sticky side column from `lg`, a collapsible
  row above the content below it; jumps to a folded block's "Show …" button on phones), `TopicPage` (the frame:
  header, list, content, `SourceNote` for `TOPIC_FIELDS[topic]`, `TopicNav` previous/next), `TopicCards` and the six
  `*Card` components with `TopicCard`, `TenYearLine` (the overview), `AnchorRedirect`, `OverTimeSection` (everything
  `OverTime` is passed).
- Each topic page is a short server component with `generateMetadata` ("{School} · {Topic label}") and
  `revalidate = 86400`; no `generateStaticParams`.

## Overview
1. **Hero**, slim: tinted with the school's crest color. Breadcrumb (Explore › State › School), crest, name,
   location, type, size, test policy, setting, and designations as glossary `Term`s, the Compare button, and the
   "Known for" standout chips. The ten-year trend cards left the hero: each topic card carries its own ten-year line.
2. **`SourceExceptions`** for `OVERVIEW_FIELDS` ("Figures marked like this come from … Common Data Set").
3. **Topic cards** (`components/profile/TopicCards.tsx`): one card per page in `profile.topics`, two columns from
   `sm`, stacked on phones. The whole card is a link to its page (an overlay anchor; popovers, the calculator link,
   "Over time" links, and the swipeable chip row stay interactive above it), with a footer line naming what the page
   holds ("Getting in, in detail: funnel, what they look at, your scores →"). Shell: `TopicCard` with
   `CardHeadline`, `CardStats` (an auto-fit row), `CardStat` (a cited label over its figure); `TenYearLine` for the
   ten-year row (compact `Sparkline` from `sm`, the change, an "Over time" link to the history page); pure helpers in
   `lib/profile-cards.ts` (footers, titles, campus chips, the middle income band, the ten-year change text).
   Every figure is cited through `citeField`; a card omits any figure that is null and never shows it as 0.
   - **Admissions** (eyebrow with the admissions year from lineage): "1 in 27 applicants admitted" (`admitRatio`),
     `admissionsTakeaway`; acceptance ring + rate + selectivity tier, or "Not reported" with the open-admission term;
     applied, admitted, yield; SAT and ACT middle-50% compact `RangeBar`s with the median tick; ten-year line:
     applications (and the admit rate from → to).
   - **Students**: "Who's on campus", `studentsTakeaway`; undergrads with "larger than X% of colleges"; diversity
     index with a mini `StackedBar`, Pell share, first-generation share, each against the median; chips for setting,
     housing, athletics association and conference, ROTC, study abroad, undergraduate research (each cited; the row
     swipes on phones); ten-year line: diversity (falls back to undergrads).
   - **Academics**: "Majors and faculty", `academicsTakeaway`; students per faculty with its percentile (falls back to
     the most popular major); most popular major and its share (with the lineage year), top-earning major and its
     four-year earnings (`topEarningPrograms`), full-time faculty share, instruction spending per student; no ten-year
     line (the faculty series are short; the history card carries the headline trends).
   - **Cost** (eyebrow with the cost year from lineage): "What it costs", `costTakeaway`; average total cost with the
     national median comparison and the aid-generosity ring (falls back to the aided net price, then "Not reported");
     three bars for full price (in-state at publics), with grants, and the $48–75K income band; aid generosity tier,
     undergrads with a federal loan vs the median, the college's net price calculator (external); ten-year line:
     average cost with the indicator word ("Cost steady · +5% after inflation since 2013–14").
   - **Outcomes**: "What it pays", `outcomesTakeaway`; graduation ring with the national median (falls back to
     median earnings with its percentile); median earnings (10 years), median debt with the monthly payment,
     retention; ten-year line: graduation rate when the series exists.
   - **History** (eyebrow with the default window's start year): "How it's changed", `historyTakeaway`, and four
     tiles (cost, applications, selectivity, diversity): the indicator word and detail from `indicatorsOf`, a compact
     sparkline (money in end-year dollars), cited to `trends`; a tile with a series but no indicator shows from → to;
     with neither it is omitted.
4. **Similar schools**: nearest neighbors (`similarSchools`) with "why similar" chips and one-click compare links.
5. **Sources for this overview**: one collapsed `<details>` at every width wrapping the numbered `SourceList` for
   `PROFILE_FIELDS` (every field the whole profile shows); each number's (i) popover carries its own citation.

## Topic pages
A compact sticky header (`CompactHeader`) replaces the hero and the old section nav: Overview + one pill per topic the
college has, the current one filled, with domain color dots; it scrolls sideways on phones with the active pill in
view. The page opens with its `Panel` header (eyebrow, h1, the takeaway sentence from `lib/insights.ts`, the
`HeadlineDelta` "since" line where history exists, the non-default-source notice), then today's blocks in the order
above, the page's `SourceNote`, and previous/next links. Sub-sections that were their own sections (Test scores,
Campus life) are h2 `Panel`s within their page, with their old ids.

## Insight helpers (`lib/insights.ts`)
- `standouts(s)`: "Known for" chips from percentile thresholds (ultra-selective, high yield, big campus,
  economic diversity, test-optional heavy…).
- `admissionsTakeaway`, `yieldTakeaway`, `scoresTakeaway`, `studentsTakeaway`, `campusTakeaway`,
  `academicsTakeaway`, `costTakeaway`, `outcomesTakeaway`: one-line plain-English summaries, used by the cards
  and as the topic pages' openers.
- `historyTakeaway(history, files)`: the "Over time" summary (full price vs what students paid, after inflation;
  applications and acceptance rate). `movedBy(change)` phrases a change ("rose 12%", "held about steady").
- `similarSchools(s, n)`: Euclidean distance on percentile ranks (selectivity, SAT, size, Pell, diversity),
  with a small penalty when the school type differs.

All comparisons are national: against every 4-year college that reports the measure (see the `percentile-rank` term).

## Missing data
Pages render only when their data exists; the pills, the overview's links, and previous/next list only those pages,
and a direct visit to a missing one is a 404:
- No acceptance rate → the admissions card says "Not reported" with an **open admission** term; no admissions page
  unless counts exist.
- No SAT/ACT → the Test scores section is left off the admissions page (test-blind schools like UC show their policy
  in the hero instead).
- No cost or outcome figures → no cost page; no earnings, graduation, 8-year outcomes, or graduation by group → no
  outcomes page. No history shard → no history page.
- The "1 in N" phrasing switches to "N in 10" at 50%+ (`admitRatio`).
- A sources line closes every page, and the overview's numbered list covers every field the profile shows
  (`PROFILE_FIELDS`); `tests/profile-topics.test.mts` checks that the pages together still show every field the
  single page showed.
