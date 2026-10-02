# Profile Redesign: Overview Cards and Topic Pages

> Status: **planned**, in progress: phase 1 (routes and moves) built 2026-10-02, see [school-profile.md](school-profile.md)
> for the as-built pages; phases 2–4 under way. Decided 2026-10-02 after a review of the profile at three widths and research
> into comparable sites. Replaces the single long page with a short overview of topic cards and one page per topic.

## Why
The profile has grown with every data wave. It began as six sections and is now ten, each with sub-blocks that
were added one PR at a time. Measured on 2026-10-02 after wave 3 merged (Harvard; Ohio State is within 5%):

| Width | Page height | Screens | Longest sections |
|---|---|---|---|
| Desktop 1440 | 23,285px | ~26 | Over time 7,561 · Cost & outcomes 4,330 · Academics 1,965 |
| Tablet 810 (iPad) | 33,033px | ~31 | Over time 12,403 · Cost & outcomes 6,519 · Academics 2,184 |
| Phone 390 | 19,061px | ~23 | Cost & outcomes 4,797 · Academics 2,642 · Students 2,582 |

395 SVG charts render on one page. What the review found, section by section:
- **The overview answers the main questions well** (acceptance, scores, size, cost, earnings, graduation) in
  thirteen tiles, but every one of those numbers appears again further down, so the page starts by repeating itself.
- **The section nav has ten items** and overflows the viewport even at 1440px ("Sim…" is cut off). On a phone it is
  a swipeable row that most people never scroll.
- **Cost & outcomes is three topics in one section**: what students pay, who gets aid, and what happens after
  (earnings, graduation, 8-year outcomes, graduation by group, the cost-vs-earnings map). Fourteen blocks, 4,330px.
- **Over time is a chart dump**: 24 charts in six groups, every one full size, 7,561px on desktop. On phones the
  groups fold and it is 750px; on tablets nothing folds because folding only happens below 640px, so a tablet gets
  the longest page of all. Ten-year history also shows up in four places: the hero's four trend cards, the "10 years"
  tile, "Over time" links under section takeaways, and the section itself.
- **Academics doubled with wave 3** (merged the same day, [majors.md](data-expansion/majors.md)): the most popular
  majors list with its search and "show all programs", the fastest-growing field, and the top-earning majors with
  expandable earnings rows now sit under the faculty figures. It is the right content for a topic page and the wrong
  amount for a section of one.
- **Several desktop blocks are mostly empty space**: the 100-applicant waffle for a 3.6% admit rate is a 450px
  panel with four colored squares; Admissions' right column is three stacked cards next to it.
- **Tablets get the desktop content in one column.** The 2-column grids collapse at 810px but nothing is folded or
  reflowed, so the tablet page is 42% taller than desktop.
- **Sources lines close every section** (seven of them, three lines each on phones). They matter, but as the last
  thing in every section they add length without adding orientation.
- What works and must survive: the hero, "Known for" chips, the takeaway sentence that opens each section, the
  (i) citations on every number, `ScoreChecker`, the distribution strips ("more selective than 100% of 1,546"),
  the compare button, and the similar-schools rail.

## Research (2026-10-02)
Comparable sites, fetched or from the earlier [design research](design-research.md):

| Site | Structure | Takeaway |
|---|---|---|
| **BigFuture** (College Board) | Five tabs: Overview, Admissions, Academics, Costs, Campus Life. The overview is a quick-facts panel (type, size, setting, cost after aid, SAT range, graduation rate) plus description, deadlines, contacts | Few tabs, each a real page; the overview is facts, not charts |
| **CollegeVine** | Five tabs (Overview, Cost & scholarships, Majors, Admissions, Essay prompt). The overview is a summary strip (admit rate, undergrads, type, setting) followed by one short block per topic and similar schools | Overview = one block per topic, each a preview of its tab |
| **Appily** (Cappex) | Eight tabs (Overview, Virtual tour, Tuition/Cost/Aid, Admissions, Academics, Campus Life, After Graduation, Reviews). The cost tab has three collapsed sub-sections; admissions has five | Tabs plus collapsed sub-sections inside; too many tabs to scan |
| **Niche** | A report card of letter-grade tiles (Academics, Value, Diversity…) that each link to a sub-page (`/admissions/`, `/cost/`, `/academics/`); the overview shows two or three facts per topic with "Read more" | The clearest hub-and-spoke: short overview, deep sub-pages, grades as the hook (we don't grade) |
| **US News** | Overview page with key facts per topic and "read more"; sub-pages for Rankings, Applying, Academics, Student Life, Tuition & Aid, Campus Info | Same hub-and-spoke, sub-pages behind a paywall |
| **College Scorecard** | One page, six sections, each a few headline numbers with national-median bars and expandable detail | One page works because each section stays small |
| **Zillow / Redfin** (K) | Facts strip, then sections (price history, schools, facts & features) with "Show more"; on phones a tap opens a full-screen sheet | Summary first; detail on demand; full-screen on phones |

Usability research:
- **Tabs** suit content people consume one group at a time; they hurt when people need to compare across tabs, and
  tab rows that overflow lose discoverability ([NN/g, Tabs used right](https://www.nngroup.com/articles/tabs-used-right/)).
- **Accordions on desktop** add a decision per heading and hide content people would have read; they help on
  phones and when people want one specific item ([NN/g, Accordions for complex content](https://www.nngroup.com/articles/accordions-complex-content/)).
- **Progressive disclosure**: put what most people need up front; designs with more than two levels of disclosure
  lose people ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).
- **In-page links** help on long pages, and the help grows as screens shrink; when people need only a few of the
  page's topics, split it into pages ([NN/g, In-page links](https://www.nngroup.com/articles/in-page-links/)).
- **Cards** suit heterogeneous content but scan worse than lists; make the whole card the link
  ([NN/g, Cards](https://www.nngroup.com/articles/cards-component/)). **Overlays** interrupt and are worse on small
  screens ([NN/g, Overlay overload](https://www.nngroup.com/articles/overlay-overload/)).
- **Mobile sub-navigation**: under six items, a simple row or accordion; 6–15, a section menu
  ([NN/g, Mobile subnavigation](https://www.nngroup.com/articles/mobile-subnavigation/)).

## Proposals
Four ways to reorganize the same content. Every proposal keeps the hero, the takeaways, the charts, citations, and
the similar-schools rail; they differ in where the detail lives and how people reach it.

**A. Tabs on one route.** The section nav becomes a tab bar: Overview, Admissions, Students, Academics, Cost & aid,
Outcomes, Over time. One tab shows at a time; the URL carries `?tab=`. Like BigFuture and Appily.

**B. Overview cards and topic pages (hub and spoke).** `/schools/{id}` becomes a short overview: the hero, then one
card per topic showing that topic's three to five most useful numbers, one small chart, and its takeaway, each card
linking to `/schools/{id}/{topic}`. Topic pages hold today's full sections, split so that no page is longer than a
few screens, with a row of topic pills for moving sideways. Like Niche and US News.

**C. One page, re-chunked.** Keep the single page and the scroll-spy nav, but merge to seven sections, show only
each section's headline block by default, and put the rest behind "Show details" expanders on every width (today
they exist only on phones). Over time becomes a sparkline per section plus one expander.

**D. Overview cards with detail panels.** The overview from B, but a card opens its detail as a side panel on
desktop and a full-screen sheet on phones, addressed by URL (Next.js intercepting routes), so a direct visit to
`/schools/{id}/cost` renders the full page while in-site clicks keep the overview underneath.

### Scoring
Each criterion scored 1–5, weighted by how much it matters for this site.

| Criterion (weight) | A Tabs | B Cards + pages | C Re-chunked | D Cards + panels |
|---|---|---|---|---|
| First screen answers "is this college for me?" (25) | 3 | 5 | 3 | 5 |
| Depth kept and findable (20) | 4 | 4 | 5 | 4 |
| Phone experience (15) | 2 | 5 | 3 | 4 |
| Tablet works like desktop with small tweaks (10) | 4 | 4 | 3 | 3 |
| Related numbers visible together (10) | 2 | 3 | 5 | 4 |
| Deep links, sharing, and search engines (10) | 4 | 5 | 3 | 4 |
| Build cost and fit with existing code (10) | 3 | 3 | 4 | 2 |
| **Weighted score (out of 5)** | **3.15** | **4.30** | **3.70** | **3.95** |

Notes behind the scores:
- A's tab row has seven items on a phone and hides everything but one topic, which is the accordion problem
  turned sideways; the Cost tab would still be 4,000px.
- C keeps everything on one page, which NN/g favors for people who read it all, but the review shows the opposite
  use: a visitor wants two or three topics. Seven expanders per visit on desktop is a cost, and the page would still
  be 8,000px with everything closed on a tablet.
- D scores close to B but adds intercepting routes, charts measuring inside animated panels, focus management, and
  an overlay on a site that has none. It can be added later on top of B if click-through feels heavy; nothing in B
  blocks it.
- **B wins.** It makes the first screen the answer, gives every topic a real URL, keeps today's section code (the
  topic pages are the current `Panel`s moved into routes), and phones get the simplest model: a card, a tap, a page,
  back.

## Before and after
The "before" images are the live site on 2026-10-02. The "after" images are a static mockup built with the site's
type, colors, and Harvard's real figures to show the shape of the design; the built version will differ in detail.

![Harvard's profile today and the overview mockup, whole pages at the same scale](/roadmap/profile-redesign/desktop-length.jpg)
*Whole pages at the same scale, desktop: 23,285px today against about 2,300px for the overview. The detail moves to
topic pages rather than disappearing.*

![First screen on desktop, today and in the mockup](/roadmap/profile-redesign/desktop-fold.jpg)
*The first screen on a desktop. Today: hero, trend cards, section nav, and the start of thirteen tiles. After: a
slimmer hero and the first two topic cards, each with its headline figure, supporting numbers, and takeaway.*

![The overview mockup on desktop](/roadmap/profile-redesign/after-overview-desktop.png)
*The overview mockup at full size. Six cards, one per topic page, then similar schools and one sources line.*

![A topic page mockup: Getting in](/roadmap/profile-redesign/after-topic-page-desktop.png)
*A topic page ("Getting in"): a compact sticky header with the topic pills replaces the hero, an "On this page"
list replaces the ten-item section nav, and today's admissions and test-score blocks follow in full.*

![The overview on a phone, today and in the mockup](/roadmap/profile-redesign/phone.jpg)
*On a phone: today's first screen and 19,061px page; the mockup's first screen; and the whole mockup overview, about
3,800px, where each card is a tap to its topic page.*

## Design: overview cards and topic pages

### Routes
| Route | Content | Rendering |
|---|---|---|
| `/schools/{id}` | Overview: hero, topic cards, similar schools, sources | Top 50 prerendered, the rest on first visit (as today) |
| `/schools/{id}/admissions` | Getting in, test scores, what they look at | On demand, daily revalidation |
| `/schools/{id}/students` | Who's on campus, campus life (housing, sports, programs, services) | same |
| `/schools/{id}/academics` | Majors and faculty: most popular majors with search, the fastest-growing field, top-earning majors ([majors.md](data-expansion/majors.md), [field-of-study.md](data-expansion/field-of-study.md)), student to faculty ratio, faculty, spending | same |
| `/schools/{id}/cost` | What students pay, aid, borrowing | same |
| `/schools/{id}/outcomes` | Earnings, staying and finishing, 8-year outcomes, graduation by group, cost vs earnings map | same |
| `/schools/{id}/history` | Over time: every chart group, with the controls | same |

Six topic pages plus the overview, not ten sections: Test scores joins Admissions; Campus life joins Students; "How it ranks" dissolves (its four
strips move into the cards and pages they describe; the two scatter maps go to Admissions and Outcomes); Cost &
outcomes splits in two. Old anchors keep working: a small client script on the overview maps `#scores`, `#campus`,
`#cost`, `#history`, `#ranks` to the new routes, and the sticky section nav is retired from the overview.

### Overview page
1. **Hero**, slimmer: crest, name, location, the glossary terms, Compare (and later Add to list and Follow:
   [saved-lists.md](product/saved-lists.md), [follow-colleges.md](product/follow-colleges.md)), "Known for" chips.
   The four trend cards leave the hero; each topic card carries its own ten-year line instead.
2. **Topic cards**, one per topic page above, in a 2-column grid on desktop and tablet, stacked on phones. A card is:
   - eyebrow with the domain color dot and the topic name, the takeaway sentence from `lib/insights.ts`;
   - a **headline figure** (the one number people quote: acceptance rate ring, SAT range bar, undergrads, student
     to faculty ratio, average cost, graduation rate) with its percentile line ("larger than 85% of colleges");
   - **two to four supporting figures** in a compact row (Admissions: applied, admitted, yield; Students: diversity
     bar, Pell, setting; Academics: the most popular major and its share, the top-earning major, faculty full-time
     share; Cost: aid generosity, net price for the middle income band; Outcomes: median earnings, median debt,
     retention);
   - a **ten-year line** where history exists ("Applications +57% since fall 2014"), replacing the hero trend cards
     and the "10 years" tile;
   - a footer link, the whole card clickable: "Getting in, in detail →".
   The Over time card is different: the history takeaway and four sparklines (cost, applications, acceptance rate,
   diversity) with the trend words. Cards render only when their data exists, as sections do today.
3. **Similar schools** rail, unchanged.
4. **Sources** for the overview: one `SourceList` for every field the cards show, collapsed under "Sources for this
   overview", so every number stays cited (its (i) popover) without seven source lines on the page.

Budget: the overview is at most **3 screens on desktop (~2,700px) and 6 on a phone (~5,000px)**. The pilot measures
it; a Playwright script in `scripts/measure-profile.mts` prints the heights at 1440, 810, and 390 so a later PR can't
quietly grow it back.

### Topic pages
- **Header**: a compact sticky band with crest, name, Compare, and a row of seven topic pills (the current topic
  filled) that scrolls sideways on phones. It replaces both the hero and the section nav on these pages, so a topic
  page starts with its content.
- **Content**: today's `Panel`s and sub-blocks, moved, with an "On this page" list of the H3 sub-sections (the
  scroll-spy `SectionNav` reused for sub-sections, since each page now has three to six). Order within each page
  puts the headline block first, as the phone folding does today.
- **Folding** (`ShowMore`) applies **below `lg` (1024px)**, not `sm`, on the Over time and Outcomes pages, so tablets
  fold the way phones do. Desktop stays unfolded, in keeping with the accordion research.
- **Over time** gets a different layout rather than a fold: the six groups become a segmented control (Cost · Aid ·
  Admissions · Scores · Students · Academics · Outcomes) with one group's charts shown at a time, each group one or
  two screens. The segment is in the URL (`?group=cost`) so links from the cards land on the right group.
- Sources close each page as they do today; the `fields` lists move with the panels, so
  `tests/citation-guards.test.mts` keeps enforcing that nothing is uncited.
- Previous/next topic links at the bottom; the bottom tab bar on phones is unchanged.

### Phones, tablets, desktop
| Width | Overview | Topic pages |
|---|---|---|
| Phone (< 640) | Cards stacked, each under one screen; a tap opens the topic page (no sheets, no overlays); Back returns to the card | Current phone treatment: headline block first, deep dives behind "Show …"; topic pills scroll sideways |
| Tablet (640–1024) | Two-column card grid, same as desktop with narrower cards; the hero's chip row wraps instead of scrolling | Same as desktop, but `ShowMore` folds apply (the fix for the 31,000px tablet page) and chart grids are 2-wide, not 3 |
| Desktop (1024+) | Two columns of cards, hero spotlight as today | Full content, "On this page" list sticky in a side column |

### What gets simpler
- Ten-year history appears in one place on the overview (each card's line and the Over time card) and one page.
- The waffle's empty-space problem goes away: the Admissions page shows it after the funnel at every width.
- The section nav's ten overflowing items become seven pills and a card grid.
- `app/schools/[id]/page.tsx` (1,447 lines) becomes a layout plus seven short route files and a `components/profile/`
  folder for the cards; each topic page imports the components the current page already has.

### Measurement
`profile_card_opened` (topic, from: `card` / `pill` / `anchor`) and `profile_section_viewed` renamed to carry the
route, in the typed registry ([telemetry.md](product/telemetry.md#event-registry)). Success: a shorter time to the
first card click, more topic pages per visit than sections scrolled today, and no drop in Compare use from profiles.

## Build order
1. **Routes and moves** (no visual change yet): the six topic pages built from the existing `Panel`s; the overview
   keeps the current bento while cards are built; old anchors redirected; `measure-profile` script.
   *Built 2026-10-02* (`feature/profile-routes`): `lib/profile-topics.ts`, `lib/profile-data.ts`,
   `lib/profile-history.ts`, `components/profile/*`, the six route files, `tests/profile-topics.test.mts` (route and
   field coverage against the old `SECTION_FIELDS`, anchors). Deviations: no `layout.tsx` (the `React.cache`d
   `loadProfile` already shares one load between a page and its metadata, and the overview renders the hero while
   topic pages render the compact header, so a layout had nothing to hold); the overview carries an interim "In
   detail" link list until the cards land; "How it ranks" dissolved into the pages (SAT midpoint on the admissions
   page's test scores, yield under the yield ring, Pell and diversity on the students page); `ShowMore` gained
   `until="lg"` but phase 3 applies it; the `measure-profile` script is not written yet.
2. **Cards**: the six topic cards, the slimmer hero, the overview source list; remove the bento and section nav.
3. **Tablet and Over time**: `ShowMore` at `lg`, the Over time segmented control, chart grids per width.
4. **Pilot**: Harvard, Ohio State, UCLA, a small test-blind college, and an open-admission college at three widths;
   compare heights against the budget; check every field in the old `SECTION_FIELDS` is still shown on some page
   (a test diffs the two sets).

## Files (planned)
- `app/schools/[id]/layout.tsx` (loads the school once; hero or compact header by route), `page.tsx` (overview),
  `admissions/page.tsx`, `students/page.tsx`, `academics/page.tsx`, `cost/page.tsx`, `outcomes/page.tsx`,
  `history/page.tsx`.
- `components/profile/TopicCard.tsx`, `AdmissionsCard.tsx` … `HistoryCard.tsx`, `TopicPills.tsx`,
  `CompactHeader.tsx`, `OnThisPage.tsx`; `lib/profile-topics.ts` (the six topics, their routes, labels, domain
  colors, and the fields each shows, for the nav, the cards, and the coverage test).
- `scripts/measure-profile.mts` (Playwright heights at three widths), `tests/profile-topics.test.mts` (every topic
  has a route and a card, field coverage equals the old page, anchors map to routes).
- Specs to update when built: [school-profile.md](school-profile.md) (becomes the as-built description),
  [mobile.md](mobile.md#profile-on-phones), [trends-design.md](trends-design.md).

## Open questions
1. Should the overview keep a slim "key numbers" strip above the cards (six figures in one row) for people who
   only want the numbers? Recommendation: no at first; the headline figure on each card is that strip, laid out in
   a grid. Revisit with telemetry if people scroll past the cards.
2. Should topic pages be prerendered for the top 50 colleges like the overview? Recommendation: only the overview;
   topic pages render on first visit and stay cached a day, which keeps the build at its current size.
3. Detail panels (proposal D) as a later enhancement on desktop? Decide after the pilot, from how often people
   open more than two topics in a visit.
