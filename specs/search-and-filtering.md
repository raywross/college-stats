# Explore: Search & Filtering

Route: `/explore` (dynamic, URL-driven). The middle of the drill-down, where you narrow the list.

## Layout
- Header with three live summary tiles for the current results (median admit rate, median SAT, undergrads).
- Desktop: sticky filter sidebar (`FilterPanel`). Mobile/tablet: `MobileFilterSheet` bottom sheet with
  a "Show N schools" button.
- Toolbar: `ExploreSearchInput` (250ms debounce), `SortControl`, `ViewToggle`; `ActiveFilters` lime chips below.

## Views (`?view=`)
| View | Component | Notes |
|---|---|---|
| `grid` (default, 24/page) | `SchoolCard` | Crest, admit rate + "1 in N", selectivity tier, five percentile meters (selectivity, size, SAT, Pell, net price), a 2×2 "10-year direction" block ([trend-indicators.md](trend-indicators.md)), up to two "Known for" chips, compare toggle |
| `table` (50/page) | `SchoolTable` | Sortable headers with info tips, inline bars per metric, sticky first column, horizontal scroll on small screens. `changes=1` adds 10-year change columns (avg cost after inflation, admit rate then → now, undergrads, applications, diversity index then → now) from `school.trends`, sortable as `avg_cost_change`, `admit_rate_change`, `size_change`, `apps_change`, `diversity_change` |
| `chart` | `ScatterPlot` | Up to the 600 most-applied-to matches. Tab `chart=admissions` (default: admit rate vs. SAT) or `chart=value` (net price vs. earnings) |

## Filters & URL params
| Filter | Control | Params |
|---|---|---|
| Text | search input | `q` |
| Acceptance rate | `HistogramSlider` 0–100% | `minAR`, `maxAR` |
| SAT middle 50% (overlap) | `HistogramSlider` | `minSAT`, `maxSAT` |
| Type | chips with counts | `types` (public, private-nonprofit, …) |
| Size | 4 bucket tiles | `sizes` (small, medium, large, xl) |
| Region / State | chips with counts | `regions`, `states` |
| Net price | `HistogramSlider` $0–80K | `minNP`, `maxNP` |
| Sort | select + direction | `sortBy` (**applicants** = "Most applied-to", the default, descending; name, acceptance_rate, sat, enrollment, pell, first_gen, diversity, net_price (lowest first), earnings, grad_rate), `sortDir` |
| Page | `Pagination` | `page` (reset to 1 by any filter/sort/view change) |
| Min/max undergrads | chip only (set by home lenses) | `minEnroll`, `maxEnroll` |
| 10-year direction | three chips with counts per indicator ([trend-indicators.md](trend-indicators.md)) | `costTrend`, `appsTrend`, `divTrend`, `selTrend`: comma lists of `up`, `steady`, `down` |

Still supported by the data layer (no UI yet): `minACT`/`maxACT`.

Missing values: range filters (admit rate, SAT, ACT) and direction filters exclude colleges that don't report the measure. Sorting always
puts missing values last, in either direction. Card meters and table cells show "–".

**Test policy** (`policy=required,optional,blind`; [cds-test-scores-and-policy.md](data-expansion/cds-test-scores-and-policy.md)):
three chips with counts. Required = `required`; Optional = `required-some`, `recommended`, `considered`; Test-blind =
`not-considered`. Reads each college's newest published policy (`admissions.test_policy`, a coming cycle's from its CDS
when newer), so cycles differ between colleges; colleges with no policy are excluded (`lib/test-policy.ts#matchesPolicy`).

Parsing lives in `lib/params.ts` (`parseFilters`, `parseView`, `countActiveFilters`). Client controls update
the URL through `components/explore/useExploreParams.ts` (`router.push`, `scroll: false`). "Reset" keeps
sort and view.
