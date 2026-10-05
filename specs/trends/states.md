# Trends by State

> Status: **built** 2026-10-04 (PR #80); an addition, first-years crossing state lines, was planned 2026-10-05
> ([below](#planned-addition-2026-10-05-first-years-crossing-state-lines)). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md)). First-look figures computed 2026-10-03.

## Why
Most students go to college in their own state, and state policy (funding, free-tuition programs, system mergers)
moves whole groups of colleges at once. Readers in Pennsylvania or Ohio feel a different trend from readers in Texas:
in the first look, the median Pennsylvania college lost 17% of its undergraduates since fall 2014 and Ohio's lost 18%,
while Texas colleges grew 3% at the median and 12% in total. The site has a state tile map on Home and a state filter
in Explore, but no page that says what is happening to a state's colleges.

## What readers see
### `/trends/states`: the index
- The existing `StateTileMap`, colored by one measure (segmented control: undergraduate change · acceptance rate ·
  average cost after inflation · out-of-state first-years · share of colleges test-optional), with a diverging or
  sequential scale from the dataviz rules ([charts.md](../charts.md)). Tap a tile to open the state's page.
- A table of all states under the map, same measures, sortable, with the number of colleges on the site per state.
  States with fewer than 10 colleges show counts but no medians ("too few colleges to summarize").

### `/trends/states/{state}`: one state (two-letter code, lower-case: `/trends/states/pa`)
1. **Header**: state name, colleges on the site (public / private nonprofit / for-profit counts), total undergraduates
   and the ten-year change in that total, link to Explore filtered to the state (`/explore?states=PA`, exists).
2. **How this state's colleges changed**: four stat tiles with sparklines, fixed panel of the state's colleges:
   undergraduates (median change and total change), applications, acceptance rate, average total cost after inflation,
   each against the national median.
3. **Public and private**: the same measures split by control, because state stories are usually public-system
   stories (a state's publics shrinking while privates hold, or the reverse).
4. **Where the state's first-years come from**: the publics' median out-of-state share and the private colleges', over
   time (even-year series), and the top sending states to this state's colleges aggregated from the residence detail
   (`detail.residence`, the home-state table built in wave 2) when it exists.
5. **Biggest movers in this state**: the top-10 lists ([top-10-lists.md](top-10-lists.md)) restricted to the state,
   three lists (applications, undergraduates, average cost), with the same floors and exclusions.
6. **Public research universities**: no classification exists for "flagship" in the data, so this section is simply
   the state's public R1 and R2 universities (Carnegie 2025, `campus.carnegie.research`), with their ten-year changes.
7. **Method note** and sources.

## Rules
Hub [rules](../national-trends.md#rules) apply, with one relaxation:
1. **10 colleges per state** for medians (45 states qualify), not 30, because states are a fixed, finite set the
   reader expects to find and most have fewer than 30 colleges on the site. Every state page says its panel size next
   to each median, and pages for states under 10 show counts, the member list, and movers only.
2. **Fixed panel per state**, as everywhere: colleges reporting both endpoints. A state's total-students change is over
   the panel, and the page says how many of the state's colleges are in it ("107 of 117 Pennsylvania colleges").
3. **Territories** (Puerto Rico and others, 41 colleges) have pages like any state, grouped under "Territories" on the
   index. Puerto Rico's colleges lost a third of their undergraduates at the median: a real story, kept.
4. **Totals and medians both appear**, labeled, because they diverge: New York's median college shrank 8% while its
   total fell 6%; Missouri's median fell 17% while its total fell 26% (large publics shrank most there).
5. **No state rankings by quality.** The index sorts alphabetically by default; medians are descriptive.
6. **No policy attribution.** A state page may show the share of the state's publics with a promise program
   (`cost.promise_program`, with its glossary term) but never says a change happened because of a policy.

## First look (2026-10-03; undergraduates, fall 2014 → fall 2024, colleges with 300+ both years)
| State | Colleges on the site | In the panel | Median college | Total students |
|---|---|---|---|---|
| New York | 165 | 121 | −8% | −6% |
| California | 138 | 92 | +4% | +6% |
| Pennsylvania | 117 | 107 | −17% | −11% |
| Texas | 100 | 78 | +3% | +12% |
| Ohio | 77 | 63 | −18% | −13% |
| Massachusetts | 71 | 61 | −5% | −3% |
| Illinois | 69 | 53 | −16% | −9% |
| Florida | 65 | 45 | +1% | +8% |
| North Carolina | 59 | 49 | −3% | +5% |
| Georgia | 54 | 49 | +2% | +8% |
| Virginia | 53 | 42 | −7% | +3% |
| Missouri | 53 | 42 | −17% | −26% |

The Northeast and Midwest states lost students at the median; the Sun Belt gained. Study 3 ([shrinking
colleges](shrinking-colleges.md)) tells that story nationally; the state pages let a reader find their own state in
it.

## Computation and storage
- `data/history/states.json`, built by `npm run sync-history`: per state, panel ids, yearly medians per measure (all,
  public, private nonprofit), totals, and the state's movers (ids and changes). ~54 × 5 measures × 11 years: small.
- Reuses the breakdown machinery from the hub (`groupBy(state)`), the movers registry from
  [top-10-lists.md](top-10-lists.md), and `lib/states.ts` for names.
- The index map reuses `StateTileMap` with a `values` prop and a legend; the color scales come from the design
  system's validated sequential and diverging ramps.

## Build order
1. `buildStates()` in the history build; test recomputes one state (Vermont, small: checks the under-10 rule) and one
   large state's medians from committed shards.
2. Index page: map with measure control, table.
3. State page: tiles, public/private split, origins, movers, public research universities.
4. Links in: Home's state tiles ("Trends in {state}" in the tile's hover card), the profile header's state link, and
   the Trends index.

## Planned addition (2026-10-05): first-years crossing state lines
Decided 2026-10-05 alongside [Study 7](where-students-go.md), whose question "toward certain states?" this answers in
appetite terms rather than demographic ones. The residence tables (`tables.home_states` in the detail files, the
newest even fall) give every college's first-years by home state, so each state has an **inflow** (first-years at its
colleges from other states), an **outflow** (its residents who started at colleges in other states), and the **net**.

### What readers see
- **Index map, a sixth measure, "Net first-year inflow"**: the net as a share of all first-years at the state's
  colleges (net ÷ (in-state + inflow)), on the diverging scale centered on zero; the tooltip gives inflow, outflow,
  and net in students. The table gains the three columns, sortable.
- **State page, section 4** ("Where the state's first-years come from") gains an in/out block: inflow, outflow, and
  net; the ratio in words ("Alabama's colleges enroll 3.3 first-years from other states for every Alabamian who
  starts college in another state"); and the five colleges taking the most of the inflow, each with its share of it,
  linking to their profiles. Top sending states stay as they are.

### Rules
1. **Campus-based colleges only**, on both sides: an online-first college's first-years didn't move (Southern New
   Hampshire University alone is 80% of New Hampshire's raw inflow), so online-first colleges, for-profits, and
   merged campuses are left out, as in Study 7's panel. The rule is [online-share.md](../data-expansion/online-share.md)'s
   field; until it exists, the movers' lists ([top-10-lists.md](top-10-lists.md), rule 2), and the method note says
   which.
2. **Only the site's colleges count.** A resident who starts at a community college, or at a college not on the site,
   is invisible on both sides; every figure says "among four-year colleges on this site".
3. **Home codes that aren't states** (foreign countries, unknown, outlying areas without a college on the site) are
   left out of the flows and counted as "other" in the method note; territories with colleges on the site (Puerto
   Rico, Guam, the U.S. Virgin Islands) are states for this purpose.
4. **One fall**, the newest even fall, as the residence tables are a snapshot; no line until the biennial series
   holds enough points to say something.
5. **No floor**: the measure is a sum, not a median, so states under 10 colleges show it too, labeled with their
   college count; a state with no college table shows nothing.

### First look (2026-10-05; fall 2024 home-state tables, 1,803 colleges; online-first colleges not yet excluded)
| State | Net | Inflow | Outflow | Colleges taking the most of the inflow (share of it) |
|---|---|---|---|---|
| Arizona | +16,000 | 22,000 | 6,000 | Phoenix 29%, Grand Canyon 24% (both online-first), Arizona State 19%, Arizona 19% |
| New Hampshire | +15,700 | 19,900 | 4,200 | Southern New Hampshire 80% (online-first), UNH 7%, Dartmouth 5% |
| Indiana | +9,600 | 16,900 | 7,300 | Purdue 32%, IU Bloomington 23%, Notre Dame 10% |
| Alabama | +9,600 | 13,700 | 4,100 | Alabama 35%, Auburn 20%, Alabama A&M 8% |
| Pennsylvania | +8,800 | 28,600 | 19,800 | Penn State 13%, Temple 6%, Penn 6%, Pitt 5% |
| … 33 states and DC are net importers; 20 states and territories net exporters … | | | | |
| Illinois | −21,000 | 11,000 | 32,000 | |
| California | −23,100 | 16,100 | 39,200 | |
| Texas | −25,900 | 9,300 | 35,200 | |
| New Jersey | −27,000 | 5,000 | 32,000 | |

In most importing states one or two public flagships take half to two thirds of the inflow (Arkansas 62%, Montana
State 65%, West Virginia 57%, Vermont 55%, Mississippi 53%, Delaware 71%); Pennsylvania, Massachusetts, North Carolina,
and New York take theirs broadly (top three under 30%). Texas and California grow fastest at home (Study 7) and export
the most first-years: their growth is home-grown. The Arizona and New Hampshire rows show why rule 1 comes first.

### Computation and tests
- `buildStates()` gains, per state, `flows: { year, inflow, outflow, net, firstYears, netShare, receiving: { unit_id,
  count, share }[] }`, summed from `ctx.detail(id)` home-state tables over campus-based colleges: `inflow` for state S
  is the sum, over colleges in S, of first-years whose home state is another state; `outflow` is the sum, over
  colleges outside S, of first-years whose home state is S; `firstYears` is in-state plus inflow. The map's sixth
  measure reads `netShare`; the `StateMapMeasureDef` gains a `signedPct` diverging entry and the table three columns.
- Tests: the sum of every state's inflow equals the sum of every state's outflow (each cross-state first-year is
  counted once on each side); one state recomputed from the detail files without the helpers; no online-first,
  for-profit, or merged college on either side; `flows` absent for a state with no college table; the `receiving`
  shares sum to at most 1 and are ordered.

## Open questions
1. Should the state page include **high school graduate projections** (WICHE's "Knocking at the College Door")? They
   would explain the enrollment trend but are a new external source with its own license. Recommendation: not now;
   note it for the high-school-data work.
2. A **metro-area** version of these pages is what [metro-area.md](../data-expansion/metro-area.md) was deferred for.
   When the state pages exist, metro pages are the same template over a different grouping.
3. ~~Net first-year flows between states~~: decided 2026-10-05, see the planned addition above.
