# Net Price Estimator: What This Family Would Pay

> Status: **planned** (not built). After [accounts.md](accounts.md) (guardian-only finances). Reuses
> [cost-outcomes.md](../cost-outcomes.md) and history ([trends-data.md](../trends-data.md)). Part of [product](README.md).

## Goal
Published net prices are averages over everyone who got federal aid. A family wants *their* number. Given a
guardian's income, assets, household size, and the student's state, estimate what the family would pay at each
college on the student's list, as a **range with its reasoning**, plus a four-year projection. Link to the college's
own net price calculator for the authoritative figure; this tool is for comparing many colleges in minutes before
running six 20-minute calculators.

## Research (2026-10-02)
- **Student Aid Index (SAI).** The 2026–27 federal need analysis (FAFSA Simplification Act) has published tables:
  income protection allowance $44,880 for a family of four with a dependent student, $11,770 for the student;
  parent available income assessed in brackets from 22% to 47%; parent assets assessed at 12% with an asset
  protection allowance of $0 for the third year; student income assessed at 50% above the allowance and student
  assets at 20%. The number in college no longer divides the SAI. SAI can be negative (down to −1,500), which
  matters for Pell. The tables change every award year, so they're versioned data, not code.
- **Pell.** Maximum Pell when SAI ≤ 0 or when AGI is under a poverty-line multiple (175%–225% depending on
  family type); partial Pell down to the minimum; none above a cutoff. Also table-driven per year.
- **Institutional methodology.** About 200 colleges (CSS Profile) use their own formula, counting home equity and
  more. For those, the federal SAI is a floor on need, and the estimate is wider.
- **What colleges actually give** is the harder half. Sources the site already has or has planned: net price by
  income band (Scorecard, five bands, federal-aid recipients); aid generosity and grant per student (IPEDS SFA);
  CDS section H (percent of need met, average need-based grant, **H2A** non-need "merit" awards: count and
  average, so share = H2A count ÷ first-year enrollment). MyinTuition shows a 6-question estimator is enough for a
  ballpark; its partner colleges publish nothing we can reuse, but its design (a range, three minutes) is the bar.
- Every Title IV college must host a net price calculator; Scorecard gives its URL (`school.links.price_calculator`),
  already shown on profiles.

## Inputs
Guardian-owned, stored in `household_finances` and never visible to a student
([accounts.md](accounts.md#privacy-model)). Also usable signed out, in memory only, with nothing saved.

| Input | Why |
|---|---|
| Filing status, parents' AGI, untaxed income (optional), number in household, **number of children in college** (affects institutional aid at some colleges, not SAI), state of residence | SAI, in-state pricing |
| Parent assets (cash and investments; not retirement, not the home) | SAI (12%) |
| Student income and assets (optional) | SAI |
| Home equity (optional) | CSS Profile colleges only |
| Which student(s) in the household this applies to | A household with two students in college gets separate estimates |

Six fields are enough for a first range (AGI, household size, number in college, state, assets, student). The form
says so and lets the rest be skipped.

## Method
Computed in `lib/net-price/` (pure, tested); tables in `data/reference/need-analysis/{award-year}.json` with a
source URL and date, registered in `lib/fields.ts` as derived fields so every output is cited.

1. **SAI** from the federal formula for the award year the student will enter (grad year + 1); Pell estimate from
   the same tables.
2. **Cost of attendance** per college: the site's full price (`cost.breakdown.full_price`, on-campus), using the
   in-state or out-of-state sticker by the student's state; projected to the entry year with the college's own
   10-year price trend from history (`trends`), capped at the national rate.
3. **Need** = COA − SAI (floored at 0).
4. **Expected grant**, three estimates, combined into a range:
   - *Income band anchor:* the college's net price for the family's income band (Scorecard, aided students) gives
     an implied grant = COA − band net price. Weight high for families under $110K (the bands cover them) and low
     above (the top band is open-ended).
   - *Need met:* CDS H "percent of need met" × need, when the college has CDS; otherwise the sector median from
     the colleges that do.
   - *Merit:* if the college reports H2A, the share of first-years with a non-need award and its average; shown as
     a separate "possible merit" line, applied only when the student's standing is Target or Likely
     ([chances-and-fit.md](chances-and-fit.md)); never promised.
5. **Estimated price** = COA − grant range, shown as "about $28K–$36K a year". Loans are never subtracted. The
   gap between the range and the family's "what we can pay" input (optional) is shown as "to borrow or fund".
6. **Four years:** price grows at the college's trend; grants assumed flat unless the college has a tuition
   guarantee ([housing-and-policies.md](../data-expansion/housing-and-policies.md)); total and a monthly figure at
   the current federal loan rate if borrowed (rates in the same reference file).

Every output shows the inputs used, the sources with years, and a confidence word (wider range when a college has
no CDS, is CSS Profile, or the family is in the top band). A line always says: "Run this college's net price
calculator for its own estimate" with the link.

## Display
- `/me/costs` (guardian) and a "Costs" block on each list row: range per college, a sortable table across the list,
  a `RangeBar`-style chart with the family's "can pay" line, and the four-year total.
- **Profile, Cost & outcomes** (guardian signed in): "For your family: about $X–$Y" beside the all-student average,
  with the reasoning in a popover.
- **Student's view:** only what the guardian shares ([accounts.md](accounts.md#privacy-model)): a range per college
  and the "to borrow" gap, no inputs; otherwise "Ask a parent to run the cost estimate".
- **Compare:** a "Your estimated price" row for guardians.
- **Glossary:** `student-aid-index`, `need`, `percent-of-need-met`, `merit-aid`, `css-profile`, `tuition-guarantee`.

## Validation
- Unit tests pin the SAI formula to the Department of Education's worked examples for 2026–27.
- **Pilot:** 20 colleges (mix of CDS and not, public and private, CSS Profile and not), 5 family scenarios each,
  run through the colleges' own calculators by hand; record both numbers. Ship only if the college's figure falls
  inside the range at least 80% of the time; publish the check on the Data page and repeat yearly.
- Tables must be updated each award year (a release-calendar entry; the page warns when the entry year is older
  than the student's entry year).

## Files (planned)
- `lib/net-price/{sai,pell,grant,project}.ts`, `data/reference/need-analysis/2026-27.json`, `app/me/costs/`,
  `components/costs/`, migration `…_household_finances.sql`, `tests/net-price.test.mts`.

## Open questions
1. Free or Pro? Recommendation: the SAI and Pell estimate free (families should never pay to learn federal aid);
   per-college ranges for up to 3 colleges free, the whole list and projections with Pro
   ([commercialization.md](commercialization.md#feature-map)).
2. Which net price calculators publish their logic? If a college's calculator is the federal template, its inputs
   are known and the estimate could call it; worth checking in the pilot.
