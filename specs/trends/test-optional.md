# Study 2: Test-Optional Went Mainstream, and What Happened to Scores

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md), which holds the study template and rules). First look computed 2026-10-03 from the
> committed history.

**Question.** How many colleges still require the SAT or ACT, who dropped the requirement, how many students still
submit scores, and what did that do to the score ranges colleges publish?

**Why it's interesting.** The site shows an SAT range on almost every profile. Since fall 2020, those ranges describe
a shrinking, self-selected group of applicants, and the site already warns about that on each profile. The national
view makes the warning concrete: in fall 2019, two thirds of colleges required a test; in fall 2024, one in twenty.
At colleges that dropped the requirement, the published 25th-percentile SAT rose about 30 points without the entering
students necessarily changing. Home fact 3 ("Test-optional went mainstream") already shows the headline; this study is
the full version, with the breakdowns, the submission rates, and the score effect.

## Data
| Series | Years | Used for |
|---|---|---|
| `test_policy` (IPEDS ADM `ADMCON7`, mapped per era) | Fall 2001 on | Share of colleges requiring tests; the panel's policy changes |
| `sat_submit`, `act_submit` | Fall 2001 on | Share of enrolled first-years who submitted each test |
| `sat_25`, `sat_75` (post-2017 scale only: the series break at fall 2017) | Fall 2017 on for this study | Published score ranges before and after a policy change |
| `applicants`, `acceptance_rate` | Fall 2001 on | Did applications rise more at colleges that went optional? (secondary) |

**Panel.** Colleges reporting a test policy in both fall 2019 (the last fall before the pandemic, the same baseline Home
fact 3 uses, `PRE_PANDEMIC_FALL`) and the newest fall: 1,511 colleges. Score comparisons use the subset with a 25th
percentile SAT in both years. Fall 2019 → fall 2024 stays inside the current SAT scale, so no break is crossed.

**Policy groups** (the study's own grouping, per the hub): *Required both years* · *Dropped the requirement* ·
*Optional both years* · *Went back to requiring* (8 colleges between fall 2022 and fall 2024: too few to chart, listed
by name).

## First look (2026-10-03, fall 2019 → fall 2024)
Share of colleges requiring the SAT or ACT, and the median college's share of enrolled first-years submitting an SAT:

| Group | Colleges | Required | Median SAT submission |
|---|---|---|---|
| **All** | 1,511 | 66% → 5% | 63% → 15% |
| Northeast | 423 | 47% → 2% | 83% → 19% |
| Midwest | 394 | 75% → 2% | 28% → 9% (ACT country) |
| Southeast | 373 | 79% → 13% | 54% → 13% |
| West | 186 | 65% → 2% | 77% → 13% |
| Southwest | 107 | 78% → 7% | 61% → 33% |
| Public | 499 | 85% → 10% | 73% → 14% |
| Private nonprofit | 970 | 58% → 3% | 59% → 16% |
| Under 2,000 undergrads | 767 | 55% → 4% | 55% → 11% |
| 2,000–9,999 | 538 | 71% → 5% | 68% → 18% |
| 10,000+ | 206 | 90% → 10% | 74% → 23% |
| Under 25% admitted | 88 | 81% → 11% | 65% → 35% |
| 25–59% admitted | 275 | 61% → 8% | 59% → 19% |
| 60% or more | 1,120 | 67% → 4% | 64% → 12% |
| R1 universities | 176 | 91% → 9% | 68% → 30% |
| D-I FBS members | 136 | 95% → 13% | 61% → 23% |

Share of the panel requiring a test, by fall: 78% (2015) · 75% · 72% · 70% · 66% (2019) · 38% (2020) · 11% (2021) ·
8% · 6% · 5% (2024). The decline was gradual, then the pandemic finished it in two years.

**Score ranges, fall 2019 → fall 2024, median change in the published SAT:**

| Policy group | Colleges | 25th percentile | 75th percentile |
|---|---|---|---|
| Dropped the requirement | 610 | **+28** | +30 |
| Kept the requirement | 66 | −24 | 0 |
| Optional both years | 123 | +50 | +40 |

What stands out, to confirm before publishing:
- **The Southeast and public universities held out longest** and still have the most requirers (13% and 10%).
- **Submission collapsed everywhere**, but least at the most selective colleges (35% still submit) and R1s (30%).
- **Published ranges rose where tests became optional** and fell where they stayed required. The copy must say this
  is consistent with who chooses to submit, not evidence that students got stronger (hub rule 5), and should link to
  the glossary's `test-submission` and `test-optional` terms.
- The 8 colleges that returned to requiring tests (fall 2022 → 2024) are worth naming: readers have seen the news.

## What readers see (`/trends/test-optional`)
1. **National line**: share of colleges requiring a test, fall 2001 to now, with the pandemic shading and a marker at
   fall 2019. Hollow point for the provisional year, as on profiles.
2. **Small multiples**: the same line per group for region, type, size, selectivity (same scale), plus R1 and FBS
   as a fifth row from the additional groupings.
3. **Who still submits**: the median submission share over time, SAT and ACT as two lines; the Midwest's ACT pattern
   is the natural caption.
4. **What happened to the ranges**: a dumbbell per policy group (25th and 75th percentile, fall 2019 → newest), with the
   caption that the ranges describe submitters.
5. **Went back to requiring**: the named list with each college's current policy and a link to its profile.
6. **Takeaway**, **method note**, and links: Explore's test-policy filter (a backlog item this study needs: `required /
   test-optional / test-blind`), the glossary, and Home fact 3.

## Computation
- `studies.json` entry `test-optional` from `npm run sync-history`: per group, the yearly share requiring, the yearly
  median submission shares, the dumbbell values per policy group with panel sizes, and the returned-to-requiring ids.
  Reuses the hub's breakdown machinery and the `TEST_POLICY_CODES` / `TEST_BLIND_FROM` constants in `lib/history.ts`.
- Test: recompute the national line and one group from committed shards; assert the fall 2019 share matches Home fact
  3's `requiredFrom` exactly (same panel rule), so the two never disagree.

## Data work needed
- Explore's test-policy filter (small; also lets Home fact 3 link somewhere).
- Nothing new from NCES: all series exist.

## Open questions
1. Should "test-blind" (fall 2022 on, code 3 meaning "not considered") be its own line? It is a minority of
   optional colleges; recommendation: show it as a thinner line from fall 2022, labeled, since readers conflate the two.
2. Enrollment-weighted companion: "of all first-years at these colleges, X% submitted an SAT." The hub asks each study
   to say colleges or students; this study shows the median college and offers the student-weighted figure as one
   sentence.

## Update (2026-10-25): this cycle, on the Common App grid
The owner's read, after the Common App build ([common-app.md](../data-expansion/common-app.md), PR #175): now that the
pandemic is past, test-optional is moving back the other way, and the study should say so rather than end at the
federal fall 2024 point. The Requirements Grid gives each member college's stated policy for the 2026-27 cycle, two
falls ahead of the federal data, in a finer vocabulary (A always required, F flexible, S sometimes required, N never,
I ignored).

**Block.** `thisCycle` in `test-optional.json`, built by `scripts/trends/studies/test-optional.mts` from each school's
`apply.test_policy.code` and the shards' federal policy at the newest fall, over the member colleges with both
(1,004 at build). Shares this cycle: required (A or F) 16.6%, required for some (S) 29.5%, test-optional (N) 52.1%,
test-blind (I) 1.8%. The same colleges by the federal count in fall 2024: 3.5% required, 74.4% optional, 22.1% blind.
Named lists: `backToRequiring` (not required federally in fall 2024, A on the grid: 23 colleges, among them Brown,
Caltech, Cornell, Dartmouth, Johns Hopkins, Penn, Stanford, Ohio State, UT Austin, Auburn, Georgia State) and
`wentOptional` (required federally, N or I on the grid: Texas State, UConn, Southern Maine). Null without a grid, so
the study stands on the federal data alone.

**What readers see.** A new section after the national line, "This cycle, on the Common App grid": four tiles (the
four shares, each with the federal share for the same colleges beside it, cited to the grid's cycle and stamp through
`gridCitation`), the caveat that "required for some" has no federal counterpart (most of those colleges read
"considered" federally, so part of the gap is a finer instrument, not a change of policy), the named list of colleges
requiring a test again with their fall 2024 federal answer, and the one line for colleges that went the other way. The
takeaway and the hub card's sentence gain a clause on the movement back. The federal "went back to requiring"
list (fall 2022 → 2024) stays as it was.

**Rules kept.** No cycle or date literal in the page: the cycle text and the vintage come from the block and
`gridVintage`. The grid's A and F both count as required (the site's own code map); its S is shown as its own tile and
never folded into either side of the comparison. The headline stat stays federal (the panel's 66% → 5%), so Home fact
3 and the study never disagree; the grid block is a look ahead for members only, said so in the method note.

**Tests** (`tests/trends-test-optional.test.mts`): the block recomputed from `schools.json` and the shards (n, codes,
shares, cycle and stamp); the back-to-requiring list recomputed, every member reading "required" on the site, and the
went-optional list recomputed.
