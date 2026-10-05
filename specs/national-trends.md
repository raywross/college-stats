# National Trends: How College Is Changing

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Opened 2026-09-29 with one study. Expanded 2026-10-03 into a family of specs: this
> hub (the shared method, groups, routes, and computation), five more studies, top-10 lists, and pages by athletic
> conference and by state, each in [specs/trends/](trends/). Uses the year-by-year history already on the site
> ([how history is built](trends-data.md)). First-look numbers below and in the study specs were computed 2026-10-03
> from the committed history (fall 2024 / 2023–24 / entering 2018 are the newest points).

## The family of specs
| Spec | What readers get | Depends on |
|---|---|---|
| This hub | The `/trends` page, the study template, the standard groups, the shared computation (`studies.json`) and tests | history (built) |
| [Top-10 lists](trends/top-10-lists.md) | "Biggest movers": ten colleges per measure, with the floors and exclusions that keep the lists honest | this hub |
| [By athletic conference](trends/conferences.md) | A page per conference: members, medians over time, realignment timeline, Power 4 side by side | this hub |
| [By state](trends/states.md) | A page per state: how its colleges changed, public flagships, where students come from | this hub |
| [Study 2: Test-optional](trends/test-optional.md) | Who still requires tests, who submits scores, and what happened to score ranges | this hub |
| [Study 3: Shrinking colleges](trends/shrinking-colleges.md) | Half of colleges are 10% smaller than ten years ago; who grew | this hub |
| [Study 4: The price gap](trends/price-gap.md) | Full price vs what students pay, by group: who is discounting | this hub |
| [Study 5: Out-of-state students](trends/out-of-state.md) | Public colleges enrolling more first-years from other states | this hub |
| [Study 6: The Pell graduation gap](trends/pell-gap.md) | Pell recipients graduate less often, and the gap widened | this hub |
| [Study 7: Where the students went](trends/where-students-go.md) (planned 2026-10-05) | The students view: each kind of college's share of all undergraduates then and now, by size, research tier, public or private, region and state, selectivity, and price | this hub; [online share](data-expansion/online-share.md) for the campus-based panel (the movers' lists stand in until then) |

Study 1 (men and women in admissions) stays in this file as the worked example of the template.

## Why
Every page on the site so far answers a question about **one college**: what it costs, who gets in, how that changed.
Many of the most interesting questions are about **the whole landscape**: *Is it getting harder to get in everywhere, or
only at a few colleges? Are men and women treated differently in admissions, and is that changing? Is it a regional
story, a public-versus-private story, or a small-college story?*

The site already has the data to answer these: 20+ years of federal history for about 1,900 four-year colleges. This spec
sets out how a **trend study** works, where studies appear on the site, and the rules that keep them honest. Each study
is a small, self-contained section below. New ideas get added as new studies.

## What a study is
One question about the landscape, answered in the same shape every time:

| Part | What it is |
|---|---|
| **The question** | Plain language, e.g. "Are colleges admitting men and women at different rates, and is it changing?" |
| **The national picture** | One number and one line over time, across all colleges that report the measure |
| **Breakdowns** | The same measure split by the site's standard groups (below), so readers can see *where* a change is happening |
| **Takeaway** | Two or three sentences a reader can repeat, with the caveats that matter |
| **Method note** | Which colleges, which years, weighted or not, and why |
| **Links** | To Explore, sorted or filtered to the colleges driving the pattern |

### Standard breakdowns
Every study offers the same four, so readers learn one way of reading them:

| Breakdown | Groups | Notes |
|---|---|---|
| **Region** | Northeast, Southeast, Midwest, Southwest, West | The site's regions (`location.region`). Territories are shown only when 30+ colleges report. |
| **Public or private** | Public, private nonprofit | Private for-profit only when 30+ report (rarely). |
| **Size** | Under 2,000 · 2,000–9,999 · 10,000+ undergraduates | |
| **Selectivity** | Under 25% admitted · 25–59% · 60% or more | Only for admissions studies, and only for colleges that report a rate. |

A study can add its own grouping when the question needs it (for example, test policy for a testing study).

### Additional groupings (added 2026-10-03)
The snapshot now carries more ways to slice colleges, all built in data waves 2–3. A study offers one or two of these
only when they change the story; the four standard breakdowns always come first. Counts are today's dataset (1,893
colleges) and show which groups clear the 30-college floor.

| Grouping | Groups (colleges) | Source field | Where it earns its place |
|---|---|---|---|
| **Setting** | City 973 · Suburb 456 · Town 316 · Rural 148 | `campus.setting.group` (IPEDS HD locale) | Enrollment: town and rural colleges shrank most (Study 3) |
| **Athletic division** | D-I FBS 136 · D-I FCS 127 · D-I other 99 · D-II 289 · D-III 415 · none/NAIA 827 | `campus.athletics.division` | Enrollment, out-of-state, price: FBS colleges move with the big publics; D-III with small privates |
| **Research tier** | R1 183 · R2 129 · RCU 191 · other 1,390 | `campus.carnegie.research` (Carnegie 2025) | Admissions and enrollment: R1s grew while the median college shrank |
| **Designation** | HBCU 84 · HSI 281 · Land-grant 82 · Women's 30 · Men's 45 · AANAPISI 110 | `campus.designations`, `campus.msi` | Applications: HBCU applications rose 77% at the median since fall 2014 while enrollment fell 12% |
| **Athletic conference** | 131 conferences; 107 have 8+ members | `campus.athletics.conference` (+ history series `conference` since 2014–15) | Its own pages ([conferences.md](trends/conferences.md)), never a study breakdown: too many groups |
| **State** | 54 states and territories; 23 have 30+ colleges, 45 have 10+ | `location.state` | Its own pages ([states.md](trends/states.md)); the 30-college rule relaxes to 10 there, labeled |

Groups with fewer than 30 colleges in a study's panel (Women's colleges, usually; Men's, the Tribal college) show "too
few colleges to say", as the rules require. A study never invents a group that isn't a stored field.

## Rules
1. **Fixed panel for "then vs now."** Compare the same colleges at both ends, so a change isn't just colleges entering or
   leaving the data. The panel and its size are always stated.
2. **Say whether it's colleges or students.** "Share of colleges" (each college counts once) answers "how common is
   this?"; enrollment-weighted figures answer "how many students does this affect?" Each study picks one per chart and
   labels it.
3. **Groups use today's classification** unless the study says otherwise (a college that grew past 10,000 counts as
   10,000+ throughout). The method note says so, because it can matter.
4. **At least 30 colleges per group**, or the group shows "too few colleges to say."
5. **Patterns, not causes.** Breakdowns show *where* something changed, not *why*. "Drivers" means "where the change is
   concentrated," and the copy never implies a cause the data can't show.
6. **Definition changes break the line** (the SAT redesign in fall 2017, and the pandemic shading), as on college pages.
7. **Every number is cited** with its source and years, like the rest of the site ([data lineage](data-lineage.md)).
   The universe is the site's four-year colleges, not all of U.S. higher education, and the page says so.
8. **Precomputed and checked.** Studies are computed by `npm run sync-history` (like the Home facts in
   `data/history/facts.json`), so pages stay static, and a test recomputes each one from the committed history.

## Where it appears
- **A new "Trends" page** (`/trends`), linked from the footer, the phone's More menu, and Home's "What's changed"
  band ("All trends"). The header keeps its four main tasks; whether Trends earns a fifth slot is an open question
  below. Sections, top to bottom: the studies (one card each: headline number, sparkline, one sentence, newest first),
  then **Biggest movers** (three of the top-10 lists, with a link to all), then **By conference** and **By state**
  entry cards (the Power 4 strip and the state tile map, each linking to its index).
- **Study pages** (`/trends/{study}`): the national chart, a small chart per breakdown group side by side (same scale,
  so they compare at a glance), the takeaway, and the method note. Slugs are the study spec's file name
  (`/trends/test-optional`, `/trends/shrinking-colleges`, `/trends/price-gap`, `/trends/out-of-state`,
  `/trends/pell-gap`, and `/trends/men-and-women` for Study 1).
- **Lists and group pages**, specified separately: `/trends/movers` ([top-10 lists](trends/top-10-lists.md)),
  `/trends/conferences` and `/trends/conferences/{slug}` ([conferences](trends/conferences.md)), `/trends/states` and
  `/trends/states/{state}` ([states](trends/states.md)).
- **Home "What's changed"** can feature one study's headline number when it's striking, linking to the study.
- **College pages** can link to a relevant study ("How does this compare nationally?") where the college's own chart
  sits, e.g. the "Acceptance rate, men and women" chart links to Study 1.

## Studies

### Study 1: Men and women in admissions
**Question.** Are colleges admitting men and women at different rates, and is that changing? Where is the change
concentrated: particular regions, public or private colleges, small or large, more or less selective?

**Why it's interesting.** Nationally, women make up most undergraduates, and at most colleges women are admitted at a
higher rate than men. The share of colleges admitting *men* at a notably higher rate has halved in 20 years, and the
change isn't spread evenly.

**Data.** Acceptance rates by sex from the IPEDS admissions survey, fall 2001 on (history series `admit_rate_men` and
`admit_rate_women`; see the [admissions detail spec](data-expansion/admissions-detail.md)). "Notably higher" means a gap of
3 or more percentage points, the same bar the college pages use.

**First look (computed 2026-09-29).** Fixed panel: 912 colleges reporting both rates, with 1,000+ applicants, in fall 2004
and fall 2024. Groups by today's region, type, size, and selectivity. Share of colleges, not students.

| Group | Colleges | Admit men 3+ pts higher | Admit women 3+ pts higher | Median gap, men − women (pts) |
|---|---|---|---|---|
| **All** | 912 | 13% → 6% | 43% → 48% | −2.3 → −2.8 |
| Northeast | 289 | 17% → 5% | 41% → 56% | −2.2 → −3.5 |
| Southeast | 223 | 16% → 7% | 33% → 42% | −1.0 → −2.2 |
| Midwest | 221 | 10% → 5% | 53% → 53% | −3.2 → −3.4 |
| West | 113 | 4% → 6% | 54% → 39% | −3.3 → −1.9 |
| Southwest | 51 | 14% → 4% | 43% → 45% | −2.8 → −2.3 |
| Private nonprofit | 506 | 15% → 8% | 44% → 50% | −2.4 → −3.0 |
| Public | 405 | 11% → 3% | 41% → 46% | −2.1 → −2.5 |
| Under 2,000 undergrads | 275 | 12% → 6% | 51% → 57% | −3.3 → −4.0 |
| 2,000–9,999 | 443 | 16% → 7% | 38% → 43% | −1.6 → −2.2 |
| 10,000+ | 194 | 9% → 4% | 44% → 48% | −2.5 → −2.6 |
| Under 25% admitted | 75 | 23% → 9% | 25% → 19% | −0.5 → −0.1 |
| 25–59% admitted | 150 | 17% → 15% | 38% → 59% | −1.2 → −4.2 |
| 60% or more | 687 | 11% → 4% | 46% → 49% | −2.6 → −2.9 |

What stands out, to confirm before publishing:
- **The Northeast drives the national shift.** Colleges there admitting women at a notably higher rate went from 41% to
  56%, while those favoring men fell from 17% to 5%.
- **The West moved the other way.** Fewer Western colleges admit women at a notably higher rate than 20 years ago (54% →
  39%).
- **Moderately selective colleges changed most.** Among colleges admitting 25–59% of applicants, the share admitting
  women at a notably higher rate rose from 38% to 59%. The most selective colleges show almost no gap either way.
- Public and private colleges moved in the same direction by similar amounts.

**To build.**
- National line: the share of colleges admitting men / women at a notably higher rate, each fall from 2001 (fixed
  panel), plus the median gap.
- Small charts for each breakdown group, same scale.
- An enrollment-weighted companion: "of all applicants, men were admitted at X%, women at Y%."
- Link to Explore sorted by the admit-rate gap (`sortBy=admit_gap`).

**Data work needed.** History stores the two rates but not applicants by sex, so the panel uses a 1,000-total-applicant
floor instead of the college pages' 200-per-sex rule. Add `applicants_men` and `applicants_women` series (the columns
are already read) so the study can use the same rule and weight by applicants.

**Open questions.**
1. Is the West's reversal real or a panel artifact (the West has the fewest colleges in the panel)? Check with the
   fall 2001 start and with enrollment weighting.
2. Should selectivity be grouped by each college's rate *then* rather than today? Colleges that became more selective
   may be the ones whose gap changed.
3. How to phrase this without implying a policy: a gap can reflect who applies as much as how colleges choose.

### Studies 2–6 (specified 2026-10-03, each in its own file)
| Study | Headline from the first look | Spec |
|---|---|---|
| 2. Test-optional went mainstream | 66% of colleges required a test in fall 2019; 5% do now. Published SAT ranges rose ~30 points where tests became optional | [test-optional.md](trends/test-optional.md) |
| 3. Shrinking colleges | Half of colleges have 10%+ fewer undergraduates than ten years ago; R1s and the most selective grew | [shrinking-colleges.md](trends/shrinking-colleges.md) |
| 4. The price gap, by who is discounting | Average paid fell 11% after inflation at the median college, but not at the most selective (0%, $51,300) | [price-gap.md](trends/price-gap.md) |
| 5. Public colleges and out-of-state students | The median public's out-of-state share rose 11% → 13%; R1 publics 18% → 22% | [out-of-state.md](trends/out-of-state.md) |
| 6. The Pell graduation gap | Pell recipients graduate 11 points less often than peers with neither Pell nor loans; the gap widened from 9 | [pell-gap.md](trends/pell-gap.md) |

### Study 7 (specified 2026-10-05, planned)
| Study | Headline from the first look | Spec |
|---|---|---|
| 7. Where the students went | A third of campus-based undergraduates attend a college with 20,000+ students, up from 30% in ten years, and the share rose every year; R1 universities went from 40% to 46% of students; the colleges that cut prices most lost the most students. The pandemic sped every shift up (the biggest campuses held flat in fall 2019 → 2022 while every other size lost 6–8%); since 2022 the shifts have slowed to their old pace, not reversed | [where-students-go.md](trends/where-students-go.md) |

## Shared computation and tests
As built 2026-10-04 (`feature/national-trends-foundation`). Studies, lists, and group pages are computed by
`npm run build-trends` from **committed files only** (`data/schools.json`, `data/history/{meta,cpi,national,facts}.json`,
the shards in `data/history/schools/`, and `data/detail/schools/` on request), with no network, and committed. `npm run
sync-history` runs the same step at its end, so a data release refreshes them. Output is deterministic (the files carry
history's `built` date, not today's), so tests rebuild and compare byte for byte.

| Piece | Where | Notes |
|---|---|---|
| Groups | `lib/trend-groups.ts` | One function per grouping from a `School`, today's classification: `region`, `control`, `size` (under 2,000 / 2,000–9,999 / 10,000+), `selectivity` (under 25% / 25–59% / 60%+; null without a rate), `setting`, `division` ("none" = NAIA or no NCAA), `research` ("other"), `designation` (several per college), `state`, `conference`. `GROUPINGS[key]` holds label, order, floor, registered field, glossary term; `GROUP_FLOOR` 30, `STATE_FLOOR` 10, `CONFERENCE_FLOOR` 8; `STANDARD_GROUPINGS`; `splitBy(items, grouping, schoolOf)`, `groupLabel()` |
| Panel helpers | `lib/trend-panel.ts` (pure; builders and tests share it) | `Member = { school, h }`; `fixedPanel(members, years, ok)`, `medianBy(ms, value)`, `shareBy(ms, test)` (null = left out), `weightedBy(ms, value, weight)`, `totalBy(ms, value)`, `reporting(ms, ok)` (null under `MIN_YEAR_COVERAGE` 90%), `yearly(from, to, fn, step)` (step 2: odd years null), `nationalRow(ms, compute)`, `byGroup(ms, grouping, compute, floor?)` (under the floor: `n` + `tooFew`, no values), `at`, `reports`, `quantile`, `round4`. Inflation: `real()`/`cpiFor()` from `lib/history.ts` with `ctx.cpi` |
| Study registry | `lib/trend-studies.ts` | `STUDIES`: slug, number, title, question, `series: SeriesKey[]`, `yearKind`, `window` (years back from history's newest), `groupings` (standard four first), `panelRule`, `fields: FieldPath[]`, `added` (index order), `explore` link, `spec`, `color`. `studyBySlug()`, `studyWindow(study, hmeta.latest)` |
| Types | `lib/trends.ts` | Envelope `TrendEnvelope { name, built, yearKind, from, to, n }`; `GroupRow<V>`, `GroupingResult<V>`, `StudyFile<V>` (`slug`, `lineFrom`, `national`, `groupings`), `ThenNow`; `TrendCard`/`TrendIndex` (index.json); one interface per unit (`MenAndWomenFile`) and one line each in `TrendFiles`, which types `getTrendFile(name)` |
| Builders | `scripts/trends/` | `context.mts` (`loadTrendContext(root)`: schools, `members` with shards sorted by id, hmeta, cpi, national, facts, `detail(id)`; `TrendBuilder { name, build(ctx) → { name, file, card? } }`), `index.mts` (`BUILDERS`, one line per unit), `build.mts` (`computeTrends`, `buildTrends(root)`, `formatTrendJson`, `trendFileText`), `studies/<slug>.mts`. CLI: `scripts/build-trends.mts` |
| Output | `data/history/trends/{name}.json` + `index.json` | One file per unit (`men-and-women.json`; later `test-optional`, …, `movers`, `conferences`, `states`). `index.json`: `{ built, cards, files }`: each study's card (headline value and caption, one sentence with templated numbers, sparkline series, years, n) and every file written. Files no builder wrote are deleted |
| Loading | `getTrendFile(name)` in `lib/data.ts` | JSON mode reads the file; Supabase mode reads the `history_files` row `trends/{name}` (`fetchTrendFile` in `lib/supabase.ts`; `fetchHistoryFiles` now reads only the four shared rows). Cached per request; null (logged) when missing, and pages show "not available yet" |
| Publishing | `scripts/publish-data.mts`, `supabase/migrations/20261004130000_trend_files.sql` | Trend files are upserted as `trends/{name}` rows after the history files, rows for files no longer built are deleted, and all are read back. Checked up front: file names, `name` fields, and `built` equal to history's. The migration widens `history_files`' name check (`'^trends/[a-z0-9-]+$'`) and must be applied before the first publish |
| Pages | `components/trends/` | `StudyPage` (layout: question, headline tiles, national chart, breakdowns, extra sections, takeaway, standard method note, links, `HistorySourceNote` over `study.series`), `SmallMultiples` (client; `views` of groupings → tiles on one shared scale, grouping switch, Colleges/Students switch when given two views, "too few colleges to say" tiles), `ViewSwitch` / `CollegesStudents`, `TrendStat` (then → now tile), `StudyCard`, `tiles.ts` (`groupingTiles(groupings, values → { series, summary })`, `direction(from, to)`). `SegmentedControl` in `components/ui/segmented-control.tsx`; `TrendLine` gained `domain` and `height` |
| Tests | `tests/trends-foundation.test.mts`, `tests/trends-<unit>.test.mts` | Foundation: grouping boundaries and floors, panel helpers, every study has a builder, a committed file, a page and a card, `data/history/trends/` holds exactly the builders' files, envelopes (`built` = history's), groups under the floor have no values, registry fields cover each series' registered field, and **every committed file equals a fresh build**. Per unit: recompute the national row and one group straight from the shards (Study 1: national + Northeast) |
| Lineage | `lib/fields.ts`, `history/meta.json` | Each study's `fields` must include `SERIES[k].field` for its series (tested). Sources print through `HistorySourceNote` with the years shown; every year label comes from the file's `from`/`to`/`lineFrom` via `historyYearLabel`, never typed |

Study-specific facts tests (Study 2's fall 2019 share equals `facts.testRequired.requiredFrom`, Study 4's national row
equals `facts.priceGap`) live in those units' tests.

Build order for the area: the hub (groups, registry, build, `/trends`, Study 1) first, then Studies 2–6 in the order
above (each is small once the hub exists: one registry entry, one build function, one page from the shared layout),
then the Movers page, then conferences and states (which reuse the movers registry for their per-group lists).

### Building a study in code (copy Study 1)
1. **Registry:** add an entry to `STUDIES` in `lib/trend-studies.ts` (next `number`, `series`, `fields` covering each
   series' `SERIES[k].field`, `window`, `groupings` with the standard four first).
2. **Types:** in `lib/trends.ts`, add `interface <Name>Values` and `interface <Name>File extends StudyFile<<Name>Values>`
   (plus any extra parts), and one line in `TrendFiles`.
3. **Builder:** copy `scripts/trends/studies/men-and-women.mts` to `scripts/trends/studies/<slug>.mts`: a panel with
   `fixedPanel`, a `values(ms, window, lineFrom)` that returns the group's measures and yearly lines, `nationalRow` +
   `byGroup` per grouping, and a card (headline, one sentence with templated numbers, sparkline). Add one line to
   `BUILDERS` in `scripts/trends/index.mts`, then `npm run build-trends` and commit the JSON.
4. **Page:** copy `app/trends/men-and-women/page.tsx` to `app/trends/<slug>/page.tsx`: `getTrendFile("<slug>")`,
   `TrendStat` tiles, a `TrendLine`, `SmallMultiples` from `groupingTiles(...)` (a second "Students" view when the study
   has one), hand-written takeaway with numbers from the file, extra method lines.
5. **Test:** `tests/trends-<slug>.test.mts`: recompute the national row and one group from the shards without the
   helpers; assert the floors and exclusions. The foundation test then checks the registry, file, page, and card.
6. `npm run verify`. The /trends card appears by itself (from `index.json`).

### Adding a section to /trends (Movers, conferences, states)
Write the builder (`scripts/trends/<unit>.mts`, one line in `BUILDERS`, its interface + `TrendFiles` line), then in
`app/trends/page.tsx` add one import and one component (like
`<MoversEntry />`) that reads `getTrendFile("<unit>")` and renders nothing when it's null.

## More ideas, not yet specified
Candidates for later studies, each already possible from stored series. Add one by writing a spec in `specs/trends/`
and a row in the table above.
- **The HBCU surge.** Median HBCU applications rose 77% since fall 2014 while undergraduates fell 12%: who applied,
  and did enrollment follow at any of them? (`applicants`, `enrolled`, `undergrads`, designation grouping.)
- **Legacy and the other factors.** Share of colleges considering legacy fell from 32% to 28% in two years (Home fact
  4); the longer story of class rank, essays, and recommendations since fall 2001 (`factor_*`).
- **What graduates study.** The majors shift (Home fact 5) by group: computing's rise, education's fall, by region and
  type (`major_*`, `bachelors`).
- **Transfer students.** Transfer-ins as a share of new undergraduates since fall 2008, where it rose (`transfer_in_share`).
- **Faculty.** Full-time faculty share since fall 2005 and salaries since fall 2016, by type and size.
- **Debt and borrowing.** Share of undergraduates with a federal loan since 2008–09, by group (`federal_loan_rate`).
- **The year in college data.** A generated annual page when each IPEDS release lands: what moved most since last
  year across every study, written from `studies.json` deltas. Editorial, so it waits until several studies exist.

## Adding a study (the spec)
Copy this template into **Studies** (then build it with [the code checklist](#building-a-study-in-code-copy-study-1)), and add a line to the backlog's National trends section:

```md
### Study N: Title
**Question.** …  **Why it's interesting.** …  **Data.** (history series, years, floors)
**First look.** (a computed table, with the date and panel)  **To build.** …  **Data work needed.** …  **Open questions.** …
```

## Open questions
1. One "Trends" page with study cards, or fold studies into the Data page? (Recommendation: a separate page; the Data
   page is about sources.)
2. Should studies be generated with the history build (always current) or hand-reviewed per release (more editorial
   control)? Recommendation: generated, with the takeaway text reviewed whenever a release changes a headline number by
   more than a few points. The test can flag this: fail when a headline moves more than 3 points without the takeaway
   file changing in the same commit.
3. Does Trends join the header (a fifth item) or stay in the footer and More menu? Recommendation: footer and Home
   link first; promote it when telemetry shows the Home band is used.
4. Takeaway copy: generated from numbers with direction words (as Home facts do with `movedBy()`), or written by hand
   per study and checked by the test above? Recommendation: hand-written sentences with templated numbers, so the
   prose survives a data release and the numbers never go stale.
