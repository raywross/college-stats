# Design Research (Sept 2026)

The redesign draws on these sites. Items marked (K) are from general knowledge; the rest were fetched.

## College sites
- **College Scorecard** (K): headline numbers on bars with a national-median marker, (i) icons, a glossary.
- **Niche** (K): letter-grade report card tiles linking to sections; sticky section anchors.
- **College Navigator**: exhaustive accordions and tables. Useful but dated.
- **BigFuture** (K): tabbed profiles; middle-50% range bars.
- **CollegeVine**: tabs, stat cards, "your chances" gauge, similar-schools strip.
- **Data USA**: four hero numbers, a table of contents, and a one-sentence plain-English takeaway before each chart.

## Other industries
- **Nomad List**: colorful score bars on cards; grid/map/chart view switching; playful but fast to scan.
- **Versus.com** (K): "vs" hero and "N reasons why A beats B" with gap bars.
- **RTINGS** (K): score dials that expand into underlying tests, with "learn about" links.
- **Google Flights** (K): histogram behind price filters; "typical/low/high" marker bars.
- **GSMArena**: aligned spec rows with a sticky product header.
- **Our World in Data** (K): dotted-underline term pop-overs; chart/table toggles.
- **The Pudding / 538** (K): beeswarms with the reader's pick highlighted; annotations on charts.
- **Stripe / Linear** (K): dark gradient heroes, glowing accents, bento grids.

## Patterns adopted
| Pattern | Where |
|---|---|
| Median-marker bars | `BenchmarkBar`, `RangeBar` median ticks |
| Colored metric bars on cards | `SchoolCard` meters |
| Plain-English takeaways | Profile section intros (`lib/insights.ts`) |
| Dotted-underline pop-overs + glossary | `Term`, `InfoTip`, `/glossary` |
| "Reasons why" differences | Compare → Key differences |
| Beeswarm "where it sits" | `DotStrip` on profiles |
| Histogram-backed filter | `HistogramSlider` |
| Grid / table / chart views | Explore `ViewToggle` |
| Sticky section nav & compare header | `SectionNav`, `CompareHeader` |
| "Known for" badges | `standouts()` chips |
| Personal marker ("You") | `ScoreChecker` |

## Deliberately not adopted
- **Letter grades / red–green scoring**: selectivity, size, and similar metrics aren't good or bad, so we use
  neutral tiers, percentile meters, and wording like "Most selective" or "Highest" instead of trophies.
