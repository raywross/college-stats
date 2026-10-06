# Charts

All charts are custom SVG/CSS in `components/charts/`: no charting library, so every chart uses theme
tokens and adapts to dark mode. Recharts is still installed but unused.

## Catalog

| Component | Type | Client? | Used on | What it shows |
|---|---|---|---|---|
| `ScatterPlot` | Scatter | yes | Home, Explore chart view, Profile | Generic school scatter: dot area = undergrads, color = public/private. Axes, formats, and shaded zone come from serializable configs in `lib/chart-configs.ts`: `LANDSCAPE_*` (admit rate vs. SAT) and `VALUE_*` + `valueZone()` (net price vs. earnings). Optional `diagonal` draws a solid y = x reference line with a label (used by "Sticker vs. actual" as "No aid: pays full price"). Hover/focus shows a card; mouse click opens the profile; touch taps pin the card. `highlight` fades non-matches; `focusId` labels one school, flipping the label left near the edge. Capped at 300–600 most-applied-to points. |
| `DotMap` | Dot map | yes | Explore map view | Colleges on a U.S. outline (Albers USA: lower 48, Alaska, Hawaii, DC; territories counted in the caption, not drawn). Same encoding, legend, and hover card as `ScatterPlot` (both use its exported `DotLegend` and `DotCard`). The outline and point positions are computed on the server (`lib/us-map.ts`, `us-atlas` + `d3-geo`), so the client gets path strings and x/y, not d3. Hover finds the nearest dot within 14px of its edge (a 24px+ target even for 2px dots); mouse click opens the profile; a touch tap pins the card. Dot radii are set in screen pixels, so phones get the same dot sizes. Shows every matching college (no cap); the table view is the accessible list. |
| `NetPriceByIncome` | Column | no | Profile | Net price per income band plus a "No grants" column at the full sticker price (publics: in-state). Income columns run to full price: solid = paid, dashed tint = covered by grants. Uses the latest year of each figure; fine print names both years and says when they are mixed. |
| `NetPriceCompare` (compare/) | Grouped bars | no | Compare | Each income band, one bar per school in slot colors, shared scale. |
| `DistributionStrip` | Histogram + pin | yes | Profile | Distribution of a metric across every reporting college (server-computed bins from `distribution()`, axis = 1st–99th percentile), this school pinned, "higher than X% of N" label. Hover a bar for its count. `format` is a serializable `FormatKind`. (Replaced a per-school beeswarm, which can't show ~1,900 dots.) |
| `RangeBar` | Range bar | no | Profile, Compare | Middle-50% range with 25th/75th values labeled at the ends, dataset median tick, optional "You" marker. Score bars take their axis from `scoreScale` (`lib/score-scale.ts`): the tightest fixed tier holding the 25th percentile (SAT 1000/800/400–1600, section 500/400/200–800, ACT 18/12/1–36). `compact showScale` labels the axis ends on tiles. |
| `BenchmarkBar` | Bar + marker | no | Profile | Value vs the national median, with "Above/Below/About typical". |
| `Ring` | Radial gauge | no | Profile, Home hero | Single 0–1 value with the number in the middle. |
| `Waffle` | 10×10 pictogram | no | Profile | Out of 100 applicants: admitted & enrolled / admitted elsewhere / not admitted. |
| `StackedBar` | Part-to-whole | yes | Profile, Compare | Race/ethnicity in fixed order; hover a segment or legend item to highlight it. |
| `RadarChart` | Radar | yes | Compare | Percentile "shape" across 6 axes; legend chips isolate a school. |
| `StateTileMap` | Tile cartogram | no | Home, Trends | Colleges per state in 5 sequential steps (1–14, 15–29, 30–59, 60–99, 100+); tiles link to `/explore?states=XX`. An additive `values`/`ranges` mode (specs/trends/states.md) colors by a signed or null-able measure instead (`ranges` can include negatives for a diverging scale, and `null` renders a distinct "no data" tile from a present-but-zero value); `counts`/`levels` callers are unaffected. |
| `Leaderboard` | Ranked bars | no | Home | Top 5 on a metric; one series, one color. |
| `HistogramSlider` | Histogram + range slider | yes | Explore filters | The distribution behind a filter, with in-range bars highlighted. |
| `DataAgeTimeline` | Timeline rows | no | Data | One row per federal release on the site: a bar from the start of the period it describes to today (single series, `--primary`, square start, 4px rounded end), a hollow ring at the next expected release (identity by shape, so no second hue), a solid hairline for today and at each New Year. CSS-positioned in %, so it scales to phone width without `useWidth`. Each row prints its year and next update, so the chart is its own table; the bar is focusable and shows its age on hover/focus. |
| `CompareMetric` (compare/) | Grouped bars | no | Compare | One bar per school in slot colors, with a neutral flag on the extreme. |
| `TrendLine` | Line (time) | yes | Profile "Over time" | Year-by-year series on one y-axis (2px lines; headline in the domain color, context series in `--muted-foreground`, dashed for the third), gaps left as gaps, optional national p25–p75 band (`--foreground` wash) with a dotted median, a faint labeled band for events (pandemic year), a hollow end point for the provisional year, direct end labels nudged apart (≥ 480px, ≤ 4 series), and a crosshair tooltip listing every series and the median at the hovered year (keyboard ← →). Axis zero-anchored when the data sits near zero. Also: `domain` and `height` (a fixed y-range and size, so the national trends' `SmallMultiples` in `components/trends/` share one scale), `ranges` (25th–75th bands with edge lines), `breaks` (a definition change: dotted labeled rule, every line and band split), `spans` (shaded runs of years, labeled only when the label fits), and tooltip-only `extras`. |
| `Sparkline` | Line (tiny) | yes | Home "What's changed" | One or two series on a shared scale, dots at both ends, drawn at real pixel width (`useWidth`); hover (≥ sm) shows the year and values. |
| `ClassTrend` | Dot + interval (time) | yes | High school "Outcomes" | A high school's graduation rate by class, one column per class (`gradTrendPoints` in `lib/high-school-ui.ts`): exact rates are `--primary` dots joined by a 2px line only between neighbouring exact classes; ranges the source published are interval bars (never midpoints; open ranges run to 100% or the floor); suppressed classes a hollow muted ring on the floor; skipped classes gaps. Y from the nearest 10% below the lowest bound (≤ 50%) to 100%. First and last rated classes labeled; hover or tap a column for class, rate and cohort (tooltip sits beside the column). Shown only with ≥ 2 rated classes; the caption carries the summary sentence and a screen-reader list. |
| `StackedArea100` | 100% stacked area | yes | Profile "Over time" | Race/ethnicity shares by year in the fixed `--demo-1..7` order, normalized to 100% each year, 1px surface line between layers, gaps left blank, crosshair listing every share, legend in stack order. |
| `SlopeChart` | Slope | yes | Compare "Then & now" | Two points per college in slot colors on one scale, direct labels at both ends nudged apart; values printed, so no hover. |
| `Dumbbell` | Dumbbell | no | Profile "Over time" | Change per category between two years: hollow start dot, solid end dot in the domain color, both values printed (no hover needed). Scale starts at zero or below for negative net prices. |
| `GroupDotPlot` | Dot plot | no | Profile "Cost & outcomes" (graduation by group) | One row per group on a shared scale: solid dots in one hue, the comparison group hollow, the overall rate as a dashed line, class sizes under each label, values and gaps printed (no hover needed). Scale starts at the nearest 10% below the lowest value, with labeled ticks. |

`useWidth` (ResizeObserver) lets SVG charts draw at real pixel width so text stays legible on phones.

## Rules followed (from the dataviz skill)
- Color by job: domain identity, compare slot identity, sequential for the map, status only for warnings.
- Text wears ink tokens, never series colors. Identity comes from a swatch or dot beside the text.
- A legend or direct label for every multi-series chart; tooltips enhance, never gate. Every compare value is
  also in the "All the numbers" table.
- Hairline solid gridlines; 2px surface ring on dots; ≥24px hit targets on strip dots.
- Neutral wording for extremes ("Most selective", "Highest"): more isn't automatically better.

## Validating colors
```
node <dataviz-skill>/scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#c2378f" --mode light --pairs all --surface "#ffffff"
node <dataviz-skill>/scripts/validate_palette.js "#3987e5,#d95926,#199e70,#e05ab0" --mode dark --pairs all --surface "#1b1830"
```
Use `--pairs all` for overlapping forms (scatter, radar); the default adjacent mode is for stacks and bars.

## Server/client boundary
Client chart components can't receive functions from server pages. Pass data plus a `FormatKind`
(`lib/format.ts → formatBy`) instead of formatter callbacks.

## Scale & missing data
- Large point sets are capped by applicant count (`landscapePoints(pool, limit, ensure)`) to keep charts readable and
  page payloads small; the scatter switches to smaller, translucent dots above 120 points.
- Charts receive `null` for unreported values: `RadarChart` draws hollow dots at the center, `CompareMetric` prints
  "Not reported", `DistributionStrip` omits the pin.
