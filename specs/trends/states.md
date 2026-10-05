# Trends by State

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Specified 2026-10-03 as part of the national-trends family
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

## Open questions
1. Should the state page include **high school graduate projections** (WICHE's "Knocking at the College Door")? They
   would explain the enrollment trend but are a new external source with its own license. Recommendation: not now;
   note it for the high-school-data work.
2. A **metro-area** version of these pages is what [metro-area.md](../data-expansion/metro-area.md) was deferred for.
   When the state pages exist, metro pages are the same template over a different grouping.
3. **Net first-year flows** (added 2026-10-05, from Study 7's first look, [where-students-go.md](where-students-go.md)).
   The residence tables give, for each state, first-years arriving at its colleges from other states and its own
   residents enrolled at colleges elsewhere, so the page could show inflow, outflow, and the net, with the colleges
   that take the inflow. Computed over the 1,803 colleges with a fall 2024 home-state table: 33 states and DC are net
   importers (Arizona +16,000, New Hampshire +15,700, Indiana +9,600, Alabama +9,600, Pennsylvania +8,800, then DC,
   Utah, South Carolina, Mississippi, Iowa), 20 are net exporters (New Jersey −27,000, Texas −25,900, California
   −23,100, Illinois −21,000, then Minnesota, Maryland, Washington, New York, Georgia), and in most importing states
   one or two flagships take half to two thirds of the inflow (Arkansas 62%, West Virginia 57%, Mississippi 53%,
   Montana State 65%, Vermont 55%, Delaware 71%); only Pennsylvania, Massachusetts, North Carolina, and New York take
   theirs broadly. It would be a sixth measure on the index map ("net first-year inflow") and an in/out block in
   section 4 of each state page. Caveats to carry: only the site's four-year colleges count on either side; an
   online-first college registers as inflow to its home state (Southern New Hampshire is 80% of New Hampshire's), so
   the rule in [online-share.md](../data-expansion/online-share.md) applies first; it is one fall's first-years.
   Recommendation: build it with Study 7, after the online-share field.
