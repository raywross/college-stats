# Trends: Top-10 Lists (Biggest Movers)

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md)). First-look lists below were computed from the committed history on 2026-10-03;
> they exist to test the rules, not to be published as they stand.

## Why
Studies answer "what changed across the country?" Readers also ask the simpler question: **which colleges changed
most?** Today the site has a few static leaderboards on Home (hardest to get into, biggest, highest Pell share) and
Explore sorts by ten-year change, but nothing that says "these ten colleges doubled their applications" with the
context that makes the list fair. Top-10 lists are the shareable, skimmable face of the trends area, and every entry is
a door into a profile.

They are also the riskiest page to get wrong. A naive "top 10 enrollment growth" list is a list of online programs
and campus mergers; a naive "biggest cost cut" list is a list of accounting changes. This spec is mostly rules.

## What readers see
**`/trends/movers`**: one page, one list per measure, each a ranked ten with the change as a bar, the from → to
values, the years, and the college's crest linking to its profile. A segmented control picks the **window**: *10 years*
(default) or *5 years*. Each list has a one-line method note ("Colleges with 2,000+ applicants in fall 2014; online-only
colleges excluded") and a "See all in Explore" link that opens the same sort with the same floors applied.

Lists, in page order (each is a measure the site already has a ten-year change for, so the numbers agree with profiles
and Explore):

| List | Measure | Series | Floor (at the window start) | Direction |
|---|---|---|---|---|
| Applications surged | Applicants, % change | `applicants` | 2,000 applicants | up |
| Got much harder to get into | Acceptance rate, points | `acceptance_rate` | 2,000 applicants | down |
| Got much easier to get into | Acceptance rate, points | `acceptance_rate` | 2,000 applicants | up |
| Grew the most | Undergraduates, % change | `undergrads` | 1,000 undergraduates, **campus-based** (below) | up |
| Shrank the most | Undergraduates, % change | `undergrads` | 1,000 undergraduates, still open (below) | down |
| Students pay much less | Average total cost, % change after inflation | `avg_paid_all` | 1,000 undergraduates, cost over $5,000 | down |
| Students pay much more | Average total cost, % change after inflation | `avg_paid_all` | same | up |
| Graduation rate climbed | 6-year graduation rate, points | `grad_rate` | 1,000 undergraduates, entering class of 200+ | up |
| More students from out of state (publics) | First-years from other states, points | `out_of_state_share` | public, 500 first-years | up |
| Pell gap closed most | Non-Pell minus Pell graduation rate, points | `grad_rate_pell`, `grad_rate_no_pell_no_loan` | 100 Pell students in both classes | down |

Each list shows **ten**; a "Show 25" button extends it in place. There is no "all colleges" ranking here: that is
Explore's job.

## Rules
Everything from the hub's [rules](../national-trends.md#rules) applies (fixed window, cited years, patterns not
causes), plus:

1. **A floor at the start of the window, on the base.** Percent changes on small bases make the list; a college going
   from 400 to 1,200 applicants is not the story. Floors are in the table above and are printed under each list.
2. **Campus-based only for growth; still-open only for decline.** The first look's "grew the most" list was
   Colorado Technical University (1,139 → 28,086), Southern New Hampshire University (28,035 → 163,164) and other
   mostly-online enrollments; "shrank the most" was six DeVry campuses winding down to under 100 students. Rules:
   - Exclude a college from **growth** lists when its distance-education share is over 50% (needs the
     `EF{Y}A_DIST` share: see *Data work*). Until that exists, exclude for-profits and the handful of known
     online-first nonprofits by a reviewed list in `data/trends/online-first.json` with a reason per entry.
   - Exclude a college from **decline** lists when its latest undergraduate count is under 300 (it is closing, not
     shrinking) and when the Scorecard flags it as closed or merged. Say "N colleges that closed or merged are not
     listed" under the list, with a link to the Explore sort that includes them.
3. **One campus, one entry.** Colleges that merged mid-window (Vermont State University, 2023) appear only if both
   endpoints describe the same campus set; otherwise they are excluded with the merged-flag rule above. History
   already carries the Scorecard `unit_id`, so this is a lookup against a small exclusion list, reviewed each release.
4. **Reporting errors stay out.** The history build already lists year-over-year jumps over 3× (about 890, mostly small
   colleges). A college whose endpoint value is such a jump is excluded from the lists, not from the data. Graduation
   rates of exactly 100% from classes under 50 (Strayer University-Florida in the first look) are caught by the
   entering-class floor.
5. **Ties and precision.** Rank by the raw change; display one decimal for percentages, whole points for rates. Ties
   at the tenth rank include every tied college.
6. **No "worst" framing.** List titles say what happened ("Shrank the most", "Got much easier to get into"), never
   "worst" or "losers". Copy under a decline list reminds readers that smaller can be deliberate (a college ending
   programs, a system consolidating).
7. **Every list cites its series and years** via `citeField`, like a study, and links to the glossary term for the
   measure.

## First look (2026-10-03, fall 2014 → fall 2024, before the exclusion rules)
Shown to record what the raw lists look like, so the rules above can be checked against them when built.

| List | What the raw top 10 contained | Rule that fixes it |
|---|---|---|
| Applications surged | Southern New Hampshire (+955%, online), then **seven HBCUs** (Southern, Clark Atlanta, NC A&T, Morgan State, FAMU, Fisk, Edward Waters, +350–710%), Rutgers-Camden, Wingate | Online exclusion. The HBCU surge is real and stays: it is the headline of this list, with a link to the designation grouping |
| Harder to get into | The Citadel (76% → 23%), Fisk, Saint Augustine's, Fairfield, Denison, Bemidji State, Auburn, Akron, Tennessee-Knoxville | Saint Augustine's (enrollment 1,016 → 172) is a closing college whose applicants collapsed; the still-open rule removes it from decline lists but it would remain here. Add the same under-300 exclusion to every list |
| Students pay much less | Central State (−77%), Tulsa (−65%), Bridgewater, Albion, Virginia Union, Bethel, two yeshivas, Fort Valley State, Georgetown College | Yeshivas pass the floor at ~1,000 undergrads; the $5,000 floor on cost removes nothing here. Tuition resets (Bridgewater, Albion, Georgetown College) are the real story; keep |
| Grew the most | Colorado Technical (+2,366%), SNHU, Cumberlands, Strayer, National Louis, Vermont State (merger), West Coast University | Online and merger exclusions remove 6 of 10 |
| Shrank the most | Six DeVry campuses (−91% to −99.6%), Notre Dame de Namur (closed), Springfield College online, Saint Augustine's, Dewey University | Under-300 and closed exclusions remove all 10, which is the point: the list then shows real contractions (Indiana Wesleyan-Marion 10,218 → 1,974 was eleventh) |
| Graduation rate climbed | Strayer-Florida (44% → 100%), Touro, Baker, Maryland Global Campus, Jacksonville State, Boise State, Wayne State | Entering-class floor removes the 100%; the rest are credible |

## Computation and storage
- Computed by `npm run sync-history` into `data/history/movers.json`: for each list and window, the ranked 25 with
  `unit_id`, `from`, `to`, `change`, `years`, and the panel size and floors used, plus the `excluded` counts by reason.
  The page reads this file (static); nothing is ranked at request time.
- Floors, directions, and series live in one registry, `lib/movers.ts`, typed against `SeriesKey`, so a list can't name
  a series that doesn't exist and the test can recompute every list.
- Exclusion lists: `data/trends/online-first.json` and `data/trends/excluded-campuses.json`, each entry `{ unit_id,
  reason, added }`, reviewed when the history is rebuilt (the build prints newly qualifying candidates for review:
  any college whose change is in a list's top 25 and whose undergraduate count moved more than 3×).
- Links: `/explore?sortBy=apps_change&minApplicants=2000` etc. Explore needs `minApplicants` / `minUndergrads` params
  (small: `lib/params.ts`), so "See all" shows the same universe the list used.

## Build order
1. `lib/movers.ts` registry and `buildMovers()` in `scripts/history/build.mts`, with the exclusion files and the
   candidate report. Test: recompute from committed history; every entry respects its floor; no excluded id appears.
2. `/trends/movers` page: list component (reuses `Leaderboard`'s row shape with a from → to column), window control
   (URL `?window=5|10`), method notes, Explore links. Mobile: one list per screen, swipe rail of list titles
   ([mobile.md](../mobile.md)).
3. Home: the "Leaderboards" band can swap one static list for a mover list when it's striking ("Applications
   surged"), linking here.
4. Data work: distance-education share (`EF{Y}A_DIST`, `DEEXC`/`DESOM`/`DENON` undergraduates) as a snapshot field
   `demographics.online_share`, which also benefits Explore ("mostly online" filter). A small wave-4 item; until then the
   reviewed list stands in.

## Open questions
1. Should the page also show the **national median** for each measure next to the list, so "+120% applications" reads
   against "+35% at the median college"? Recommendation: yes, one line under the title, from `national.json`.
2. Five-year window: fall 2019 → fall 2024 spans the pandemic. Keep it (readers will ask) but shade the note.
3. Should for-profits appear once the online share exists? Recommendation: yes, with the same rules; the exclusion is
   about mode of delivery, not ownership.
