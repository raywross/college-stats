# Study 4: The Price Gap, by Who Is Discounting

> Status: **planned** (not built). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md), which holds the study template and rules). First look computed 2026-10-03 from the
> committed history.

**Question.** Full prices held steady after inflation over ten years while what students actually paid fell. Where did
that happen, and where didn't it?

**Why it's interesting.** Home fact 1 already says the headline: full price about flat, average paid down 12% after
inflation (fixed panel of 1,432 colleges). The interesting part is the spread. The most selective colleges raised full
price 8% after inflation and what students paid did not fall; small private colleges cut what students pay by 13% and
now discount nearly half the sticker. For a family, "college got cheaper" is true or false depending entirely on which
colleges they are looking at. This study is the site's cost story told by group, and the natural landing page for the
"sticker price isn't what people pay" idea the glossary explains.

## Data
| Series | Years | Used for |
|---|---|---|
| `full_price` (tuition and fees, books, room and board, other; residency-weighted for publics) | 2000–01 on (publics from 2001–02) | The sticker |
| `avg_paid_all` (average total cost, all students, same-year inputs) | 2008–09 on | What students pay on average |
| `aid_generosity`, `grant_pct`, `grant_avg` | 2008–09 / 2007–08 on | Why the gap moved: more students with grants, or bigger grants |
| `net_price_income_1`–`5` | 2008–09 on | Who the discount reached (by family income band) |
| CPI-U school-year averages (`data/history/cpi.json`) | | All money after inflation, as everywhere on the site |

**Panel.** Colleges with both `full_price` and `avg_paid_all` in 2013–14 and the newest academic year: 1,432 colleges,
the same panel as Home fact 1, so the two agree to the number. Money in the newest year's dollars.

**Measures per group:** median college's change in full price and in average paid, both after inflation; the median
**discount** (1 − average paid ÷ full price) then and now; the median dollars paid now.

## First look (2026-10-03, 2013–14 → 2023–24, after inflation, median college)
| Group | Colleges | Full price | Average paid | Discount then → now | Paid now |
|---|---|---|---|---|---|
| **All** | 1,432 | +1% | **−11%** | 34% → 41% | $24,600 |
| Northeast | 400 | +1% | −12% | 33% → 40% | $28,900 |
| Midwest | 376 | +2% | −14% | 38% → 46% | $23,800 |
| Southeast | 370 | 0% | −10% | 36% → 40% | $21,700 |
| West | 174 | +3% | −8% | 29% → 33% | $28,700 |
| Southwest | 106 | +2% | −8% | 32% → 40% | $20,700 |
| Private nonprofit | 934 | +3% | −11% | 39% → **47%** | $26,800 |
| Public | 490 | −2% | −11% | 23% → 30% | $20,200 |
| Under 2,000 undergrads | 713 | +1% | −13% | 40% → 47% | $24,300 |
| 2,000–9,999 | 521 | +2% | −11% | 30% → 37% | $25,200 |
| 10,000+ | 198 | 0% | −6% | 23% → 29% | $25,300 |
| Under 25% admitted | 81 | **+8%** | **0%** | 31% → 36% | **$51,300** |
| 25–59% admitted | 234 | +2% | −9% | 34% → 39% | $28,100 |
| 60% or more | 1,021 | +1% | −12% | 35% → 42% | $24,200 |
| Town | 293 | 0% | −14% | 34% → 42% | $21,400 |
| D-III members | 396 | +3% | −14% | 39% → 48% | $27,300 |
| D-I FBS members | 132 | +2% | −3% | 23% → 29% | $27,100 |
| R1 universities | 175 | +3% | −4% | 25% → 30% | $30,700 |

What stands out, to confirm before publishing:
- **Discounting deepened everywhere, most where enrollment fell** (Study 3's groups: Midwest, small, town, D-III).
  The two studies should link to each other; the copy must not say one caused the other.
- **The most selective colleges are the exception**: full price up 8%, average paid flat, and the highest dollars paid
  by far. Their discount still rose (31% → 36%) because the sticker rose.
- **Publics cut full price slightly** (−2%) and discount far less (30%): a different mechanism (state appropriations
  and in-state tuition) that the method note should mention as context without attributing.
- Check the income-band view before publishing: did the fall in average paid reach the lowest bands, or is it
  concentrated in merit aid to higher bands? `net_price_income_1` vs `_5` per group answers it.

## What readers see (`/trends/price-gap`)
1. **National chart**: two indexed lines (full price, average paid; 2013–14 = 100), the same chart Home fact 1 uses,
   now with the discount as a third, labeled series on its own small panel below.
2. **Small multiples**: the paired indexed lines per group, same scale, for region, type, size, selectivity, then
   setting and research tier.
3. **Who pays what now**: a dot-and-range strip of median average paid per group in today's dollars, so "+8% at the
   most selective" sits next to "$51,300".
4. **Why the gap moved**: per group, the change in the share of first-years with grants and in the average grant
   (both after inflation), as two small bars: more students aided, or bigger awards.
5. **Did it reach lower-income families**: a dumbbell per income band of the median net price then → now, national
   and for the two types.
6. **Takeaway**, **method note** (same-year inputs, residency weighting for publics, CPI basis, panel size), and links:
   Explore sorted by `avg_cost_change` and `aid_generosity` (exist), the glossary's `average-cost`,
   `cost-of-attendance`, `inflation-adjusted`, and the Movers lists "Students pay much less / much more"
   ([top-10-lists.md](top-10-lists.md)).

## Computation
- `studies.json` entry `price-gap`: per group, the indexed lines, discount then/now, median paid, grant-share and
  grant-size changes, and net price by band then/now. Reuses `priceGap()` from the history build for the national row
  (the test asserts equality with `facts.json`).
- Test: recompute one group (publics) from committed shards and CPI; assert every money figure is converted with the
  stored CPI table and the newest-year basis.

## Data work needed
None. If 2024–25 sticker prices land first ([backlog](../backlog.md)), the window moves with the rest of the price
series and CI's latest-point check keeps the headline and the study in step.

## Open questions
1. Should the study show **tuition resets** (colleges that cut the sticker outright) as a named list? They are a
   recognizable story (Bridgewater, Albion, Georgetown College in the first look). Recommendation: a short list from the
   Movers rules, under the national chart, with each college's note of the year the sticker fell.
2. For publics, split in-state and out-of-state full price (`sticker_in_state`, `sticker_out_of_state`)? The
   residency-weighted figure is right for the national story; the split belongs on Study 5's page.
