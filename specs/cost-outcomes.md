# Cost & Outcomes

What college costs and what it leads to, from the College Scorecard (synced by `npm run sync-data`).

## Data (`School.cost`, `School.outcomes`)
| Field | Scorecard source | Notes |
|---|---|---|
| `cost.avg_net_price` | `latest.cost.avg_net_price.overall` | Per year, first-time full-time students receiving grant aid |
| `cost.net_price_by_income` | `latest.cost.net_price.{public\|private}.by_income_level.*` | 5 bands: $0–30K, $30–48K, $48–75K, $75–110K, $110K+. The sector matching the school's type is used |
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

## Metrics (`lib/metrics.ts`)
`netPrice`, `earnings`, `gradRate`, `debt` in the new **value** domain (`--d-value`, amber). `paybackYears(s)` =
4 × net price ÷ median earnings: a deliberately rough comparison, explained by the `payback` glossary term.

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
