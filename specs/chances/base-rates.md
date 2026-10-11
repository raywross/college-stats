# The Admit Rate for Your Pool: Automatic Admission, Major, and Residency

> Status: **planned** 2026-10-10. Part 3 of [admission chances](README.md). Builds on the residency grid
> ([cds-residency-admissions.md](../data-expansion/cds-residency-admissions.md), built: `rateForStudent`), early rounds
> ([cds-admissions.md](../data-expansion/cds-admissions.md), built: C21/C22), and promotes part of the
> [getting into the major](../ideas/getting-into-the-major.md) idea. An input to [Quad's estimate](estimate.md).

## Goal
A college's overall admit rate blends pools that face very different odds: in-state and out-of-state applicants at a
public university, applicants to a direct-admit engineering school and to the college of arts and sciences. Families
deserve the rate for *their* pool, from the college's own figures, with its source. This part finds the most specific
published rate that matches the student, shows it, and hands it to the estimate as an input.

Georgia Tech is the clearest example: about 9% of all applicants admitted, but 29% of Georgia residents and 10% of
everyone else (its CDS; its own 2026 admitted profile reports 28% and 9%). Purdue: 71% of Indiana applicants, 44% of
others.

## The rates
`poolRateFor(student, school)` in `lib/chances/pool-rate.ts` (public, pure) returns the most specific published rate
that matches the student, with its kind, label, field path, and edition, else the overall rate:

| Kind | When it applies | Source | Coverage (2026-10-10) |
|---|---|---|---|
| **Automatic admission** | The student meets a published automatic-admission rule for this college (state, class rank, sometimes GPA or curriculum) | New `data/guaranteed-admission.json`, one entry per program with its source | A curated set; see [below](#automatic-admission) |
| **Major** | The student's first intended major maps to a unit that admits separately and the college publishes that unit's admit rate | `reported.major_admission[]`, first wave | 0 today; the first wave targets about 50 universities |
| **Residency** | The college's CDS has a residency grid and the student's state is known | `rateForStudent` (built) | 71 colleges with in- and out-of-state rates |
| **Overall** | Otherwise | `admissions.acceptance_rate` (newest of CDS and IPEDS, built) | 1,547 colleges |

When a college publishes the cross of two (out-of-state applicants to nursing), it is used; otherwise the major rate
is shown and residency is named in words. Early-decision rates are shown as their own fact (below), not as the pool's
rate.

### Automatic admission
Some public systems admit by rule:
- **Texas** automatically admits residents in the top 10% of their class at most public universities. UT Austin,
  whose automatically admitted students are capped at 75% of its resident first-year places, sets a smaller cut each
  year: top 6% for fall 2025, **top 5% for fall 2026 and fall 2027** (UT Austin's notice to the Texas Education Agency,
  2025-12-18).
- **California**: Eligibility in the Local Context (top 9% of a participating high school's class) guarantees a place
  in the UC system, not at a chosen campus; shown as a system-level line, never as a guarantee at a campus.
- Other state programs with GPA or rank thresholds (College Kickstart keeps a yearly list); each is verified against
  the college's or system's own page before it enters the file.

```
data/guaranteed-admission.json
{ "cycle": 2027, "programs": [
  { "id": "tx-auto-ut-austin", "unit_ids": ["228778"], "state": "TX",
    "rule": { "class_rank_top_pct": 5, "resident": true, "curriculum": "Texas distinguished level of achievement" },
    "scope": "campus" | "system", "major_guaranteed": false,
    "source": { "url": "…", "retrieved": "…", "quote": "…" } } ] }
```
- Checked by `npm run verify` (schema, a source per program, `unit_ids` exist, the cycle is current or next).
- A program applies only on fields the student gave (`classRankPercentile`, state, GPA); otherwise it is shown as
  "You may qualify for Texas automatic admission if you're in the top 5% of your class", never assumed.
- A guarantee to the campus is never a guarantee to a major (UT Austin and Texas A&M both say so); when the student's
  major admits separately, that is said too.
- A program that applies gives the estimate's **Guaranteed for you** label ([estimate.md](estimate.md#the-output)).
- **Direct admissions** (colleges that admit students before they apply, through Common App and others) can't be
  predicted from a profile; the planner mentions it once as a way to add colleges, with no claim about any student.

### Major
From the first wave of `reported.major_admission[]` ([the idea's data model](../ideas/getting-into-the-major.md#data)):
the unit, whether it admits first-years directly, and its published admit rate with its year and quote. First wave:
the universities where the gap is large and public (engineering, computer science, nursing, and business at the big
direct-admit publics such as Illinois, Purdue, Georgia Tech, Washington, Texas, Virginia Tech, and the UC campuses'
published rates by discipline), read by the college-reported agent with a quote for every value. The same records
carry how the unit reviews grades ([major-and-grades.md](major-and-grades.md)). Where a college admits a major
separately but publishes no rate, the major adds words, not a number: "Computer science admits separately here and is
more selective than the university overall."

### Residency
Built. `rateForStudent` returns the student's group rate (in-state, out-of-state, international) from the same CDS
edition; this part calls it through `poolRateFor`.

### Early decision, as a fact
Where the CDS has C21 counts (42 colleges), a student whose round is ED sees: "Early decision admitted 18% here
against 6% overall (fall 2025); much of that gap is recruited athletes and other students with an inside track." The
caveat comes from [early-decision-strategy.md](../product/early-decision-strategy.md#research-2026-10-02) and the
research behind it (applying early helps an unhooked applicant far less than the raw gap suggests). Early action has
no admit counts in the CDS template; nothing is said about its rate.

## Where it shows
- **Profile**: in the standing card's "what went into it" panel ([estimate.md](estimate.md#what-went-into-it)) and,
  for a signed-in student with a state, beside the acceptance ring as the built "for you" row from the residency grid,
  plus the automatic-admission line when one applies.
- **Planner**: never on the list row (no statistics on the first screen); in the row's ⓘ panel. An automatic-admission
  program shows as "Guaranteed for you: Texas automatic admission (top 5%)".
- **Compare**: the "Where you stand" row names the rate kind under each estimate ("in-state rate", "guaranteed").

## Lineage
- The rate shown cites the field it came from (residency grid, major admission, program, or overall rate). Register
  `reported.major_admission.*` and a `reference.guaranteed_admission` source in `lib/fields.ts` with the program's URL
  and cycle.
- The program file's cycle reaches the sentence through lineage, never written in a component.

## Files (planned)
`lib/chances/pool-rate.ts` (pure), `data/guaranteed-admission.json` with its verify check, the first wave of
`reported.major_admission` (agent recipe + review queue), `tests/chances-pool-rate.test.mts` (order of precedence, a
program that applies and one missing a field, system vs campus scope, major + residency without a cross).

## As built (2026-10-11)
- `lib/chances/pool-rate.ts` (pure, client-safe): `poolRateFor(student, school, { overallYear? })` returns the
  `PoolRate` contract plus `notes` (catalog keys with formatted values and the field each cites), `programs` (each
  program at the college with `applies` / `may_qualify` / `not_met` / `not_eligible` and the missing inputs), and
  `facts`. Also `programStatus`, `programLabel` ("Texas automatic admission (top 5%)"), `earlyDecisionNote` (the ED
  fact for a student whose round is `ed` or `ed2`), `admitsSeparately`. A guarantee's curriculum isn't checked (the
  profile doesn't record it); it travels with the program's source. With a campus guarantee in hand, other campus
  programs' "may qualify" lines are dropped; programs sharing a name show one line, the easier tier.
- `data/guaranteed-admission.json`, cycle 2027, 8 programs over 62 colleges: Texas top 10% (34 public universities
  other than UT Austin; the health science centers don't admit first-years), UT Austin top 5%, UC ELC (system scope,
  9 campuses), the Wisconsin Guarantee (top 5% for UW–Madison, top 10% for the other 12 universities), University of
  Arizona assured admission (top 25% or a 3.0 core GPA), and Idaho Direct Admissions (3.0 for all four public
  universities, 2.25 for Idaho State and Lewis-Clark State). Every source was read through search results
  (`verified_via: "search"`): official pages couldn't be fetched from the build container, so each quote should be
  checked on its page at the next data run. Not added: Iowa's Regent Admission Index (a formula, not a rank or GPA
  threshold), Washington's guaranteed admissions program (participating districts only), Kansas, South Dakota, and
  ASU (sources conflicted or state admission requirements rather than a guarantee).
- Schema additions (additive): `rule.match` ("any" for "top 25% OR a 3.0"), `system_name` (required for system
  scope), and the check now requires a GPA threshold to appear in the quote. `reported.major_admission` units may
  carry `published_rate` (a percentage printed without counts, like Illinois's rates by college), cited like an admit
  rate. `guaranteedProgramCitation(path, program)` in `lib/lineage.ts` cites the program a line names
  (`PoolRate.programId`), since a college can have two.
- Tests: `tests/chances-pool-rate.test.mts`.

## Open questions
1. Should UC's ELC appear at all, given it guarantees the system but not a campus? Recommendation: yes, once, as a
   system line on the planner's Colleges tab when the student has any UC on the list.
2. Who keeps the program file current? Recommendation: the data-run checklist gains a yearly "verify automatic-admission
   programs" step each August; an entry whose cycle is past fails verify.
3. Should sex-specific admit rates (IPEDS reports admits by sex) be shown as a pool rate? Recommendation: no; the
   profile doesn't ask for it, and the national trends study already shows them as context.
