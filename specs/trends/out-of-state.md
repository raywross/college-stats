# Study 5: Public Colleges and Students From Other States

> Status: **built** 2026-10-04 (PR pending, branch `feature/national-trends`). Specified 2026-10-03 as part of the national-trends family
> ([hub](../national-trends.md), which holds the study template and rules). First look computed 2026-10-03 from the
> committed history; the residence data itself was built 2026-10-02 ([residence.md](../data-expansion/residence.md)).

**Question.** Are public colleges enrolling more first-years from other states, and which ones?

**Why it's interesting.** Out-of-state students pay more, and a public university that fills more seats from other
states changes who it serves at home. It is a live debate in many states. The data say the shift is real but
uneven: the median public college's out-of-state share rose from 11% to 13% in ten years, the share of publics with
30%+ from out of state rose from 17% to 22%, and the Northeast's publics nearly doubled their median share (7% → 12%)
while the Southwest's did not move. Public research universities and FBS members are the most out-of-state and became
more so.

## Data
| Series | Years | Used for |
|---|---|---|
| `out_of_state_share` (IPEDS EF part C: first-years from other states ÷ all first-years with a known home) | Even falls from 2004 | The measure |
| `international_share` (same file) | Even falls from 2004 | Companion: students from abroad |
| `enrolled` | Fall 2001 on | Floor and weighting (first-year class size) |
| `sticker_in_state`, `sticker_out_of_state` | 2000–01 on | Companion: the out-of-state premium, after inflation |
| `detail.residence` (per-college home-state table, snapshot only) | Newest even fall | Where the out-of-state students come from (top sending states), on state pages |

Residence is collected only in even-numbered falls, so the line has points every two years and the window is fall 2014
→ the newest even fall (fall 2024 today). Odd years are gaps, not zeros, as the series stores them.

**Panel.** Public colleges reporting the share in both endpoint falls with 200+ enrolled first-years in fall 2014: 496
colleges. Private colleges are shown as one context line (their median is far higher and more stable) but the study is
about publics, because the question is about publics. Groups: region, size, selectivity, and from the additional
groupings research tier and athletic division (the tiers readers mean by "flagship").

## First look (2026-10-03, fall 2014 → fall 2024, public colleges)
| Group | Colleges | Median out-of-state share | Share of colleges 30%+ out-of-state |
|---|---|---|---|
| **All publics** | 496 | **11% → 13%** | **17% → 22%** |
| Southeast | 140 | 13% → 17% | 19% → 28% |
| Northeast | 120 | **7% → 12%** | 14% → 22% |
| Midwest | 103 | 15% → 16% | 20% → 24% |
| West | 75 | 12% → 12% | 17% → 21% |
| Southwest | 48 | 3% → 3% | 13% → 10% |
| Under 2,000 undergrads | 64 | 17% → 22% | 17% → 33% |
| 2,000–9,999 | 254 | 8% → 11% | 13% → 18% |
| 10,000+ | 178 | 12% → 13% | 21% → 25% |
| 25–59% admitted | 74 | 9% → 12% | 14% → 26% |
| 60% or more | 397 | 11% → 13% | 16% → 21% |
| R1 universities | 125 | **18% → 22%** | 32% → 37% |
| R2 | 81 | 5% → 8% | 7% → 19% |
| D-I FBS members | 116 | 19% → 23% | 31% → 36% |
| D-I FCS members | 71 | 14% → 17% | 28% → 37% |
| D-II members | 125 | 9% → 13% | 9% → 16% |

Students from abroad: the median public's international share of first-years was 1.4% in fall 2014 and 1.3% in fall
2024, so the shift is domestic.

What stands out, to confirm before publishing:
- **Research universities and FBS members lead**, and were already highest: the "flagship fills with out-of-state
  students" story holds at the median, with more than a third of R1 publics now 30%+ out-of-state.
- **The Northeast's publics changed most** from a low base; the Southwest's (Texas, dominated by in-state
  guarantees) did not move. State pages ([states.md](states.md)) will carry each state's own version.
- **Small publics moved too** (17% → 22%): regional colleges recruiting across state lines, probably with tuition
  discounts, which the premium companion should show.
- **The under-25% group is missing**: fewer than 30 public colleges admit under 25% of applicants, so the floor
  hides it. Say so in the method note, and fold it into "under 60%".

## What readers see (`/trends/out-of-state`)
1. **National line**: median out-of-state share of publics, fall 2004 to now (even years), with private nonprofits as a
   context line; a second small panel for "share of publics 30%+ out of state".
2. **Small multiples** per group: region, size, selectivity (two groups), research tier, division. One scale.
3. **The premium**: median out-of-state full price minus in-state full price at publics, after inflation, over time,
   and the share of publics where the premium exceeds $20,000. Relates the shift to money without attributing it.
4. **Where they come from**: a tile map of the top sending states to out-of-state first-years at publics nationally
   (summing `detail.residence` across colleges; the same table the state pages use).
5. **Takeaway**, **method note** (even-year collection, 200-first-year floor, publics only, today's classification),
   and links: Explore sorted by `out_of_state` (exists), the glossary's `in-state-student`, the Movers list "More
   students from out of state" ([top-10-lists.md](top-10-lists.md)), and Study 4 for the price side.

## Computation
- `studies.json` entry `out-of-state`: per group, the even-year median lines, the 30%+ shares, the premium line, and
  the sending-state totals. Reuses the hub's breakdown machinery with the `step: 2` family handling already in
  `lib/history.ts` (`seriesStep`).
- Test: recompute the national row from committed shards; assert odd years are absent, not zero, and that the panel
  applies the 200-first-year floor at the window start.

## Data work needed
- None for the lines. The sending-state map needs `detail.residence` summed at build time; the detail file exists.
- If `EF{Y}C` adds odd years in future (it is currently biennial), the step changes in one place.

## Open questions
1. Weight by first-year class so the line answers "what share of all public first-years came from out of state?" as
   the student view (hub rule 2)? Recommendation: yes, as a one-sentence companion, because large publics dominate it
   and the median college is the fairer chart.
2. Does the study belong on the **state pages** rather than as a national study? Both: the national page frames it,
   and each state page shows its own publics' line (already specified there).
