# Trends: Site Design

> Status: **Phase 1 built** (2026-09-28); Phases 2–3 planned. Data, sources, and storage are in [trends-data.md](trends-data.md).
> What shipped and how it differs from this plan: [Build notes](#build-notes-phase-1).

## Principle: trends are facts at the top, charts at the bottom
History follows the site's drill-down. The higher the level, the less history is shown:

| Level | What history looks like | Budget |
|---|---|---|
| Home | Three national trend facts | 3 cards, no more |
| Explore | Nothing by default; optional "10-yr change" table columns | 0 on screen by default |
| Compare | One "Then & now" chart | 1 section |
| Profile, top | A "10 years" tile in the Overview bento, plus a one-line "since" delta under three section headlines | 1 tile, 3 lines |
| Profile, "Over time" section | The full year-by-year charts | Everything |

**What we don't do** (noise control):
- No sparklines on Explore cards or next to every number.
- No trend for a metric whose definition changed mid-series (earnings), or across a break (SAT before and after 2017).
- No percent change on tiny bases (applicants < 200, undergrads < 300); use "from → to" instead.
- No trend chip unless the change is *notable* (below).
- No year-by-year tables above the "Over time" section.

**"Notable" rule** (used by trend chips and the Overview tile): a change counts when it's beyond the national
25th/75th percentile for that same change **and** clears a floor: cost ±5% after inflation, admit rate ±3 points,
undergrads ±10%, applicants ±25%, grant share ±5 points. Percentiles come from `history/national.json`.

**Default window:** 10 years, ending with the latest year (currently 2013–14 → 2023–24 for cost, fall 2014 → fall 2024
for admissions). Money changes are **after inflation** by default, and always say so ("+8% after inflation").

## Home: "What's changed" (3 facts)
A band after "Is it worth it?", with three cards. Each card has: a big number, one sentence, a tiny national sparkline
(median, fixed panel), the years, a source line, and a link to where you can explore it. Facts are precomputed in
`history/facts.json`, so the page stays static.

| # | Fact | Why this one | Visual | Links to |
|---|---|---|---|---|
| 1 | **The price gap.** "Full prices rose 12% after inflation since 2013–14. What students actually paid rose 3%." | The site's core cost story: sticker price isn't what people pay, and aid generosity explains the gap. | Two lines indexed to 100 (full price vs average total cost), which is one scale, not a dual axis | `/explore?chart=sticker` |
| 2 | **Harder to get in.** "Applications to the 100 most selective colleges rose 60% since fall 2014; the seats didn't." | Everyone feels this, and it explains falling admit rates. | Sparkline of applications per seat | `/explore?sort=acceptance` |
| 3 | **Test-optional went mainstream.** "In fall 2019, 55% of colleges required the SAT or ACT. In fall 2024, 5%." | A policy shift that changes how to read every score on the site. | Before/after pair of bars | Glossary `test-optional` + Explore test-policy filter |

*(Numbers are placeholders until the data is built.)*

**Alternates** (swap in if a fact goes flat or its data is unavailable): undergrad enrollment ("4 in 10 colleges are
smaller than 10 years ago"); aid generosity ("grants now cover 38% of the full price, up from 31%"); student diversity.

**Selection criteria for any fact:** national and fixed-panel (colleges that report both endpoint years); a clear change;
links somewhere you can explore it; ties to a concept the site already explains.

## Explore
- **Table view** gets optional columns in the column picker (off by default): *Avg cost, 10-yr change*, *Admit rate
  then → now*, *Undergrads, 10-yr change*. Sortable (`SortKey`: `avg_cost_change`, `admit_rate_change`,
  `size_change`) from the `trends` summary in `schools.json`, so no history files load.
- Grid cards and the chart tabs are unchanged.

## Compare: "Then & now"
One section after the cost comparison: a **slope chart** (2 points per college, compare-slot colors, direct labels at
both ends) for one metric at a time, chosen from a segmented control:
*Avg total cost (after inflation)* · *Acceptance rate* · *Applicants* · *Undergrads*.
- Endpoints are the default window's; if a college lacks the start year, its line starts at its earliest year, and a
  note says so.
- Slopes read at a glance for 2–4 colleges; a full multi-line chart would be clutter here.

## Profile: top of page
- **Overview bento: "10 years" tile.** Always shows average total cost (after inflation, from → to, arrow); then up to
  two more *notable* changes from: full price, admit rate, applicants, undergrads, grant share. If nothing is notable,
  it says "Steady over 10 years". Clicking the tile jumps to `#history`.
- **"Known for" chips:** at most one trend standout, and only for the national top 5% (e.g. "Applications tripled since
  2014"). Added to `standouts()`.
- **Section headlines:** a muted one-liner under three existing headline numbers:
  - Admissions, acceptance rate: "Fall 2014: 12%"
  - Students, undergrads: "+9% since 2014"
  - Cost, average total cost: "+3% after inflation since 2013–14"
  On ≥ sm screens, a 60 × 16 px sparkline sits beside it (hover shows the year and value).

## Profile: "Over time" section (`#history`)
Placed after Cost & outcomes and before Similar schools; added to `SectionNav` as **Over time**. It renders only when a
history shard exists.

**Controls** (one row above the charts, per the dataviz interaction rules): range *10 years / All*; money
*After inflation / As reported*; *National median* on/off (on by default). The state lives in the URL
(`?range=all&dollars=nominal`) so views can be shared.

**Takeaway sentence** at the top (`historyTakeaway()` in `lib/insights.ts`), tying cost and aid together, e.g. "The
full price rose 9% after inflation since 2013–14, but the average first-year paid 4% less, because grants grew
faster."

**Small multiples**, grouped by domain (domain color dot on each group heading, 2 columns on lg, 1 on mobile). All
panels share the same x-axis years within a group.

| Group | Panel | Form | Notes |
|---|---|---|---|
| Cost (`--d-value`) | Full price vs average total cost vs aided net price | 3-line chart | Headline series (avg total cost) in the domain color; context series in neutral ink (solid = full price, dashed = aided net price). Publics: an *In-state / Out-of-state* toggle for full price. |
| | Net price by family income | Dumbbell per income band (start year → latest) | Five lines would be noise; a dumbbell shows the change per band. |
| Aid (`--d-value`) | Grant share and aid generosity | 2-line chart (both %) | |
| Admissions (`--d-admissions`) | Applicants and admitted | 2-line chart (counts) | |
| | Acceptance rate and yield | 2-line chart (%) | Separate from counts: never a dual axis. |
| Scores (`--d-scores`) | SAT and ACT middle 50% | Range band over time | Break at fall 2017 (SAT redesign). Shaded "test-optional" span from the year policy changed, with the submission rate in the tooltip. |
| Size (`--d-size`) | Undergrads | Line | |
| Diversity (`--d-diversity`) | Student body by race/ethnicity | 100% stacked area, 2010+ | Uses `--demo-1..7` (already validated). |
| Outcomes | Graduation rate by entering cohort | Line | The x-axis is labeled "Entered in…" (a cohort, not a report year). |
| | Median debt at graduation | Line, ends 2020 | Note: "Newer years aren't published in this series." |
| | Earnings | Text only | "Not shown over time: the Scorecard changed how it measures earnings in 2020, so earlier years aren't comparable." |

**Every panel has:**
- Title, latest value, and change over the window ("+3% after inflation since 2013–14").
- National median as a dashed line with a p25–p75 shaded band (from `national.json`), labeled once.
- A crosshair tooltip: year label ("2019–20" / "Fall 2019"), each series' value, national median, and source edition.
  Tap-and-drag on touch.
- Gaps left as gaps (never interpolated); **breaks** as a dotted vertical rule labeled with the reason; **events**
  (2020–21 pandemic) as a faint labeled band; the **provisional** latest year as a hollow point with a tooltip note.
- An `InfoTip` on the title, and a *View as table* toggle (accessibility, plus exact numbers).
- A `SourceNote` for the group listing the range of editions ("IPEDS Institutional Characteristics, 2000–01 to
  2023–24"); "approx." footnote where a year used the fallback formula (2007–08).

**Mobile:** groups become accordions with Cost open by default; charts are 160 px tall; the range stays 10 years unless
changed; direct labels drop to the legend when they'd collide.

## Chart components (new, in `components/charts/`; add to [charts.md](charts.md))
| Component | Used by | Key props |
|---|---|---|
| `TrendLine` | Profile panels | `series[]` (name, color token, dash, values, start), `band?` (p25/p75), `median?`, `breaks[]`, `events[]`, `provisionalYear`, `format: FormatKind`, `yearLabel: "fall" \| "academic" \| "cohort"` |
| `Sparkline` | Home facts, section headlines | `values`, `start`, `format`; hover only on ≥ sm |
| `SlopeChart` | Compare | `rows[]` (name, slot, from, to), `format` |
| `Dumbbell` | Net price by income | `rows[]` (label, from, to), `format` |
| `StackedArea100` | Diversity | `categories[]` with `--demo-*` tokens |

All follow the existing rules: plain data props (no function props; `FormatKind` strings), one y-axis, legend for ≥ 2
series plus direct labels for ≤ 4, text in text tokens, and dark mode verified. No new categorical palette is needed:
trend charts reuse the domain colors, neutral inks, compare slots, and demographic palette, all already validated. If
one is added, run `validate_palette.js`.

## Data access (`lib/data.ts`)
- `getHistory(unitId): SchoolHistory | null`: reads `data/history/schools/{id}.json` (server-only, cached).
- `getNationalHistory(): NationalHistory`, `getTrendFacts(): TrendFact[]`.
- `real(value, year)` and `changeOver(series, window, { real })` in `lib/metrics.ts`.
- `school.trends` (from `schools.json`) for Explore, the Overview tile, headlines, and badges, without reading shards.
- History cites through the field registry like everything else ([data-lineage.md](data-lineage.md)): each series maps to a
  registered field, and its footnote gives the year range (e.g. an extended `sourcesForFields(fields, school, { range })`).

## Glossary additions (`lib/glossary.ts`)
`inflation-adjusted` · `provisional-data` · `entering-cohort` · `trend-break` · `fixed-panel`.

## Phasing
1. **Cost and admissions first.** Data: prices, SFA, and admissions series; `national.json`; CPI. UI: "Over time"
   (Cost, Aid, and Admissions groups), the Overview tile, and Home facts 1–2.
2. **The rest of the profile.** Scores (with breaks), size, diversity, outcomes panels; section-headline deltas;
   Home fact 3.
3. **Cross-college views.** Compare "Then & now"; Explore change columns and sorts; trend standouts.

## Build notes (Phase 1)
Built 2026-09-28 (`feature/trends`). What shipped, and where it differs from the plan above:
- **Profile "Over time"** (`components/history/OverTime.tsx`, client; `#history`, between Cost & outcomes and How it
  ranks). Controls: *10 years / All*, *After inflation / As reported*, *National median*, and for publics *All students
  / In-state / Out-of-state* full price; state in the URL (`?range=all&dollars=nominal&median=off&rate=out`), read
  after hydration so the page stays static. Groups and panels:
  - Cost: *What a year costs* (average total cost in the domain color with the national band; full price solid
    neutral; net price with grants dashed neutral) and *Net price by family income* (dumbbell, window start → latest).
  - Aid: *Grants for first-years* (share with grants + aid generosity) and *Average grant* (added: it's the other half
    of the grant story and has a meaningful national band).
  - Admissions: *Applicants, admits, and enrollees* (enrollees added: "the seats"; **no national band**, because the
    national applicant range would flatten a large college's line) and *Acceptance rate and yield*.
  - Every panel: latest value, change over the window, legend, direct end labels (≥ 480px), crosshair tooltip (keyboard
    ← →), pandemic band, hollow provisional point, and a *Table* toggle. Group footers carry the history source line
    (`HistorySourceNote`: each survey with its year range, plus BLS CPI-U for money), the 2007–08 estimate note, and the
    carried-forward-years note.
  - Colleges whose admissions headline comes from a Common Data Set get a note that the charts are federal and end a
    year earlier (see backlog: CDS values newer than federal data).
  - Mobile: groups are accordions (Cost open), charts 170px tall, direct labels drop to the legend.
- **Overview "10 years" tile** (`TenYearTile`): average total cost from → to after inflation, then up to two notable
  changes from full price, acceptance rate, applicants, grant share (undergrads join in Phase 2). It's a card with a
  "See how it's changed" link rather than a whole-card link, because its info button can't nest inside a link.
- **Takeaway** (`historyTakeaway()` in lib/insights.ts): full price vs what the average first-year paid, with "because
  grants grew faster" only when aid generosity rose; then applications and the acceptance rate.
- **Home "What's changed"** (`components/history/WhatsChanged.tsx`, after "Is it worth it?"): facts 1–2. The real
  numbers (2013–14 → 2023–24, 1,432 colleges): what students paid fell 12% after inflation while full prices held
  about steady; applications to today's 100 most selective colleges (1,000+ applicants) rose 74% since fall 2014 while
  their enrollment rose 10% (11.9 → 18.7 applications per seat). Card text follows the direction of each change
  (`movedBy()`), so it stays true after the next build. Links: `/explore?sortBy=avg_cost`, `/explore?sortBy=acceptance_rate`
  (Explore has no `chart=sticker` view). Each card cites only the files in its years.
- **Charts added:** `TrendLine`, `Sparkline`, `Dumbbell` ([charts.md](charts.md)). No new colors: domain colors,
  `--muted-foreground` for context series, `--foreground` washes for bands.
- **Glossary:** `inflation-adjusted`, `provisional-data`, `fixed-panel`. (`entering-cohort` and `trend-break` come
  with Phase 2's graduation and SAT charts.)
- Not yet: section-headline deltas, trend standouts, Home fact 3, Compare, Explore (Phases 2–3).
