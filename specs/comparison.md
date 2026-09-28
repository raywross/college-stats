# Compare

Route: `/compare?ids=a,b,c,d` (up to 4). The URL is the source of truth; the saved list follows it.

## Building a comparison
- `CompareButton` (cards, table rows, profile hero, similar schools) toggles an id in the saved list
  (`lib/compare.ts`: localStorage + `compare-updated` event + `useCompareIds` via `useSyncExternalStore`).
- `CompareTray`: a floating pill at the bottom with stacked crests (tap to remove), empty slots, Clear, and
  "Compare N →". Hidden on `/compare`.
- The header's Compare link shows a lime count badge and links to the current selection.

## 10-year direction
After Key differences and the radar: a table of the four trend indicators (cost, applications, diversity,
selectivity) per college, each with its word, number, and start year. See [trend-indicators.md](trend-indicators.md).

## Then & now
After Cost & outcomes: `ThenAndNow` (client) switches between average total cost (after inflation), acceptance rate,
applicants, undergrads, and the diversity index, drawn as a `SlopeChart` over the default 10-year window from `school.trends`, with the
history source line (per-kind year ranges). See [trends-design.md](trends-design.md).

## Page states
- **Empty**: "Pick your contenders" plus six preset matchups.
- **One school**: "Pick a rival" with similar-school suggestions that link straight to a two-way compare.
- **2–4 schools**:
  1. Sticky `CompareHeader`: slot-colored school chips (remove ×) and an "Add school" searchable picker
     (base-ui Popover). Changes `router.replace` the URL and sync storage.
  2. **Key differences** (Versus.com-style): `keyDifferences()` generates sentences such as "Harvard is
     2.6× more selective than UCLA", sorted by gap size, each with a magnitude bar and info tip.
  3. **Shape of each school**: `RadarChart` of percentile ranks across selectivity, test scores, size,
     Pell share, first-gen, and diversity.
  4. Grouped metric cards (`CompareMetric`): Admissions, Test scores (range bars on a shared axis), Students,
     race/ethnicity stacked bars with a shared legend.
  5. **Cost & outcomes**: net price, earnings, graduation, median debt, plus `NetPriceCompare` by family income.
  6. **All the numbers**: a full table (the accessible/data view), with info tips on every row.

School colors come from the compare slots in pick order (`SLOT_COLORS`), validated all-pairs for overlap.
