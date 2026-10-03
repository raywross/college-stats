# Study 3: Shrinking Colleges

> Status: **planned** (not built). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md), which holds the study template and rules). First look computed 2026-10-03 from the
> committed history.

**Question.** How many colleges are smaller than they were ten years ago, by how much, and which kinds grew instead?

**Why it's interesting.** The national undergraduate total barely moved over ten years (−1% across the panel), which
hides the real story: **half of four-year colleges lost at least a tenth of their undergraduates**, while large,
selective, and research universities grew. Students concentrated. The site's trend indicators already flag each
college's size direction; this study shows that "down" is the median experience, and where.

## Data
| Series | Years | Used for |
|---|---|---|
| `undergrads` (College Scorecard `student.size`, IPEDS fall enrollment) | Fall 1996 on (gap at fall 2000) | The measure |
| `applicants`, `enrolled` | Fall 2001 on | Companion: did shrinking colleges lose applicants, or yield? |
| `part_time_share` | Fall 1996 on | Whether part-time students explain declines (secondary) |

**Panel.** Colleges with 300+ undergraduates in both fall 2014 and the newest fall: 1,537 colleges. The 300 floor
follows the "no percent change on tiny bases" rule in [trends-design.md](../trends-design.md). Groups use today's
classification (hub rule 3), and the method note says so: a college that fell below 2,000 counts as "under 2,000" at
both ends, which makes the small-college decline look slightly larger than a then-classification would.

**Measures per group** (the study shows both, labeled, per hub rule 2):
- *Share of colleges* that shrank by 10% or more, and that grew by 10% or more.
- *Median college's change.*
- *Total students' change* (enrollment-weighted: "how many students does this affect?").

## First look (2026-10-03, fall 2014 → fall 2024)
| Group | Colleges | Shrank 10%+ | Grew 10%+ | Median college | Total students |
|---|---|---|---|---|---|
| **All** | 1,537 | **51%** | 23% | **−10%** | −1% |
| Northeast | 419 | 49% | 20% | −9% | +3% |
| Midwest | 392 | **62%** | 15% | **−16%** | −13% |
| Southeast | 388 | 46% | 29% | −6% | +3% |
| West | 187 | 42% | 31% | −4% | +4% |
| Southwest | 119 | 41% | 35% | −2% | +3% |
| Territories | 32 | 91% | 0% | −33% | −39% |
| Public | 567 | 53% | 24% | −12% | −2% |
| Private nonprofit | 920 | 51% | 21% | −10% | 0% |
| For-profit | 50 | 32% | 48% | +8% | −5% |
| Under 2,000 undergrads | 734 | 62% | 16% | −18% | −22% |
| 2,000–9,999 | 590 | 49% | 24% | −9% | −12% |
| 10,000+ | 213 | 19% | 47% | **+8%** | +10% |
| Under 25% admitted | 83 | 2% | 39% | +6% | +12% |
| 25–59% admitted | 242 | 38% | 33% | −1% | +8% |
| 60% or more | 1,064 | 57% | 19% | −14% | −4% |
| City | 765 | 47% | 27% | −7% | 0% |
| Suburb | 349 | 49% | 24% | −9% | +5% |
| Town | 303 | 61% | 15% | −16% | −14% |
| Rural | 120 | 60% | 19% | −17% | −9% |
| R1 universities | 181 | 14% | 49% | +10% | +10% |
| R2 | 126 | 34% | 28% | −2% | −3% |
| D-I FBS members | 135 | 22% | 44% | +7% | +8% |
| D-III members | 414 | 56% | 14% | −14% | −11% |
| HBCUs | 75 | | | −12% | |
| HSIs | 254 | | | −11% | |
| Women's colleges | 28 | too few | | | |

Share of the panel smaller than in fall 2014, by year: 53% (2015) · 53% · 55% · 55% · 56% (2019) · 62% (2020) · 64% ·
67% (2022) · 65% · 64% (2024). Two thirds of colleges were below their 2014 size at the 2022 low; a third of those
have not recovered.

What stands out, to confirm before publishing:
- **The Midwest, small colleges, towns, and the least selective colleges shrank most**; these overlap heavily, and the
  copy should say so rather than present four separate findings.
- **Growth went to the big and selective**: R1s +10%, FBS members +7%, the most selective +6% at the median, with
  almost none of them shrinking 10%+.
- **For-profits grew at the median but shrank in total**: a few large closures (DeVry campuses) against many small
  gains. Good example of why both measures appear.
- **Territories** (Puerto Rico) lost a third: shown, with the 30-college floor just met (32).

## What readers see (`/trends/shrinking-colleges`)
1. **Headline tile**: "51% of colleges have at least 10% fewer undergraduates than ten years ago" with the share-below-2014
   line (the by-year series above) as the sparkline.
2. **National distribution**: a histogram of ten-year change across the panel (bins of 10 points), the median marked,
   so readers see how wide the spread is.
3. **Small multiples**: share shrank 10%+ vs grew 10%+ as paired bars per group, for region, type, size, selectivity,
   then setting and research tier from the additional groupings. One scale.
4. **Students, not colleges**: the total-students change per group as a second view (segmented control: *Colleges* /
   *Students*), making the concentration point.
5. **Companion**: applicants vs enrolled first-years at shrinking colleges: did they get fewer applications, or admit
   the same and enroll fewer? Two median lines, fixed panel of colleges that shrank 10%+.
6. **Takeaway**, **method note** (300 floor, today's classification, panel size), and links: Explore sorted by
   `size_change` (exists), the Movers page's "Shrank the most" and "Grew the most" lists
   ([top-10-lists.md](top-10-lists.md)), and each state's page ([states.md](states.md)).

## Computation
- `studies.json` entry `shrinking-colleges`: per group, shares shrank/grew, median change, total change, the yearly
  share-below-start, and the histogram bins; plus the companion lines. All from the hub's breakdown machinery over
  `undergrads`.
- Test: recompute the national row from committed shards; assert the panel excludes colleges under 300 at either end
  and that total-students change uses the same panel as the shares.

## Data work needed
None: every series exists. If the top-10 lists' online-share field is built, this study should offer "campus-based
colleges only" as a method toggle, since online growth at a few colleges inflates the for-profit and 10,000+ rows.

## Open questions
1. Five-year view (fall 2019 → 2024) as a second window? It isolates the pandemic drop and partial recovery.
   Recommendation: yes, as the same segmented control the Movers page uses.
2. Should the study separate **first-year class size** (`enrolled`) from total undergraduates? A college can shrink
   because of retention, not recruitment. Recommendation: the companion chart covers it; no separate breakdown.
