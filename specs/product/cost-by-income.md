# Cost by Income: The Aid Curve, the Break Point, and Merit

> Status: **planned** 2026-10-10. Redesigns how the site shows a college's total cost: as a curve over family income
> rather than one average, with the income where need-based aid ends (the **break point**) and what merit aid can
> still do above it. Written from the owner's brief and a document they supplied ("Financial Aid Specification &
> Phase-Out Model for High-Income Households", generated with Gemini, kept as background, not as data). Builds on
> [cost-outcomes.md](../cost-outcomes.md) and [cds-financial-aid.md](../data-expansion/cds-financial-aid.md); it is
> the school-level half of [net-price-estimator.md](net-price-estimator.md), which becomes the personal layer on top.
> Part of [product](README.md).

## Goal
A family looking at a college wants to know what *they* would pay, and families above the middle want to know
whether they'd get anything at all. Today the site answers with an average ("$31K a year after grants") and a chart of
five federal income bands that stops at **"$110K+"**. At the colleges with the most aid, need-based grants continue to
$200K, $300K, or more; at others they're gone well before $110K. Above that point, some colleges still give merit
scholarships at any income and some give nothing.

So each college's cost becomes a **curve over family income**, from $0 to $400K+, with three parts a family can read
at a glance:
1. **What families pay at each income**: published federal figures up to $110K, our labeled estimate above it.
2. **Where need-based aid ends**: "Need-based aid up to about $310K family income" (or "little need-based aid above
   $110K").
3. **What's possible after that**: "No merit aid: above that, everyone pays the full $92K" or "18% of students without
   need got merit aid, averaging $22K".

## The source document: what we take, what we correct
The owner's document describes the phase-out at high incomes. What the spec takes from it:
- Need = cost of attendance − the family's contribution; aid ends where the contribution reaches the cost.
- The contribution is zero up to a protected income, then rises with each extra dollar until it meets the cost, so
  the curve is flat (federal bands), then a ramp, then flat again at full price.
- The break point moves with the cost (publics, with in-state costs around $30–40K, phase out far earlier than
  privates at $88–95K), with assets and home equity, and with siblings in college.
- Colleges split into **need-only** (no merit: Ivies, Stanford, MIT, Amherst, Williams) and **merit-offering**
  (Vanderbilt, USC, Emory, Tulane, many flagship honors programs), where merit has no income limit.

What was checked and corrected (2026-10-10):
1. **Its numbers disagree with each other.** Its rule of thumb (protection $80–100K, then 22–30% of each extra
   dollar) puts the break point for a $92K cost at $387K–$518K, but its table ends aid at $300–340K, which implies
   about 40 cents per dollar. Neither is hard-coded here; each college's ramp is **calibrated from its own published
   data** ([below](#the-model)).
2. **Siblings no longer split the federal number.** Since 2024–25 the FAFSA's Student Aid Index ignores how many
   family members are in college (FAFSA Simplification; Bryn Mawr's aid office). Only CSS Profile colleges may
   still adjust, each its own way: Duke multiplies the parent contribution by 60% with a sibling in a four-year
   college; Tufts divides it by the siblings' costs. The sibling effect therefore applies only where a college says
   so, as "may lower", never as the document's even split.
3. **Published income promises are real, specific, and change yearly.** For 2025–26: Harvard and MIT cover tuition
   for families under $200K; Penn's Quaker Commitment reaches $200K with typical assets; Princeton is reported at
   $250K and Stanford at $150K (both to be confirmed on the colleges' own pages; the sources found were news and
   aggregator sites). These belong in the data as cited policy, not in a model.
4. **Home equity is treated three ways.** Some CSS colleges ignore it (adviser lists agree on Harvard, MIT, Caltech,
   Whitman, Ursinus, DePauw, George Washington), some cap it at 1–4× income (Johns Hopkins 1×, Grinnell 2×, Trinity
   3×, Kenyon 4×, per one adviser), some count all of it; the lists conflict and date from 2020 onward. Until a
   college's own page says, home equity widens the range rather than moving the estimate.
5. **Nothing in the document is shown as data.** Its costs, grants, and tiers are illustrative and uncited. Every
   figure on the site comes from the federal files, the college's Common Data Set, the college's published policy,
   or the model described here, and says which.

## What the data can say
Counts of the 1,893 colleges in `data/schools.json` (2026-10-10).

| Signal | Field | Colleges | Use |
|---|---|---|---|
| Net price by income, five bands to $110K | `cost.net_price_by_income` (Scorecard) | 1,740 (all five bands: 1,502) | The curve's published part, as steps |
| The $110K+ band | `cost.net_price_by_income[4]` | 1,548 | What families above $110K who filed the FAFSA paid on average: the model's calibration target |
| Cost of attendance | `cost.breakdown.full_price` (IPEDS), `cost.cost_of_attendance` (Scorecard) | 1,514 / 1,733 | The curve's ceiling |
| In-state and out-of-state sticker | `cost.sticker`, `cost.residency` | 1,804 | Publics' two curves |
| Grants to students without federal aid | `aid.grant_count` − `aid.by_income.granted` (IPEDS SFA), shown today in AidBreakdown | 1,182 | Merit proxy everywhere: who got a grant without filing for federal aid |
| Need met, need-based grant | `reported.aid.first_years` H2 lines i, k; `aid.cds` | 8–12 (growing with the CDS pipeline) | Whether a college meets full need |
| Merit to students without need | H2A lines n, o | 5 | The real merit figure where reported |
| Aid methodology (FAFSA only vs CSS Profile) | `derived.aid_methodology`, `reported.aid.forms` | 5–9 | Whether assets, home equity, and siblings can matter |
| Published income promises | none yet | 0 | New curated data ([below](#published-promises)) |
| State promise programs | `cost.promise_program` (IPEDS, a yes/no) | 359 | Already shown; unrelated to the break point |

The federal data stop at $110K and cover only FAFSA filers; colleges' own aid data cover a handful. The curve above
$110K is therefore always an **estimate**, and the spec's job is to make it honest: calibrated per college, shown as
a range, gated by a pilot against the colleges' own calculators.

## The model
`lib/cost-curve.ts`, pure and tested. For a **reference family** (two parents, two children, one in college,
typical assets: the same family every published promise is stated for), the price at income *I*:

```
price(I) = federal band price               for I ≤ $110K   (published, cited)
price(I) = min(COA, max(P110, r × (I − P)))  for I > $110K   (estimate)
```
- **COA**: `breakdown.full_price` (in-state for publics), else `cost_of_attendance`.
- **P110**: the published $0–$110K curve's last step, so the estimate joins the published part without a jump.
- **P**, the income where the family starts paying more than the bottom bands: the college's published
  "no parent contribution" or "free tuition" line when there is one ([promises](#published-promises)); otherwise the
  start of the federal formula's assessed income (the income protection allowance plus taxes for a family of four,
  from the versioned need-analysis tables the [estimator](net-price-estimator.md#research-2026-10-02) already
  plans), about $90K for 2026–27.
- **r**, the ramp (cents of each extra dollar the family is expected to pay): **calibrated per college** so the model
  reproduces that college's published $110K+ band. That band is the average price paid by FAFSA filers above $110K,
  so the model averages `price(I)` over a reference distribution of incomes above $110K among families with a
  college-age child (Census CPS ASEC, stored as `data/reference/income-above-110k.json` with its year) and solves
  for *r*. The result is bounded to 0.15–0.60; outside that, the college gets no estimate.
- A free-tuition line adds a second constraint (at that income the price can't exceed COA − tuition), which pins the
  ramp more tightly where a college publishes one.

**The break point** is where the ramp meets the cost: `I* = P + COA / r`, rounded to $10K and shown as a range from
the calibration's uncertainty (*r* at the bounds that still reproduce the band within its rounding, and *P* across
its plausible range): "about $290K–$330K".

**Colleges that don't meet full need** have no clean break point: aid thins out unevenly ("gapping"). A college gets
"Little need-based aid above $110K" instead of a break point when its CDS need met is under 90%, or, without CDS data,
when its $110K+ band is already at least 85% of its COA. It gets "The federal data end at $110K" when the band is
missing or the calibration fails.

**Publics** get the in-state curve by default and a toggle for out-of-state. Out-of-state students rarely get
need-based aid at publics; when the out-of-state sticker is far above the in-state curve's top, the out-of-state
curve says "little need-based aid for out-of-state students" rather than modeling one.

**What moves the curve for a real family** (the [estimator](net-price-estimator.md) layer, shown as notes, not modeled
at the school level): assets above typical, home equity at CSS colleges that count it, a sibling in college at CSS
colleges that adjust for it, divorced or separated parents (CSS colleges usually ask for both), and a family business.

## The accuracy pilot (the gate)
No break point or estimated price ships until it passes:
- **Sample**: 25 colleges: 10 need-only privates (including Harvard, MIT, Princeton, Stanford, Penn), 8 merit-offering
  privates (including Vanderbilt, USC, Emory, Tulane, Wake Forest), 7 publics (flagships with honors merit: Alabama,
  Arizona State, UNC, Michigan, Florida, Georgia, Ohio State).
- **Method**: run each college's own net price calculator for the reference family at $125K, $150K, $200K, $250K,
  $300K, $350K, and $400K, typical assets, by hand, recording the date.
- **Bar**: the break point within ±$30K of the calculator's zero-aid income at 80% of the colleges, and the curve
  within ±$6K of the calculator at every income at 80% of the points. Merit-offering colleges are scored on need
  aid only (calculators mostly exclude merit).
- **If it fails**: tune the reference distribution and bounds once; if it still fails, ship the published part and
  the merit and promise facts, with "The federal data end at $110K; use the college's calculator" above it.
- The pilot's table goes in `specs/product/cost-by-income-pilot.md` and is re-run each year when the federal data
  refresh (the [scheduled sync](../data-sync.md)).

## Merit
`lib/merit.ts` classifies each college, from the strongest source available:
| Class | Rule | What it says |
|---|---|---|
| **Need-only** | CDS H2A line n = 0, or the college's published policy says no merit, or the IPEDS proxy is under 2% of first-years | "No merit aid. Above the break point, everyone pays full price." |
| **Offers merit (reported)** | H2A n > 0 | "18% of students without financial need got merit aid, averaging $22K (CDS 2025–26)." |
| **Offers merit (proxy)** | IPEDS grants without federal aid ≥ 2% of first-years | "12% of first-years got a grant without federal aid, averaging $15K; at most colleges that's merit aid." |
| **Unknown** | none of the above | nothing |

On the curve, merit is a **floor drawn from the break point onward** at `COA − average merit award`, dashed and lighter
than the curve, labeled with its share: never a promise that the family would get it. Once
[chances-and-fit](chances-and-fit.md) and the planner's standing exist, the merit line adds one sentence of fact when
the student's score is above the college's 75th percentile: "Merit awards usually go to students near the top of
the admitted class; your SAT is above the 75th percentile here." Never "you'd get merit".

## Published promises
New curated file `data/aid-policies.json`, one entry per college that publishes income lines or aid rules:
```
{ unit_id, as_of: "2025-26",
  free_tuition_under: 200000 | null,      // families below this pay no tuition (typical assets)
  no_contribution_under: 100000 | null,   // families below this pay nothing toward cost
  meets_full_need: true | false | null,
  no_loans: true | false | null,
  need_only: true | false | null,         // no merit aid
  home_equity: "ignored" | { cap_multiple: 2 } | "full" | null,
  siblings: "split" | "reduce" | "none" | null, siblings_note: "Parent contribution × 60% per sibling",
  source: "https://…", checked: "2026-10-10" }
```
- First pass: about 100 colleges, the most selective privates and the flagships with honors merit, each checked on
  the college's own page (no aggregator sources).
- Built 2026-10-10: 54 colleges, each quoted from a result on the college's own domain (`verified_via: "search"`; the
  page itself not yet opened, so the next pass with network access flips these to `"page"`). Entries record only
  what the college states, with `null` for the rest; an income line that conflicts between two of the college's own
  pages, or that starts in a later award year (e.g. Swarthmore, Wellesley, Davidson, Middlebury, Rice, UChicago's
  $250K line), is left out until it applies. A public's promise to its own residents (Go Blue Guarantee, Texas
  Advance Commitment) carries `applies_to: "in_state"`; absent means everyone.
- `as_of` is the award year the page states, written `YYYY-YY` and shown with an en dash; the citation (ⓘ) of every
  `aid_policy.*` value is that entry's `source`, `as_of`, and `checked` (`lib/lineage.ts`).
- Checked by `scripts/check-aid-policies.mts` in `npm run verify` (every entry has a source and `checked` date;
  thresholds are positive and ordered), registered in `lib/fields.ts` as `aid_policy.*` with source `college-site`,
  and cited like any college-published value ([data-lineage.md](../data-lineage.md)).
- Re-checked each spring in a data PR alongside the planner's cycle file; an entry older than 18 months shows its year
  and "check the college's page".
- On the curve a promise is a marker at its income ("No tuition under $200K · 2025–26 policy"); in the headline it
  replaces the estimate's range where they agree, and wins where they disagree (with the disagreement logged for the
  pilot).

## How cost is shown
### The profile's Cost page
Top of the page, replacing today's average-first layout:
1. **Three facts in a row**:
   - **Full price** $92,400 a year (COA, with its ⓘ);
   - **Need-based aid** up to about $310K family income (estimate ⓘ), or "Little need-based aid above $110K", or
     "Published data end at $110K";
   - **Merit aid**: "No merit aid" or "18% of students without need, avg $22K" (CDS or proxy ⓘ).
2. **The cost curve** (`components/charts/CostCurve.tsx`). X axis family income $0–$400K+ (linear, labeled every $50K);
   Y axis price per year from $0 to the full price.
   - The full price as a thin top rule.
   - The federal bands as solid steps (published, cited with their year) to $110K.
   - The estimate as a dashed line with a shaded range band from $110K to the break point.
   - A vertical marker at the break point: "Need-based aid ends about here".
   - Flat at full price after it.
   - The merit floor, dashed and lighter, from the break point on.
   - Promise markers at their incomes.
   - Hover/focus crosshair: "At $240K: about $38K–$47K a year (estimate)". Every mark carries a label, so color is never
     the only cue. A table view lists price by income, and dark mode is checked. Built per the dataviz skill and
     [charts.md](../charts.md).
3. **At your income**: an income slider (not saved; in memory only, like the signed-out estimator) that moves a dot
   along the curve and reads out the price range and which part of the curve it's on. A signed-in guardian sees
   their household's saved income preselected ([household finances](net-price-estimator.md#inputs), guardian-only).
   Under it, "What can change this": assets, home equity (only at CSS colleges that count it, with the college's rule
   when known), a sibling in college (only where the college adjusts), divorced parents (CSS colleges).
4. **The college's calculator**, prominent: "For your family's real number, use Harvard's net price calculator (about
   15 minutes)."
5. Below, unchanged in substance: the average across all first-years, "Who pays what", debt, AidBreakdown, the CDS aid
   table. The old "What families at each income level pay" chart is gone: the curve includes it.

### The overview's Cost card
A small version of the curve (no axes but the income ticks $0 · $110K · break point · $400K) with the three facts. It
replaces the three bars (full price, with grants, "$48–75K income").

### Compare
- New rows: **Need-based aid up to** (the break point or its alternatives), **Merit for students without need**, and
  **Published promise**.
- `NetPriceCompare` gains an income slider: each college's price at the chosen income, solid where published, hatched
  where estimated, and "full price" or "merit possible" labels past the break point. The default income is the
  household's when a guardian is signed in, else $150K.

### Explore
- Filter **"Need-based aid reaches families earning $X+"**: a slider from $110K to $400K, over the precomputed break
  points.
- Filter **"Offers merit aid"**.
- Sort **"Price at my income"** when an income is set (the household's, or the Compare slider's last value kept in
  `localStorage` as a per-viewer convenience); otherwise the existing average-cost sort.
- Cards and rows keep the average cost unless an income is set, then show "About $41K at $200K".

### The planner
- The redesigned list row's drawer ([../planner/redesign/list.md](../planner/redesign/list.md#the-drawer)) gains a
  **Cost** line: the estimate at the household's income, shown to the guardian, and to the student only when the
  guardian shares it (the [privacy model](accounts.md#privacy-model)).
- The parent's "check the cost together before ED" task
  ([../planner/redesign/rounds.md](../planner/redesign/rounds.md#money)) links to the curve at the family's income.
- **Two children in college**: the household knows both students' class years, so for a CSS college with a sibling
  policy the drawer says "From fall 2028 Theo is also in college; Duke lowers the parent share when two are enrolled."
  The FAFSA-based figure doesn't change, and the site says so.

## Wording
- "Estimate" on every modeled figure; prices as ranges rounded to $1K, incomes rounded to $10K.
- "Families like yours typically pay", never "you will pay" or "you'll get".
- Every number has its ⓘ: published (source and year), policy (the college's page and year), estimate (method, inputs,
  and the pilot's accuracy).
- No amounts in reminders, nudges, or texts (built rule).
- No years hard-coded in UI code: they come from lineage (CLAUDE.md).

## Fields and files
- Registered in `lib/fields.ts`: `derived.need_aid_break_income` (formula above; inputs `cost.breakdown.full_price`,
  `cost.net_price_by_income`, `aid_policy.*`, the reference distribution), `derived.need_aid_status`
  (`break_point | little_above_110k | data_ends`), `derived.merit_class`, `derived.merit_proxy` (share and average from
  IPEDS SFA), `aid_policy.*`.
- Precomputed in `npm run sync-data` (break point, status, merit class) so Explore can filter; the curve itself is
  computed in the browser from the stored inputs.
- New: `lib/cost-curve.ts` (calibrate, price at income, break point, range), `lib/merit.ts`, `data/aid-policies.json`
  with `scripts/check-aid-policies.mts`, `data/reference/income-above-110k.json`, `components/charts/CostCurve.tsx`,
  `components/school/CostAtIncome.tsx`; changes to the Cost page, `CostCard`, `app/compare/cost`, `NetPriceCompare`,
  Explore filters and sorts.
- Glossary: `break-point` (shown as "where need-based aid ends"), `student-aid-index`, `institutional-methodology`,
  `home-equity`; `merit-aid`, `need-met`, `css-profile`, `net-price-calculator` exist.
- Tests (`tests/cost-curve.test.mts`): the curve joins the published steps without a jump; calibration reproduces the
  $110K+ band; the break point moves the right way with COA and with *r*; a promise constrains the ramp; a college that
  doesn't meet full need gets the "little aid" status; out-of-range calibration gives no estimate; merit classes from
  each source; a guard that no estimated figure renders without the word "estimate" nearby.

## Build order
1. `aid-policies.json` (curation can start now; it's useful on its own as cited facts on profiles).
2. `lib/cost-curve.ts`, `lib/merit.ts`, the reference distribution, then the **pilot**.
3. The Cost page and card (shipping the published curve and merit facts even if the pilot fails).
4. Compare and Explore.
5. The personal layer and the planner tie-ins, with [net-price-estimator.md](net-price-estimator.md) (SAI, Pell,
   household finances), which now builds on this curve instead of its own band anchor.

## Open questions
1. **What to call the break point on the page.** Recommendation: no jargon. "Need-based aid up to about $310K family
   income" in the headline, "Need-based aid ends about here" on the chart.
2. **Show the curve to everyone, or only with an income?** Recommendation: everyone, for the reference family; the
   personal dot appears when an income is set.
3. **How far the income axis runs.** Recommendation: $400K with "and above"; very few break points sit past it, and
   those say "above $400K".
4. **Curation load.** About 100 colleges a year at roughly 10 minutes each. Recommendation: do it with the spring data
   PR, and let the college-reported pipeline flag policy pages when it fetches a college's CDS.
