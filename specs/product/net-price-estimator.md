# Your Family's Price: The Personal Layer on the Cost Curve

> Status: **planned** (not built); **rewritten** 2026-10-26 after the roadmap review. First written 2026-10-02 as a
> complete estimator. Half of it shipped on 2026-10-10 as [cost-by-income.md](cost-by-income.md): each college's cost as a
> curve over family income, the break point where need-based aid ends, the merit facts, and the published promises,
> with the estimated part gated behind a pilot against the colleges' own calculators. This spec is what remains: the
> **family's own inputs** (income, assets, household, state) placed on that curve, the federal Student Aid Index and
> Pell as versioned tables, the "what we can pay" line, and a four-year total. After [accounts.md](accounts.md) (built:
> guardian-only finances) and cost-by-income's pilot. Part of [product](README.md).

## Goal
The cost curve answers "what do families like ours pay here" at a typed income. A family wants the next step: *our*
number, from *our* FAFSA inputs, against *our* budget, across the whole list, over four years, and a link to each
college's own calculator for the authoritative figure. This tool is for comparing fifteen colleges in minutes before
running six 20-minute calculators.

## What is built, and what this adds
| Built (cost-by-income.md, 2026-10-10) | This spec adds |
|---|---|
| The curve: published federal bands to $110K, a calibrated estimate above, per college | The family's **point** on it, from income and the inputs below, with a range |
| The break point where need-based aid ends; merit classes; 54 colleges' published promises (`data/aid-policies.json`) | The family's **SAI** and **Pell** estimate, which say *why* the point is where it is |
| The planner's Cost line (the estimate at the household's income, to the guardian) | The **"what we can pay"** line, the gap "to borrow or fund", and the family's price on every plan row |
| The 25-college pilot that gates every estimate | A second pilot, **5 family scenarios × 20 colleges**, for the personal layer |
| "Families like yours typically pay", never "you will pay" | The same words; one more: "estimated from your inputs" |

What the first draft had and this drops: the three-estimate grant blend (income-band anchor, need met, merit). The
curve replaces the band anchor and the need-met line, and merit stays a separate fact as cost-by-income built it
("18% of students without need got merit aid, averaging $22K"), applied to no one.

## Research (2026-10-02, checked 2026-10-26)
- **Student Aid Index (SAI).** The FAFSA Simplification Act's need analysis has published tables per award year:
  income protection allowances, parent available-income brackets (22% to 47%), a parent asset rate of 12% with an asset
  protection allowance, student income at 50% above an allowance and assets at 20%. The number in college no longer
  divides the SAI. SAI can be negative (to −1,500), which matters for Pell. **The tables change every award year**, so
  they are versioned data, not code: the 2026–27 tables the first draft cited are last year's for the class of 2027,
  who enter in 2027–28; the build reads the award year from the student's grad year.
- **Pell.** Maximum Pell when SAI ≤ 0 or AGI is under a poverty-line multiple by family type; partial down to the
  minimum; none above a cutoff. Table-driven per year.
- **Institutional methodology.** About 200 colleges (CSS Profile) use their own formula, counting home equity and
  siblings; `derived.aid_methodology` and the CDS H8 forms (built) say which. For those the federal SAI is a floor on
  need and the range is wider; cost-by-income's `aid-policies.json` already records home-equity and sibling rules for
  54 colleges.
- Every Title IV college hosts a net price calculator; `school.links.price_calculator` is shown on profiles.

## Inputs
Guardian-owned, in `household_finances`, never readable by a student ([accounts.md](accounts.md#privacy-model)): the one
place on the site where a guardian's data is hidden from the student, by the owner's rule that privacy otherwise means
siblings, never parents ([household-hub.md](household-hub.md)). Also usable signed out, in memory, nothing saved.

| Input | Why |
|---|---|
| Parents' AGI, filing status, untaxed income (optional), number in household, number of children in college, state of residence | SAI; in-state pricing; CSS sibling rules |
| Parent assets (cash and investments; not retirement, not the home) | SAI (12%) |
| Student income and assets (optional) | SAI |
| Home equity (optional) | CSS Profile colleges only |
| **What we can pay** a year (optional) | The line on every chart and the "to borrow or fund" gap |
| Which students in the household this applies to | Two students in college get separate figures |

Four fields are enough for a first range (AGI, household size, number in college, state); the form says so.

## Method
Computed in `lib/net-price/` (pure, tested); tables in `data/reference/need-analysis/{award-year}.json` with a source
URL and date, registered in `lib/fields.ts` as derived fields so every output is cited.

1. **SAI** from the federal formula for the award year the student enters (grad year + 1), and the Pell estimate from
   the same tables.
2. **The point on the curve.** `lib/cost-curve.ts` (built) gives the college's price at the family's income for the
   reference family. The personal layer adjusts it for how this family differs from the reference: the SAI relative to
   the reference family's SAI at the same income (assets, household size, number in college), and the in-state or
   out-of-state sticker by the student's state (built in the curve for publics). The adjustment is bounded by the
   curve's own range, and a college with a published promise keeps it where it applies.
3. **Range and words.** "About $28K–$36K a year, estimated from your inputs", wider when the college is CSS Profile,
   has no CDS, or the family is above $110K; a line always says "Run this college's net price calculator for its own
   estimate" with the link. Loans are never subtracted.
4. **The gap.** Price range minus "what we can pay", shown as "to borrow or fund"; the shape's affordability check
   ([../planner/next-steps/list-shape.md](../planner/next-steps/list-shape.md)) reads this instead of the cost limit
   when it exists.
5. **Four years.** Price grows at the college's own ten-year trend (history, capped at the national rate); grants
   assumed flat unless the college has a tuition guarantee ([../data-expansion/housing-and-policies.md](../data-expansion/housing-and-policies.md));
   total, and a monthly figure at the award year's federal loan rate if the gap were borrowed. The typical-time-to-degree
   variant belongs to [ideas/cost-to-a-degree.md](../ideas/cost-to-a-degree.md) and is built with it, not here.

## Display
- **The record's household step** (guardian): the form, with "Why we ask" folded ([../planner/record/less-text.md](../planner/record/less-text.md)).
- **The plan**: the family's range on each row's panel in place of the built Cost line, and the "can pay" line on the
  Colleges tab's cost view; the student sees the range and the gap, never the inputs; the guardian sees both. This
  follows the owner's rule that a parent sees the student's view word for word
  ([../planner/v3/parents.md](../planner/v3/parents.md)): the only difference is the inputs, which are the guardian's.
- **Profile, Cost page** (signed in with finances): "For your family: about $X–$Y" beside the curve, with the SAI and
  Pell in the popover.
- **Compare**: a "Your estimated price" row.
- **Glossary**: `student-aid-index` (built), `need`, `percent-of-need-met`, `css-profile`, `tuition-guarantee`.
- **Financial-aid moves** on the plan stay hidden until the owner turns them on (decision 2026-10-15); this spec adds
  no move. When they return, "run the family's price" is the first.

## Validation
- Unit tests pin the SAI formula to the Department of Education's worked examples for the award year.
- **Pilot:** 20 colleges (CDS and not, public and private, CSS Profile and not; the 25 of cost-by-income's pilot are the
  pool), 5 family scenarios each, run through the colleges' own calculators by hand; ship only if the college's figure
  falls inside the range at least 80% of the time; publish the check on the Data page beside cost-by-income's and
  repeat yearly.
- The tables are a release-calendar entry; the page warns when the newest table is older than the student's award year.

## Files (planned)
- `lib/net-price/{sai,pell,point,project}.ts`, `data/reference/need-analysis/{award-year}.json`, the household step in
  the record, `components/costs/`, migration `…_household_finances.sql` (guardian-only policies, tested in the PGlite
  harness), `tests/net-price.test.mts`.

## Open questions
1. Free or paid? Recommendation: the SAI and Pell estimate free (families should never pay to learn federal aid); the
   per-college range and the four-year total with the advisor ([commercialization.md](commercialization.md#feature-map)).
2. Does cost-by-income's pilot need to pass first? Yes for the estimated part of the curve; the published part (to
   $110K) and the SAI are enough for most families, so the personal layer can ship on the published bands while the
   gate is closed, saying so.
3. Which calculators publish their logic? If a college's calculator is the federal template, its inputs are known and the
   pilot can call it; check in the pilot.
