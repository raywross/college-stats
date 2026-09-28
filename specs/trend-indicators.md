# Trend indicators

Four plain-language answers about how a college changed over its last 10 years of federal data, shown where people
search, open, and compare colleges. Built on `school.trends` ([trends-data.md](trends-data.md#schooltrends-phase-3)),
so no history files load for them.

| Indicator | Question | Measure (`school.trends`) | Steady band | Words (up / steady / down) |
|---|---|---|---|---|
| Cost | Is it getting more expensive? | `avg_paid_all`, % after inflation | ±5% | Rising / Steady / Falling |
| Applications | Are more students applying? | `applicants`, % | ±10% | Growing / Steady / Shrinking |
| Diversity | Is the student body getting more diverse? | `diversity`, diversity index points | ±0.03 | More diverse / Steady / Less diverse |
| Selectivity | Is it getting harder to get in? | `acceptance_rate`, percentage points, inverted | ±3 pts | More selective / Steady / Less selective |

"Up" always means more of the named quality, so selectivity is up when the acceptance rate falls. A change exactly at
the band counts as steady.

## Design choices
- **Direction, not a verdict.** Rising cost is bad for families but growing applications usually signal demand, so the
  indicators use no good/bad (status) colors. The icon (trending up, a dash, trending down) wears the measure's domain
  color for identity; the word carries the meaning, so nothing relies on color. Glossary term `trend-direction`
  says so.
- **Always with its number.** Every indicator shows its change ("−12% after inflation", "admit rate 13% → 6%",
  "index 0.63 → 0.77") and start year ("since fall 2014"), so a borderline "Rising" can be judged.
- **Three directions, not a score.** Filters stay simple (pick any of the three), and magnitude is visible in the
  number and sortable in the table.
- **Absolute, not relative to peers.** The question is "is it rising?", not "is it rising faster than others?". The
  "Known for" trend standouts and the profile's "10 years" tile already cover what stands out nationally.

### Thresholds
Chosen from the distribution of 10-year changes (fall 2014 to fall 2024, 2013–14 to 2023–24 prices, when first
built):

| Change | p10 | p25 | median | p75 | p90 |
|---|---|---|---|---|---|
| Avg cost after inflation | −29% | −20% | −11% | −1% | +9% |
| Applicants (200+ at both ends) | −21% | +8% | +44% | +89% | +148% |
| Acceptance rate, pts (200+ applicants) | −15 | −4 | +6 | +17 | +28 |
| Diversity index | −0.04 | +0.01 | +0.06 | +0.12 | +0.18 |

Cost ±5% and selectivity ±3 points match `NOTABLE_FLOORS` (lib/history.ts), the floors a change must clear before the
profile calls it notable. Applications ±10% and diversity ±0.03 sit near the 25th percentile, so "Growing" and "More
diverse" mean more than the usual drift. With these bands, when built: cost 219 rising / 277 steady / 959 falling;
applications 991 / 163 / 196; diversity 969 / 311 / 147; selectivity 362 more / 212 steady / 776 less.

### When there's no indicator
- **Applications and selectivity** need 200+ applicants at both ends (a rate on a handful of applicants swings on a
  few decisions), the same rule as the `admit_rate_change` sort.
- **Diversity** (computed in `diversityChange`, lib/history.ts, so the sort, table, and Compare agree):
  - 300+ undergrads at both ends (`DIVERSITY_MIN_UNDERGRADS`, the size-change floor).
  - Left out when the "other" share moved more than 10 points (`DIVERSITY_MAX_OTHER_SHIFT`). "Other" folds unknown race
    in with American Indian/Alaska Native and Pacific Islander students, so a jump there is usually students whose race
    went unrecorded (one college went from 0% to 31%), which the index would read as more diversity. A large but steady
    other share (e.g. a tribal college) is kept.
  - These drop 385 of 1,812 colleges with race history; the top of the diversity sort was all such cases before.
- Any indicator is missing when `school.trends` lacks the measure (fewer than 10 years, or a start more than 2 years
  late; see `changeOver`).

## Where they appear
| Place | Component | Notes |
|---|---|---|
| Profile hero | `TrendIndicatorStrip` | Under "Known for": four cards (2×2 on phones) with icon, label, word, number, start year; each links to `#history`. Cited through `trends` in the Overview's source note |
| Explore filters | `FilterPanel` "10-year direction" | Per indicator, three chips with counts; any mix. Params `costTrend`, `appsTrend`, `divTrend`, `selTrend` (comma lists of `up`, `steady`, `down`). Colleges without the indicator drop out while one is set. Active chips read "Cost: falling", "More selective" |
| Explore cards | `TrendIndicatorGrid` | 2×2 under the meters: icon, label, short word ("Diversity Up"); full sentence for screen readers |
| Explore table | `SchoolTable` `?changes=1` | Adds applications and diversity (then → now) to the change columns; sorts `apps_change`, `diversity_change` |
| Compare | "10-year direction" table | Rows are indicators (with their question), columns are colleges; "Not enough data" where missing. Cited with `HistorySourceNote` over the default windows. "Then & now" also gains the diversity index |

## Code
- `lib/indicators.ts`: `INDICATORS` (definitions and bands), `indicatorOf`/`indicatorsOf`, `changeText`/`detailText`,
  `matchesIndicators` (the Explore filter). Pure; imports only types.
- `lib/history.ts`: `diversityIndexAt`, `diversityChange`, and `trendSummary` writing `trends.diversity`.
- `lib/derive.ts`: `simpsonIndex`, shared by the snapshot's `diversityIndex` (lib/metrics.ts) and history, so the
  indicator's end value equals the diversity index on the profile.
- `components/trends/TrendIndicators.tsx`: strip, card grid, compare cell.
- Tests: `tests/indicators.test.mts` (bands, inversion, applicant and undergrad floors, the other/unknown rule, text,
  URL parsing, committed data). The history test that `school.trends` equals `trendSummary()` of every shard covers the
  diversity summary too.

Changing a band is a one-line edit in `INDICATORS`; the counts above then need updating. Changing the diversity rules
changes `school.trends`, so run `npm run sync-history` (or `-- --offline` for local iteration).
