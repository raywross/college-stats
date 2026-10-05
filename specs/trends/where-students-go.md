# Study 7: Where the Students Went

> Status: **planned**. Specified 2026-10-05 as part of the national-trends family ([hub](../national-trends.md), which
> holds the study template and rules). First look computed 2026-10-05 from the committed history and the movers'
> exclusion lists (`data/trends/`). Owner decisions 2026-10-05: a ten-year view with the pandemic as a question inside
> it (not a five-year toggle); the students view of cost; the state-flows measure, specified in
> [states.md](states.md).

**Question.** Over ten years, where did undergraduates go: to bigger colleges, to certain states, to public or private
colleges, to cheaper or pricier ones? And what did the pandemic do to that: did it speed the shifts up, and now that
it is a few years behind us, are they reversing?

**Why it's interesting.** [Study 3](shrinking-colleges.md) says half of colleges shrank, and tells it college by college
(the median college, the share of colleges). This study is the *students* view the hub's rule 2 asks for: each kind of
college's share of all undergraduates, then and now, so a reader sees the country's choices as one picture. The national
total barely moved (−1%), which makes the shifts underneath it the story. In the first look, a third of campus-based
undergraduates now attend a college with 20,000 or more students, up from 30%, and the line rose every single year;
research universities (R1) went from 40% to 46% of students while colleges outside the research tiers lost 17% of
theirs; the Midwest lost two points of national share; and price did not pull students: the fifth of colleges that cut
what students pay the most lost the most students, while the priciest fifth grew. The pandemic sped all of this up
(the biggest campuses held flat in fall 2019 → 2022 while every other size lost 6–8% of students) and the shifts have
slowed since 2022, to about their pre-pandemic pace, but not reversed.

## Data
| Series | Years | Used for |
|---|---|---|
| `undergrads` (College Scorecard `student.size`, IPEDS fall enrollment) | Fall 1996 on | The measure: each group's share of all undergraduates in the panel, by fall |
| `applicants` | Fall 2001 on (falls 2019–2021 are under the 90% coverage rule, so the companion uses 2014, 2018, 2022, and the newest fall) | Companion: each group's share of all applications |
| `acceptance_rate` | Fall 2001 on | Selectivity at the window start |
| `avg_paid_all`, `full_price` | 2008–09 / 2000–01 on | The cost section: what students pay, after inflation, against enrollment change; the students view by year |
| CPI-U school-year averages (`data/history/cpi.json`) | | All money after inflation, as everywhere on the site |
| `demographics.online_share` + `online_share` series ([online-share.md](../data-expansion/online-share.md), planned); until then `data/trends/online-first.json`, for-profit status, and `data/trends/excluded-campuses.json` | Fall 2012 on | The campus-based panel |

**Panel.** Colleges with 300 or more undergraduates in both fall 2014 and the newest fall, Study 3's panel: 1,537
colleges, 8,360,428 → 8,239,463 undergraduates (−1.4%). Two cuts of it:
- **All colleges**, for the by-kind top line only: campus-based public and nonprofit · for-profit · online-first public
  and nonprofit · merged or split campuses.
- **Campus-based**: the panel minus online-first colleges (the glossary's definition: more than half of undergraduates
  take every course online), for-profits, and campuses that merged or split inside the window, the same exclusions
  the movers' growth lists use ([top-10-lists.md](top-10-lists.md), rule 2): 1,412 colleges, 7,528,008 → 7,256,025
  (−3.6%). Every share below is of this panel unless it says otherwise. The reason is in the numbers: an online
  college's enrollment grows without anyone going anywhere (Southern New Hampshire University, 28,035 → 163,164), and
  a merger moves students between IDs (Arizona State's campuses consolidated under one ID in fall 2020); either one
  would swamp the geography.

**Three periods inside the ten years**, for the pandemic question: *before* (fall 2014 → the last fall before the
pandemic, fall 2019: the same baseline Home fact 3 and [Study 2](test-optional.md) use), *the pandemic* (fall 2019 →
the fall with the lowest campus-based total after it, fall 2022 today, found by the build rather than typed), and
*after* (that low point → the newest fall; two falls today, and one more with each release). The page reports each
period's change in students and the pace of change in share (points per year), so periods of different lengths
compare, and labels the after period's length.

**Classified then, not now (a stated departure from hub rule 3).** Size and selectivity use each college's fall 2014
value, because the question is where students went *from* the kinds of college that existed then. Today's
classification counts a college that grew past 20,000 as large at both ends and overstates the shift (20,000+ share
29.8% → 35.4% classified today, against 30.2% → 34.4% classified then). The method note says so, and gives the
today-classified figure in one line. Region, public or private, setting, and research tier use today's classification,
as everywhere: they don't move with enrollment.

## First look (2026-10-05, fall 2014 → fall 2024)

### By kind (the whole panel, 1,537 colleges)
| Kind | Colleges | Share of students, then → now | Students |
|---|---|---|---|
| Campus-based public and private nonprofit | 1,412 | 90.0% → 88.1% | −3.6% |
| **Online-first public and nonprofit** | 60 | 4.6% → 6.5% | **+39%** |
| For-profit (campus or online) | 37 | 2.8% → 2.7% | −7% |
| Merged or split campuses (left out below) | 28 | 2.5% → 2.8% | +9% (the merger, not growth) |

### Size, as of fall 2014 (campus-based)
| Group | Colleges | Share then → now | Students | Median college | Grew at all |
|---|---|---|---|---|---|
| Under 2,000 | 595 | 9.3% → 8.5% | −12% | −13% | 31% |
| 2,000–9,999 | 600 | 35.7% → 32.6% | −12% | −14% | 30% |
| 10,000–19,999 | 132 | 24.8% → 24.5% | −5% | −4% | 40% |
| **20,000+** | 85 | **30.2% → 34.4%** | **+10%** | +12% | 74% |

The 100 biggest campuses held 34.0% of students and hold 39.1%; the 50 biggest, 20.1% → 24.1%. Share at colleges
with 20,000+ in fall 2014, by fall: 30.2 · 30.7 · 31.0 · 31.4 · 31.7 · 32.1 · 32.8 · 33.3 · 33.7 · 34.1 · 34.4%: up
every year, pandemic included.

### Public or private, research tier, setting (campus-based)
| Group | Colleges | Share then → now | Students | Median college |
|---|---|---|---|---|
| Public | 541 | 72.0% → 72.9% | −2.5% | −13% |
| Private nonprofit | 871 | 28.0% → 27.1% | −6.4% | −10% |
| **R1 universities** | 178 | **40.5% → 46.0%** | **+9%** | +9% |
| R2 | 121 | 16.1% → 15.9% | −5% | −4% |
| RCU (research colleges and universities) | 180 | 14.3% → 13.0% | −12% | −13% |
| Not a research tier | 933 | 29.1% → 25.1% | **−17%** | −17% |
| City | 697 | 62.9% → 65.0% | 0% | −8% |
| Suburb | 321 | 19.7% → 19.6% | −4% | −10% |
| Town | 287 | 15.0% → 13.2% | −15% | −16% |
| Rural | 107 | 2.4% → 2.1% | −15% | −19% |

The all-colleges split hides the public shift: private nonprofits' share looks flat (28.8% → 29.2%) because
online-first nonprofits and publics gained about as many students (+148,000 across 60 colleges, most of them Southern
New Hampshire and Grand Canyon) as campus-based private nonprofits lost (−142,000).

### Region and state (campus-based)
| Region | Colleges | Share then → now | Students | Median college |
|---|---|---|---|---|
| Southeast | 354 | 24.7% → 26.0% | +1% | −8% |
| Southwest | 102 | 9.9% → 10.9% | +7% | −4% |
| West | 166 | 17.8% → 18.7% | +1% | −5% |
| Northeast | 390 | 22.2% → 21.6% | −6% | −9% |
| **Midwest** | 371 | **24.1% → 21.8%** | **−13%** | −16% |
| Territories | 29 | 1.5% → 1.0% | −33% | −32% |

States gaining the most national share: Texas (+1.0 point, +10% students), California (+1.0, +6%), Florida (+0.6,
+9%), then North Carolina, Georgia, Utah, South Carolina, Virginia. Losing the most: Michigan (−0.5, −17%),
Pennsylvania (−0.5, −14%), Puerto Rico (−0.4, −33%), Ohio (−0.4, −12%), Missouri (−0.4, −20%), Illinois, Minnesota,
Wisconsin, West Virginia (−25%), New York. This follows where 18-year-olds live: the Sun Belt's high-school classes
grew and the Midwest's shrank, and the data here can't separate a change in appetite from a change in population. The
page says so (rule 5) and sends readers to the [state pages](states.md), which show each state's own totals and medians
and, once built, which states gain first-years from other states (the flows addition specified there).

### Selectivity, as of fall 2014, and applications (campus-based)
| Group | Colleges | Share of students, then → now | Students | Share of applications, then → now |
|---|---|---|---|---|
| Under 25% admitted | 56 | 3.8% → 4.2% | +9% | 11.1% → 11.1% |
| 25–59% | 408 | 32.7% → 35.4% | +4% | 41.9% → 42.1% |
| 60% or more | 865 | 61.0% → 58.2% | −8% | 47.1% → 46.8% |
| No rate reported (open admission, mostly) | 83 | 2.6% → 2.2% | −20% | |

Applications rose 56% (8.9M → 13.9M over 1,303 colleges reporting both years) and their split by selectivity did not
move: the median college in every selectivity group got 39–56% more. By size they shifted to the biggest campuses
(20,000+: 25.9% → 29.4% of all applications; the median such college's applications rose 81%) and by control to
publics (56.3% → 60.1%). Appetite shows up in where students enroll and in where the extra applications went, not in
a flight to selectivity.

### Cost (1,290 campus-based colleges with average cost paid in both 2013–14 and 2023–24; after inflation)
Colleges in fifths by the real change in their average cost paid (`avg_paid_all`):

| Fifth | Range of real price change | Median enrollment change | Students | Grew at all |
|---|---|---|---|---|
| Cut price the most | −77% to −22% | **−20%** | −19% | 17% |
| | −22% to −15% | −15% | −8% | 25% |
| | −14% to −8% | −10% | −4% | 33% |
| | −8% to +1% | −1% | +4% | 48% |
| Held or raised price | +1% to +125% | 0% | +4% | 49% |

By 2013–14 price level, the priciest fifth ($39,000–$67,000 in 2023–24 dollars) grew (+5% students; 55% of them
grew) while every cheaper fifth shrank; the priciest publics (+11%, 65% grew) and the priciest privates (+7%, 67%
grew) most of all, and mid-priced privates ($30,000–$35,000) lost the most (median −18%). Colleges that shrank 10%+
cut what students pay by 13% (public) and 15% (private nonprofit) after inflation; colleges that grew 10%+ cut 3–4%.
The rank correlation between a college's real price change and its enrollment change over the decade is +0.26
(public +0.23, private +0.28).

**The students view of cost** (what the enrollment-weighted average student pays, 2023–24 dollars): publics $25,600
(2013–14) → $27,000 (2016–17) → $26,600 (2019–20) → $24,900 (2021–22) → $24,400 (2023–24); private nonprofits
$39,600 → $41,400 → $41,300 → $39,200 → $37,900. The ten-year "4.5% less after inflation" is entirely a post-2021
event: real prices rose, then held, through 2020–21 and fell when inflation outran stickers from 2021–22 on.

### The pandemic, and after (campus-based)
Campus-based undergraduates by fall, against fall 2019: +0.5% (2014) · +1.4% (2017, the peak) · 0 (2019) · −1.5% ·
−3.3% · **−4.8% (2022, the low)** · −4.5% · −3.2% (2024). The panel has recovered a third of what it lost.

Share of students by group at the period boundaries, with the pace of change in share (points per year) and the
change in students in each period:

| Group | Share 2014 · 2019 · 2022 · 2024 | Pace before · pandemic · after (pts/yr) | Students before · pandemic · after |
|---|---|---|---|
| **20,000+** (2014 size) | 30.2 · 32.1 · 33.7 · 34.4 | +0.39 · **+0.54** · +0.32 | +5.9% · **0.0%** · +3.7% |
| 10,000–19,999 | 24.8 · 24.9 · 24.6 · 24.5 | +0.03 · −0.12 · −0.05 | +0.1% · −6.2% · +1.3% |
| 2,000–9,999 | 35.7 · 34.1 · 33.0 · 32.6 | −0.31 · −0.37 · −0.20 | −4.8% · −7.9% · +0.5% |
| Under 2,000 | 9.3 · 8.8 · 8.7 · 8.5 | −0.10 · −0.05 · −0.06 | −6.0% · −6.4% · +0.2% |
| **R1** | 40.5 · 42.9 · 45.3 · 46.0 | +0.47 · **+0.81** · +0.34 | +5.4% · +0.6% · +3.3% |
| Not a research tier | 29.1 · 27.2 · 25.6 · 25.1 | −0.37 · −0.53 · −0.27 | −6.9% · −10.4% · −0.4% |
| Public | 72.0 · 72.6 · 72.6 · 72.9 | +0.11 · 0.00 · +0.14 | +0.3% · −4.8% · +2.1% |
| Private nonprofit | 28.0 · 27.4 · 27.4 · 27.1 | −0.11 · 0.00 · −0.14 | −2.4% · −4.8% · +0.7% |
| Southeast | 24.7 · 25.1 · 25.6 · 26.0 | +0.09 · +0.16 · +0.17 | +1.4% · −3.0% · +3.0% |
| Southwest | 9.9 · 10.4 · 10.7 · 10.9 | +0.10 · +0.11 · +0.11 | +4.4% · −1.7% · +3.8% |
| West | 17.8 · 18.7 · 18.8 · 18.7 | +0.18 · +0.04 · **−0.06** | +4.6% · −4.1% · +1.1% |
| Northeast | 22.2 · 21.9 · 21.8 · 21.6 | −0.06 · −0.03 · −0.10 | −1.7% · −5.2% · +0.8% |
| Midwest | 24.1 · 22.7 · 22.0 · 21.8 | −0.28 · −0.22 · **−0.09** | −6.2% · −7.6% · +0.9% |
| Under 25% admitted (2014) | 3.8 · 3.9 · 4.3 · 4.2 | +0.04 · +0.11 · **−0.01** | +4.5% · +3.0% · +1.0% |
| 25–59% | 32.7 · 34.0 · 35.1 · 35.4 | +0.28 · +0.36 · +0.12 | +3.8% · −1.8% · +2.4% |
| 60% or more | 61.0 · 59.7 · 58.4 · 58.2 | −0.26 · −0.42 · −0.09 | −2.6% · −6.8% · +1.4% |
| Town | 15.0 · 14.0 · 13.3 · 13.2 | −0.19 · −0.24 · −0.03 | −6.7% · −9.8% · +1.3% |

The college view by period (median change in undergraduates; share of colleges that grew; share back at their fall
2019 size by fall 2024):

| Group | Before | Pandemic | After | Back to 2019 size |
|---|---|---|---|---|
| All campus-based | | | | 33% |
| 20,000+ | +6.4% (78% grew) | +0.2% (51%) | +3.5% (79%) | **64%** |
| Under 2,000 | −4.0% (39%) | −7.7% (29%) | −0.2% (48%) | 34% |
| R1 | +4.2% (73%) | +0.9% (55%) | +2.9% (74%) | 66% |
| Not a research tier | −6.0% (34%) | −10.3% (22%) | −1.1% (45%) | 28% |
| Public | −2.6% (43%) | −9.3% (20%) | +0.7% (54%) | 31% |
| Private nonprofit | −3.2% (41%) | −6.7% (31%) | −0.1% (49%) | 36% |
| Midwest | −7.7% (29%) | −9.0% (23%) | −0.9% (45%) | 29% |
| Under 25% admitted | +2.3% (79%) | +3.6% (79%) | +0.7% (64%) | 77% |
| 60% or more | −5.4% (36%) | −9.9% (20%) | −0.1% (49%) | 29% |

Applications by group (1,293 colleges reporting in all four falls; 8.9M · 10.5M · 12.3M · 13.9M): R1 universities'
share 44.3% (2014) · 45.8% (2018) · **50.2% (2022)** · 49.3% (2024); 20,000+ campuses 26.0 · 27.3 · 29.6 · 29.5;
publics 56.4 · 57.3 · 58.7 · 60.3; the most selective 11.1 · 11.1 · 12.3 · 11.2. Price by period (median college,
after inflation): publics +3.2% before, −9.8% during, −2.0% after; privates +0.8%, −6.7%, −5.0%. Within a single
period the link between a college's price change and its enrollment change is weak (rank correlations +0.11, +0.15,
+0.05 at publics; +0.16, +0.02, −0.01 at privates): the +0.26 over the decade is a decade of the same colleges
discounting while they shrank, not a year-to-year response.

What stands out, to confirm before publishing:
- **Concentration is the story, and it's steady.** The 20,000+ share rose every year; the pandemic didn't bend it.
  The research-tier version (R1 +5.5 points) is the sharpest, and overlaps with size, setting (city) and selectivity,
  so the copy says so rather than presenting four findings.
- **The pandemic was an accelerant, not a turn.** In fall 2019 → 2022 the biggest campuses held their students (0.0%)
  and R1s grew (+0.6%) while every other size lost 6–8% and non-research colleges lost 10%; the pace of every shift
  rose. Publics and privates fell the same 4.8%, so the public share paused for three years and resumed after.
- **Since 2022 the shifts slowed to about their old pace, and nothing has reversed in enrollment.** The median college
  stopped shrinking (−0.1% to +1.5% per group, about half growing), but the recovery is where the growth was: 64% of
  20,000+ campuses and 66% of R1s are back at their 2019 size against 28–36% of everyone else. Three lines did flatten:
  the Midwest's share loss slowed from −0.28 to −0.09 points a year, town campuses' from −0.24 to −0.03, and the most
  selective colleges' share stopped rising after 2022 (−0.01). The West's share is now slipping (−0.06) after a decade
  of gains. The copy must call these what they are: a slower loss or a flat line, not a recovery.
- **The one true reversal is in applications**, not students: R1 universities' share of all applications peaked at
  50.2% in fall 2022 (the test-optional surge) and eased to 49.3%; the most selective colleges' from 12.3% to 11.2%.
  Publics' share kept rising.
- **Online absorbed the privates' loss.** Without the campus-based cut, the reading would be "private nonprofits held
  their share", which is wrong. The by-kind table goes first so readers see why the rest excludes online colleges.
- **Price moved with enrollment, not against it.** The colleges that cut prices most lost the most students; the
  priciest fifth grew. Study 4 saw the same thing from the price side (discounting deepened where enrollment fell).
  Rule 5 governs the copy: price "moved with" enrollment, colleges losing students discounted more; never that price
  caused enrollment or the reverse. And the students view says the real fall in price is a post-2021 inflation story.
- **Geography is demographics first.** Say it, and link the state pages rather than ranking states.
- **Applications spread, enrollment concentrated.** Applications per college rose everywhere, so selectivity shares
  didn't move; the shift is in enrollment and in applications to large publics.

## What readers see (`/trends/where-students-go`)
1. **Headline tiles**: "34% of campus-based undergraduates attend a college with 20,000 or more students, up from 30%
   ten years ago", with the yearly share line as the sparkline; and "46% attend a research university (R1), up from
   40%".
2. **By kind**: one stacked bar then and one now (campus-based · online-first · for-profit), so the exclusion is
   visible, with one sentence on why the rest of the page is campus-based.
3. **Share-shift bars**: for each grouping (size, research tier, public or private, region, setting, selectivity),
   one paired bar per group: share then → share now, the point change labeled, the standard grouping switch, one
   scale. The students view only; the Colleges view is Study 3, linked at the top of the section.
4. **The concentration line**: share of students at the 50 and 100 biggest campuses, by fall (two lines).
5. **What the pandemic did, and what came after**: the campus-based total by fall against fall 2019 as a small line
   with the pandemic falls shaded (`TrendLine`'s event marker, hub rule 6); then, for the grouping the switch selects,
   each group's yearly share line on one scale, and under it a **pace strip**: three small bars per group (before ·
   pandemic · after, in share points per year), so an acceleration reads as a taller middle bar and a reversal would
   read as a bar that flips sign, with the after period's length in the axis label ("after: 2 falls"). A third row
   shows the share of each group's colleges back at their 2019 size. Copy as in the bullets above.
6. **By state**: `StateTileMap` colored by the change in each state's share of campus-based undergraduates (diverging
   scale, in points), the state's total change in the tooltip, each tile linking to `/trends/states/{state}`. One
   sentence under it on high-school demographics (rule 5), and a link to the state pages' flows block once built.
7. **Applications**: share of applications by size, research tier, and control at the four falls the data allows,
   as small lines, with "applications per college rose everywhere; where they rose most" and the 2022 peak named.
8. **Price moved with enrollment**: a Colleges / Students switch (hub rule 2). *Colleges*: five bars, one per fifth of
   colleges by real change in average cost paid, each bar the fifth's total enrollment change (median change and
   share that grew in the tooltip); a second small panel by 2013–14 price level; a public/private switch. *Students*:
   what the average student pays by academic year, after inflation, publics and private nonprofits as two lines, the
   pandemic years shaded, with the sentence that the fall is post-2021. Copy as above, with the Study 4 link and the
   within-period caveat.
9. **Takeaway**, **method note** (the panel; the campus-based cut and why; classified-then with the today-classified
   figure; the three periods and how the low point is found; the 300 floor; colleges that closed aren't in a fixed
   panel, so the small-college decline is understated; money after inflation; applications' missing falls), and links:
   Study 3, Study 4, `/trends/states`, the Movers' "Grew the most", Explore sorted by `size_change`.

## Computation
- `where-students-go.json` (`StudyFile<WhereStudentsGoValues>` plus the extras): per grouping and group `share:
  ThenNow`, `totalChange`, `medianChange`, `grewShare`, `n`, the yearly share line, and per period `{ from, to,
  studentsChange, pacePerYear, medianChange, grewShare }` plus `backToPrePandemic`; the campus-based total by fall;
  the yearly share lines for the top 50 and 100; the by-kind rows; the state table (share then/now, points, total
  change); the applications companion (shares by size, research tier, and control at the reporting falls); the cost
  fifths by control (`{ lo, hi, medianChange, totalChange, grewShare, n }[]`, once by change and once by level), the
  within-period correlations, and the students view line (weighted average paid by academic year, by control).
- **Periods**: `periods(totals, prePandemicFall, newest)` in the builder: before = `[from, PRE_PANDEMIC_FALL]`
  (the constant in `scripts/history/build.mts`, shared with Home fact 3 and Study 2), pandemic = `[PRE_PANDEMIC_FALL,
  low]` where `low` is the fall with the smallest campus-based total after it, after = `[low, to]`. No fall is typed
  in page code; labels come from the file's years through `historyYearLabel`. Pace = (share at end − share at start)
  × 100 ÷ years.
- **Classified then**: a grouping variant that reads the window start from history. Add `ofThen?: (m: Member, year:
  number) => string[]` to `Grouping` for `size` and `selectivity` in `lib/trend-groups.ts` (from `at(m, "undergrads",
  year)` and `at(m, "acceptance_rate", year)`, same boundaries), and `byGroupThen(ms, grouping, year, compute)` in
  `lib/trend-panel.ts`, which falls back to `of` for groupings without `ofThen`. The size scale with a 20,000+ split
  (`size4`: under 2,000 · 2,000–9,999 · 10,000–19,999 · 20,000+) is this study's own grouping; the standard `size`
  stays as it is for the other studies.
- **Campus-based**: the movers' exclusion reader (`lib/movers.ts`: `online-first.json`, for-profit status,
  `excluded-campuses.json` with its `before` year checked against the window start). When `online_share` exists, the
  rule becomes "more than 50% exclusively online at the window start" from the series, and the list is retired.
- Shares use each fall's reporting panel (`reporting(ms, ok)`, null under 90% coverage), as the sparklines do; the
  pandemic low point is found over falls that clear that rule.
- Test: recompute the by-kind row and the 20,000+ share then and now from the shards without the helpers; assert that
  no online-first, for-profit, or merged college is in the campus-based panel; that a college that crossed 20,000
  inside the window is counted in its fall 2014 group; that each cost fifth holds n ÷ 5 (±1) colleges; that the three
  periods tile the window exactly and the pandemic period starts at `PRE_PANDEMIC_FALL`; and that the pace figures
  equal the share difference over the period length.

## Data work needed
- `demographics.online_share` and the `online_share` history series ([online-share.md](../data-expansion/online-share.md)),
  so "campus-based" is a stored field evaluated at the window start (a college that went online-first after 2014 is
  campus-based *then*). Until it exists the movers' reviewed lists stand in, as they do for the growth lists, and the
  method note names them.
- Nothing else: every series exists.

## Decisions (2026-10-05)
1. **Ten-year view, with the pandemic as a question inside it**, not a five-year toggle: the three periods and the
   pace strip above. The yearly lines already show the pandemic didn't bend the trend; the periods make "is it
   reversing?" answerable each release (the after period lengthens by one fall at a time).
2. **The students view of cost** is in: the Colleges / Students switch in section 8.
3. **Net first-year flows between states** are built with this study, as a states-map measure and a state-page block,
   specified in [states.md](states.md) ("Planned addition").

## Open questions
1. **High-school graduate projections** (WICHE's "Knocking at the College Door") to separate demographics from appetite
   in the state section: a new external source with its own license. Recommendation: as in [states.md](states.md),
   not now; note it for the high-school-data work.
2. **Reporting the after period while it is two falls long.** Two falls of recovery can't settle "reversing"; the
   pace strip labels the length, and the takeaway says "so far". Recommendation: when the after period reaches four
   falls, the test that flags headline moves (hub open question 2) should also flag any group whose after pace has
   the opposite sign from its before pace, so the copy gets rewritten rather than quietly going stale.
