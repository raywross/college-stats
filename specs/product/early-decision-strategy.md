# Early Decision and Early Action: Does Applying Early Help?

> Status: **planned** (not built). After [cds-admissions.md](../data-expansion/cds-admissions.md) (which collects CDS
> C21/C22 through the [college-reported data agent](../college-reported-data.md)). Part of [product](README.md).

## Goal
Show, per college and per year, the early decision (ED) admit rate against the regular decision (RD) rate, how much
of the class is filled early, and how both have moved, with the caveats that make the numbers honest. Then help a
student decide whether an early application makes sense for them, including the money question ED raises.

## Research (2026-10-02)
- **CDS C21** asks whether a college offers ED, its deadlines, and the number of ED applications and admits;
  **C22** covers early action (restrictive or not) and its deadlines. Admit counts for EA are not in the template.
  The site's existing CDS overrides already carry C21 for 8 colleges; the agent extends it.
- At selective colleges that publish numbers, the ED admit rate is typically two to three times the overall rate
  (fall 2025 class: Duke 13.8% ED, Brown 16.5% ED, Vanderbilt 11.9% across ED I and II, Emory 29.0% ED I, against
  low-single-digit RD rates). The gap overstates the advantage for an unhooked applicant: recruited athletes,
  legacies, and other hooked applicants are concentrated in ED pools, and ED applicants self-select.
- ED is binding, so a family can't compare offers; the only protection is a reliable estimate of the price before
  applying ([net-price-estimator.md](net-price-estimator.md)).
- Several colleges now fill 50%+ of the class early; "share of class filled by ED" is the number that tells a
  regular-round applicant how much room is left.

## Data
From `school.reported.admissions.early_decision` and `early_action` per CDS edition
([cds-admissions.md](../data-expansion/cds-admissions.md#store)), with the same edition's C1 totals:

| Measure | Formula | Note |
|---|---|---|
| ED admit rate | ED admitted ÷ ED applicants | As reported |
| RD admit rate (estimated) | (total admitted − ED admitted) ÷ (total applicants − ED applicants) | Includes EA admits where EA exists, so it's an upper bound on RD; labeled "non-ED" when the college has EA |
| ED advantage | ED rate ÷ non-ED rate | Shown as "2.4× the non-ED rate", never as "your odds go up 2.4×" |
| Share of class from ED | ED admitted × assumed ED yield (0.95) ÷ enrolled | Yield assumption stated; replaced by the college's number when a class profile states it |
| Trend | the above per edition | Series once two editions exist |

Checks (added to the agent): ED admitted ≤ ED applicants ≤ total applicants; ED admitted ≤ total admitted; an
ED advantage over 8× goes to review.

## Display
- **Profile, Admissions → "Applying early":** ED and EA offered (with deadlines and whether EA is restrictive); a
  paired bar (ED vs non-ED admit rate) with the advantage line; share of class filled by ED; a short series when
  editions exist. Caveats inline, as `Term`s: `early-decision`, `early-action`, `restrictive-early-action`,
  `ed-advantage`, `hooked-applicant`.
- **Explore:** filters "Offers ED", "Offers EA", "Fills under 40% of class early"; a sort by ED advantage among
  colleges with 1,000+ ED applicants.
- **Compare:** rows for ED rate, non-ED rate, share of class from ED.
- **Home fact candidate:** share of the class filled early at the 50 most selective colleges, over five editions.
- **For a signed-in student** (with [chances-and-fit.md](chances-and-fit.md) and the family's estimate): a
  "Should I apply early here?" checklist with three answers, each from data:
  1. *Is there a measurable advantage?* The advantage, and whether the student's standing is Target or above
     (an early application doesn't turn a Reach into a Target).
  2. *Can the family afford to be bound?* The guardian's shared estimate for this college against the family's
     "can pay" line; red if no estimate was shared ("ED is binding; get an estimate first").
  3. *Does it cost other options?* The deadlines of the student's other early-round choices (restrictive EA rules
     and single-choice limits conflict).
  The checklist is advice-shaped data, with no recommendation sentence; the student decides.

## Keep history?
**Series per edition** for ED applicants, admits, and the share of class, as [cds-admissions.md](../data-expansion/cds-admissions.md#keep-history) says.

## Files (planned)
- `lib/early.ts` (measures, pure, tested), `components/school/ApplyingEarly.tsx`, `tests/early.test.mts`,
  glossary entries, Explore filter params `ed`, `ea`, `edShare`.

## Open questions
1. EA admit counts aren't in the CDS; class profiles sometimes state them. Extend the agent's class-profile
   schema with optional EA counts when seen.
2. Plus feature per the idea document; recommendation: the profile section free, the checklist and Explore
   filters with Plus ([commercialization.md](commercialization.md#feature-map)).
