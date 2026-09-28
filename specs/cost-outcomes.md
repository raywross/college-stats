# Cost & Outcomes

What college costs and what it leads to, from the College Scorecard (synced by `npm run sync-data`).

## Data (`School.cost`, `School.outcomes`)
| Field | Scorecard source | Notes |
|---|---|---|
| `cost.avg_net_price` | `latest.cost.avg_net_price.overall` | Students receiving **federal (Title IV)** aid, a lower-income-skewed group. Stored but not shown; see average cost below |
| `cost.net_price_by_income` | `latest.cost.net_price.{public\|private}.by_income_level.*` | Federal-aid recipients, 5 bands: $0–30K, $30–48K, $48–75K, $75–110K, $110K+. The sector matching the school's type is used. Year detected at sync (`meta.scorecardCostYear`, e.g. 2023–24) |
| `cost.cost_of_attendance` | `latest.cost.attendance.academic_year` | Sticker price |
| `cost.tuition_in_state` / `_out_of_state` | `latest.cost.tuition.*` | Stored, not yet shown |
| `outcomes.median_earnings_10yr` / `_6yr` | `latest.earnings.{10,6}_yrs_after_entry.median` | Federal aid recipients, whether or not they graduated |
| `outcomes.graduation_rate` | `latest.completion.consumer_rate` (fallback `completion_rate_4yr_150nt`) | Within 150% of normal time |
| `outcomes.retention_rate` | `latest.student.retention_rate.four_year.full_time` | |
| `outcomes.median_debt` / `monthly_loan_payment` | `latest.aid.median_debt.completers.*` | Federal loans only; 10-year standard plan |

Coverage (Sept 2026 sync): net price 1,741 · earnings 1,762 · graduation rate 1,853 of 1,893 colleges.

## Aid (`School.aid`, IPEDS SFA; `aid.cds` from a Common Data Set)
Share of full-time first-years with any aid, grants (with average), institutional grants, Pell, state grants, and
loans; federal-aid recipients and average grant by the same five income bands. CDS section H adds share with need,
percent of need met, average need-based grant and package, and merit aid for students without need. Shown in the
profile's **Who actually gets aid** panel (`AidBreakdown`) and in Compare (grants metrics + table rows).

## Average cost, all students (the headline)
Published net prices only cover aided students, so they understate what a typical student pays. We estimate it from
**same-year IPEDS data** (the SFA year, currently 2022–23, with the matching `IC{year}_AY` file):

```
sticker[rate]  = tuition & fees[rate] + books + on-campus room & board + other expenses   (IC: CHG1/2/3AY3, CHG4–6AY3)
avg sticker    = Σ share of first-years paying each rate × sticker[rate]                    (SFA: SCFA11P/12P/13P)
avg paid (all) = avg sticker − total grant dollars ÷ first-years                          (SFA: AGRNT_T ÷ SCUGFFN)
               = (total full price paid by everyone − total grants) ÷ number of first-years
```
Students without grants count at the full sticker price. Private colleges have one rate. Stored as
`cost.avg_paid_all` along with `sticker`, `tuition_fees`, and `residency` (in-district / in-state / out-of-state),
`aided_net_price` (SFA `NPIST2` for publics, meaning in-state students, or `NPGRN2` for privates), and `year`.
Coverage: 1,511 colleges. Caveats (shown on the page): it assumes on-campus living, and loans aren't subtracted.
Validated on Vanderbilt: sticker $84,412 − average grant $57,723 = $26,689, exactly IPEDS's aided net price; and
(1,617 × $84,412 − $61,417,367) ÷ 1,617 = $46,430. Falls back to share × average grant only when counts are missing.
Uses exact counts (grant share = AGRNT_N ÷ SCUGFFN), not the published whole-number percent.

**Don't reconstruct the average from the income table alone.** It covers only students who received federal aid
(Vanderbilt: 583 of 1,617). Another 495 got grants without federal aid (college need-based or merit aid). The aid
panel shows the whole class split three ways (federal aid + grants / grants without federal aid / no grants) above
the income table, so the table isn't mistaken for everyone.

The sync also stores `cost.components` (books, room & board, other) and `cost.breakdown`: residency-averaged tuition
& fees, each living-cost item, `full_price`, and `grant_per_student`, each rounded before computing
`avg_paid_all = full_price − grant_per_student`, so the on-page breakdown adds up exactly.

Headline wording: "Average total cost per year, all first-years (est.)", with "Tuition, housing, food, books & other
expenses, after grants" beneath. `CostBreakdown` draws it as a small waterfall on one scale: full price stacked by
tuition & fees / room & board / books & supplies / other expenses (`--cost-1..4`, the validated adjacent order), minus
the average grant per student (hatched outline), equals the average total cost (neutral ink, so it isn't mistaken for
a cost item). A legend lists each amount.

Shown by `WhatStudentsPay` (profile): the headline estimate vs. the national median; who pays what (grant recipients'
average net price vs. the full sticker price, with shares); and for publics, a **sticker price by residency** table
(tuition & fees, full cost, share of first-years for each rate).

## Metrics (`lib/metrics.ts`)
`avgCost` (all students; used for Explore sort/filter `avg_cost` + `minCost`/`maxCost`, card meter, table, the
cost-vs-earnings chart, leaderboards, badges, and key differences), `netPrice` (grant recipients, same year),
`earnings`, `gradRate`, `debt`, all in the **value** domain (`--d-value`, amber). `paybackYears(s)` = 4 × average
cost ÷ median earnings: a deliberately rough comparison, explained by the `payback` glossary term.

## Where it appears
- **Profile**: "Cost & outcomes" section. It covers net price by family income (`NetPriceByIncome`); net price vs.
  the national median; sticker price vs. what students pay ("grants cover X%"); median debt, monthly payment, and
  payback; earnings `DistributionStrip`; earnings at 6 vs. 10 years; retention and graduation rings; and a
  cost-vs-earnings `ScatterPlot` with the school highlighted. The overview bento gains net price, earnings, and
  graduation tiles. Takeaways come from `costTakeaway` / `outcomesTakeaway`.
- **Explore**: net price meter on cards; net price, earnings, and grad rate table columns; sorts `net_price`
  (lowest first), `earnings`, `grad_rate`; net price range filter (`minNP`/`maxNP`, $0–80K); chart view tab
  `chart=value`.
- **Compare**: "Cost & outcomes" group (net price, earnings, graduation, median debt), `NetPriceCompare` (each
  income band, one bar per school), new rows in "All the numbers", new key differences ("X costs $3.3K less per
  year than Y").
- **Home**: "Is it worth it?" cost-vs-earnings scatter (shaded corner = below-median price, above-median
  earnings), with "Highest earnings" and "Lowest net price" leaderboards; a "Low cost, high earnings" lens
  (`maxNP=20000&sortBy=earnings`).
- **Badges**: Great value (net price in the cheapest quarter and earnings in the top quarter), High earners, Low
  net price, High graduation rate.

## Clarity on "average net price"
Labeled "(students with grants)"; a note gives the share who received grants (with its own survey year) and the
sticker price that families without grants face. Profiles link to each college's official net price calculator
(`school.links.price_calculator`, from Scorecard).

## Caveats shown to users (glossary)
Net price is an average for aided students; each college's net price calculator is the real estimate. Earnings
reflect majors, location, and who enrolls, not just the college. Median debt excludes private and parent loans.
