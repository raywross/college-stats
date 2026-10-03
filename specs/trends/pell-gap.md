# Study 6: The Pell Graduation Gap

> Status: **planned** (not built). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md), which holds the study template and rules). First look computed 2026-10-03 from the
> committed history; the underlying data was built 2026-10-02
> ([graduation-by-group.md](../data-expansion/graduation-by-group.md)).

**Question.** Do students with Pell Grants graduate at the same rate as classmates who had neither a Pell Grant nor a
subsidized loan, has the gap changed, and where is it widest?

**Why it's interesting.** The profile already shows each college's Pell graduation gap and Explore sorts by it. The
national picture: at the median college, Pell recipients from the entering class of 2010 graduated within six years 9
points less often than peers with neither; for the class of 2018 the gap was 11 points. Pell graduation rates
themselves barely moved (51% → 52%) while everyone else's rose. The gap is smallest at the most selective colleges (2–4
points) and widest, and widening fastest, at colleges in towns (10 → 14 points) and in the Midwest (13 → 14).

## Data
| Series | Years | Used for |
|---|---|---|
| `grad_rate_pell` (IPEDS GR Pell/SSL file: Pell recipients' 150%-time completion, bachelor's-seeking) | Entering fall 2010 on | Pell graduation rate |
| `grad_rate_no_pell_no_loan` | Entering fall 2010 on | The comparison group (neither Pell nor a subsidized loan) |
| `grad_cohort_pell`, `grad_cohort_no_pell_no_loan` | Entering fall 2010 on | Class sizes: floors and weighting |
| `grad_rate` | Entering ~1997 on | Context line: the overall rate |
| `om_award_pell`, `om_award_non_pell` (8-year, all entering students) | Entering fall 2009 on | Companion: the gap when part-time and transfer students are included |

Rates are stored by **entering class** (year kind `cohort`), labeled "class entering fall 2018" and never "2024", as the
profile does. The GR file nulls rates for groups under 30 students; the history keeps class sizes so the study can
apply its own floor.

**Panel.** Colleges with both rates for the entering classes of 2010 and the newest (2018 today) and at least 50
students in each group in both years: 1,255 colleges. Groups: the standard four, plus setting, division, and research
tier from the additional groupings.

**Measures per group:** median Pell graduation rate then and now; median gap (non-Pell-non-loan minus Pell) then and
now; the share of colleges where the gap is 10+ points; and the student-weighted gap (sum of graduates ÷ sum of
cohorts, each group) as the "students" view.

## First look (2026-10-03, entering classes of fall 2010 → fall 2018, median college)
| Group | Colleges | Pell graduation rate | Gap, points |
|---|---|---|---|
| **All** | 1,255 | 51% → 52% | **8.9 → 10.9** |
| Northeast | 355 | 58% → 58% | 7.3 → 7.8 |
| Midwest | 331 | 50% → 52% | **13.1 → 14.4** |
| Southeast | 309 | 45% → 46% | 9.9 → 12.3 |
| West | 151 | 56% → 57% | 6.2 → 7.9 |
| Southwest | 91 | 39% → 44% | 10.5 → 10.6 |
| Private nonprofit | 717 | 57% → 57% | 8.6 → 10.8 |
| Public | 524 | 45% → 46% | 9.0 → 11.3 |
| Under 2,000 undergrads | 494 | 49% → 48% | 10.2 → 12.0 |
| 2,000–9,999 | 550 | 51% → 51% | 8.8 → 10.8 |
| 10,000+ | 211 | 56% → 59% | 7.6 → 8.8 |
| Under 25% admitted | 72 | 89% → 90% | **3.9 → 2.5** |
| 25–59% admitted | 188 | 63% → 63% | 6.1 → 7.5 |
| 60% or more | 927 | 50% → 50% | 10.2 → 12.2 |
| City | 608 | 53% → 55% | 8.5 → 10.0 |
| Suburb | 285 | 55% → 57% | 8.3 → 9.3 |
| Town | 275 | 46% → 45% | **10.5 → 14.4** |
| Rural | 87 | 42% → 42% | 7.7 → 12.3 |
| R1 universities | 174 | 68% → 70% | 7.4 → 7.9 |
| R2 | 118 | 46% → 52% | 8.3 → 10.0 |
| D-I FBS members | 133 | 58% → 64% | 9.5 → 11.5 |
| D-III members | 373 | 59% → 58% | 7.7 → 9.6 |

What stands out, to confirm before publishing:
- **The gap widened almost everywhere** because non-Pell rates rose and Pell rates did not; the one group where it
  narrowed is the most selective (and the gap there was already small).
- **Towns and rural colleges** widened most (10.5 → 14.4 and 7.7 → 12.3), with Pell rates flat or falling. Overlaps
  with Study 3's shrinking colleges; link, don't attribute.
- **Big publics and FBS members raised Pell graduation rates** (58% → 64% for FBS members) and still widened the gap:
  worth a sentence, because "rates rose" and "gap widened" are both true.
- Check the **student-weighted** view before publishing: large universities have higher Pell rates and smaller gaps,
  so the gap for the typical Pell *student* is likely smaller than for the typical college. The study shows both.

## What readers see (`/trends/pell-gap`)
1. **National chart**: two median lines by entering class, Pell recipients and students with neither, 2010 to now, the
   gap shaded between them; the overall graduation rate as a thin context line.
2. **Small multiples**: the shaded pair per group, same scale, for region, type, size, selectivity, then setting and
   research tier.
3. **Colleges or students**: segmented control swapping medians for student-weighted rates, with the caption that the
   student view is dominated by large universities.
4. **Where the gap is widest**: share of colleges with a 10+ point gap per group, as one bar chart.
5. **Eight years, everyone**: the 8-year outcome-measures companion (`om_award_pell` vs `om_award_non_pell`), which
   includes part-time and transfer students, for the newest class, national and by type. Labeled as a different
   measure with its own years.
6. **Takeaway**, **method note** (entering-class labeling, the 50-student floor, who "neither" means, today's
   classification), and links: Explore sorted by `pell_gap` and `pell_gap_change` (exist), the glossary's
   `pell-graduation-gap`, `adjusted-cohort`, and `entering-cohort`, and the Movers list "Pell gap closed most"
   ([top-10-lists.md](top-10-lists.md)).

## Computation
- `studies.json` entry `pell-gap`: per group, the yearly median rates and gap by entering class, the 10+ share, the
  weighted rates, and the 8-year companion. The hub's helpers handle the `cohort` year kind (labels and the newest
  class from `history/meta.json`).
- Test: recompute the national row from committed shards; assert the 50-student floor is applied to both groups in
  both years and that no rate is computed where the GR file nulled it.

## Data work needed
None: both series, both cohorts, and the OM companion exist. If Scorecard's Pell completion fields are ever added as
a longer series (they go back further but use a different cohort definition), keep them out of this study: one
definition per chart.

## Open questions
1. "Neither Pell nor subsidized loan" is IPEDS's comparison group, not "non-Pell". The label matters: students with
   subsidized loans but no Pell are in neither group. Recommendation: say "students with neither a Pell Grant nor a
   subsidized loan" in full once per page, then "neither" with the glossary term.
2. Should the study include graduation **by race/ethnicity** (`grad_rate_*` by race, Scorecard, entering 2005 on) as a
   second gap? It is a different story with its own definitional breaks (2010 categories). Recommendation: a separate
   future study; mention it in the hub's ideas list when this one ships.
