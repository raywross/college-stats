# Cost to a Degree (IPEDS OM + prices)

> Status: **idea** (2026-10-03). Needs only built data ([time-to-degree.md](../data-expansion/time-to-degree.md),
> prices, and history); the family version waits for [net-price-estimator.md](../product/net-price-estimator.md).
> Part of [ideas](README.md).

## Question it answers
*What does the degree cost here, not one year of it?* Every price on every site is a one-year figure, and every family
multiplies it by four. At most colleges fewer than half of first-time students finish in four years; a fifth year costs
as much as the first, and some leave with debt and no degree. Neither CollegeIQ nor College Kickstart shows anything
beyond one year.

## Why it's fresh
Edmunds' True Cost to Own turned a sticker price into a five-year total with stated assumptions and called itself "a
comparative tool, not a predictive tool". The college version uses figures the site already has: the share of a class
that earned an award within 4, 6 and 8 years (OM, built with wave 2), the college's own ten-year price trend
(history), and the median debt of those who left. It is comparative: every college's figure uses the same rules, so
the ordering is fair even where the dollars are not a quote.

## Measures
Derived fields registered in `lib/fields.ts` and computed at sync, so every figure is cited like any other.

| Field | Formula | Reads as |
|---|---|---|
| `cost.to_degree.four_years` | Average paid (all students) for years 1 to 4, each projected with the college's own ten-year price trend, capped at the national rate | "The four-year plan" |
| `cost.to_degree.typical` | The same price series over the **typical years to a degree**: 4 for the share finishing by year 4, 6 for the share finishing in years 5 to 6, 8 for years 7 to 8, weighted and divided by the share finishing by year 8 | "What finishing here typically costs" |
| `cost.to_degree.not_finishing_share` | 1 − the 8-year award share | "Left without a degree within 8 years" (includes students who transferred and finished elsewhere) |
| `cost.to_degree.left_with_debt` | College Scorecard's median debt of students who withdrew (`WDRAW_DEBT_MDN`) | "Median debt of those who left" (not in the sync today, checked 2026-10-03: one Scorecard field to add) |

Counting years 5 and 6 as 6, and 7 and 8 as 8, overstates slightly and is stated as the assumption. The first-time,
full-time cohort is the headline because it matches the price's cohort; the transfer-in and part-time cohorts OM also
reports are in the popover.

## Display
- **Cost page**: a "Cost to a degree" block with three rows: the four-year plan; typical here ("62% finish in four
  years, 83% by six"); and "17% leave without a degree within eight years; median debt among those who withdrew
  $9,500". A stacked bar: four years, then the extra years in a lighter tint.
- **Compare**: a row. **Explore**: a sort and a table column, "cost to a degree (typical)".
- **Guide**: "Four years means four" ([guides.md](guides.md)).
- **Home**: a fact once the national median is computed: "At the median college, the typical degree costs 1.3× the
  four-year plan" (the number to be measured, not assumed).
- **Family version** (Pro, in the estimator): the family's price range replaces average paid; the "getting home" line
  from [near-and-far.md](near-and-far.md) is added; the four-year projection gains a row "if it takes the typical time
  here".
- **Glossary**: `cost-to-a-degree`, `time-to-degree`.

## Caveats shown every time
Comparative, not predictive. The OM shares describe a class that entered about eight years ago; the prices are
today's. A student who transfers and finishes elsewhere counts as not finishing here. A student's own time to a degree
depends on credits brought in, major changes, and money, none of which the figure knows.

## Tier
Free on profiles, Compare, and Explore. The family version with Pro.

## Complexity
Small: arithmetic on fields the site already has, a cost block, a Compare row, and an Explore sort.

## Open questions
1. The median debt of students who withdrew is one Scorecard field to add to the sync
   ([loans-and-repayment.md](../data-expansion/loans-and-repayment.md) is where it belongs); the block can ship
   without that line and gain it later.
2. Should the typical figure use the all-students average paid or the aided-students net price? Average paid, to
   match the rest of the Cost page; the family version uses the family's own range anyway.
