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
- `components/profile/`: `Panel` (section header: eyebrow, h1 or h2, takeaway, `HeadlineDelta`, `SourceExceptions`,
  and a `SourceNote` for h2 sections), `Block` (an h3 card with an id), `NotReported`, `Tile`, `SourceExceptions`,
  `CompactHeader` (the topic pages' sticky band: crest, name linking to the overview, city · type, Compare,
  `TopicPills`), `OnThisPage` (client scroll-spy of the page's blocks; a sticky side column from `lg`, a collapsible
  row above the content below it; jumps to a folded block's "Show …" button on phones), `TopicPage` (the frame:
  header, list, content, `SourceNote` for `TOPIC_FIELDS[topic]`, `TopicNav` previous/next), `TopicLinks` (the
  overview's interim links), `AnchorRedirect`, `OverTimeSection` (everything `OverTime` is passed).
- Each topic page is a short server component with `generateMetadata` ("{School} · {Topic label}") and
  `revalidate = 86400`; no `generateStaticParams`.

## Overview
1. **Hero**: tinted with the school's crest color. Breadcrumb (Explore › State › School), large crest,
   name, location, type and size (as glossary `Term`s), compare button, "Known for" standout chips, and "Over 10 years":
   four trend indicator cards (cost, applications, diversity, selectivity) linking to the history page
   ([trend-indicators.md](trend-indicators.md)).
2. **At-a-glance tiles**: acceptance ring + "1 in N" + tier; SAT and ACT middle-50% mini range bars (with
   median tick); undergrads with rank; student-to-faculty ratio; yield ring; Pell ring; diversity index with mini
   stacked bar; average cost; the "10 years" tile (links to the history page); aid generosity; median earnings;
   graduation rate. Closed by its `SourceNote` (`OVERVIEW_FIELDS`).
3. **In detail**: one link per topic page the college has (`TopicLinks`; the redesign's cards replace it).
4. **Similar schools**: nearest neighbors (`similarSchools`) with "why similar" chips and one-click compare links,
   then the full numbered sources list (`SourceList`, `PROFILE_FIELDS`), folded on phones.

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
- `admissionsTakeaway`, `yieldTakeaway`, `scoresTakeaway`, `studentsTakeaway`, `campusTakeaway`, `costTakeaway`,
  `outcomesTakeaway`: one-line plain-English summaries.
- `historyTakeaway(history, files)`: the "Over time" summary (full price vs what students paid, after inflation;
  applications and acceptance rate). `movedBy(change)` phrases a change ("rose 12%", "held about steady").
- `similarSchools(s, n)`: Euclidean distance on percentile ranks (selectivity, SAT, size, Pell, diversity),
  with a small penalty when the school type differs.

All comparisons are national: against every 4-year college that reports the measure (see the `percentile-rank` term).

## Missing data
Pages render only when their data exists; the pills, the overview's links, and previous/next list only those pages,
and a direct visit to a missing one is a 404:
- No acceptance rate → the tile says "Not reported" with an **open admission** term; no admissions page unless
  counts exist.
- No SAT/ACT → the Test scores section is left off the admissions page (test-blind schools like UC show their policy
  in the hero instead).
- No cost or outcome figures → no cost page; no earnings, graduation, 8-year outcomes, or graduation by group → no
  outcomes page. No history shard → no history page.
- The "1 in N" phrasing switches to "N in 10" at 50%+ (`admitRatio`).
- A sources line closes every page, and the overview's numbered list covers every field the profile shows
  (`PROFILE_FIELDS`); `tests/profile-topics.test.mts` checks that the pages together still show every field the
  single page showed.
