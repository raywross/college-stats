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
| Where applicants live | two boolean chips with counts ([cds-residency-admissions.md](data-expansion/cds-residency-admissions.md)): "Publishes admit rates by residency", "Admits out-of-state applicants about as often as in-state" (out-of-state rate ≥ in-state − 5 points, 200+ applicants each). Colleges without a CDS residency grid never match; no sort, slider, or column while coverage is partial | `byRes`, `oosEven` |
| Financial aid (from colleges' own reports) | two chips with counts ([cds-financial-aid.md](data-expansion/cds-financial-aid.md)) | `aidForms=no-css` (H8 read, CSS Profile not required), `intlAid=1` (the college aids international students) |
| Cost by family income ([product/cost-by-income.md](product/cost-by-income.md)) | a section after Average cost: a slider "Need-based aid reaches families earning" ($110K–$400K in $10K steps; at the left edge it is off), an "Offers merit aid" chip with a count, and "Show each college's price at a family income" (a slider $0–$400K in $5K steps, with "Lowest price first" and "Remove"). With an income set, each card and phone row replaces the average cost with "About $41K at $200K" plus "estimate" where modeled; chips: "Need-based aid reaches $250K+ (estimate)", "Offers merit aid", "Prices at $200K income" (removing it also drops a price sort) | `minAidIncome` (whole dollars), `merit=1`, `income` (whole dollars, $0 counts), `sortBy=price_at` (cheapest first, offered only while `income` is set). `minAidIncome` and `merit` count as active filters; `income` doesn't. The break point is an estimate: the page passes `estimatesShown()` (the accuracy pilot's gate) as `showEstimates`; while it is closed the break-point slider and chip are replaced by one line saying why, the URL's `minAidIncome` filters nothing and isn't counted, and prices above $110K read "Published data end at $110K". Reset keeps `income` with the sort and view |
| Distance from home | the panel's first section ([product/home-and-distance.md](product/home-and-distance.md)): a ZIP code field, "Use my home" (signed in), radius chips 25–500 mi; cards, rows, and the table then show each college's straight-line miles | `near` (five-digit ZIP, resolved to its center server-side by `lib/zip-centroids.ts`), `within` (25, 50, 100, 200, 300, 500; default 100); `sortBy=distance` (nearest first, offered only while `near` is set). Colleges without coordinates are hidden while set; an unknown ZIP filters nothing and says so |

College-reported booleans (the financial aid chips) exclude colleges with no data: a college whose CDS record we
don't have, or whose list was left blank, never matches.

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
