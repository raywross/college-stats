# Part 2, Good ED Opportunities: Where a Binding Early Application Would Help

> Status: **planned** 2026-10-14. After [seasons.md](seasons.md) and the five levels
> ([../../chances/levels.md](../../chances/levels.md)); uses the estimate's ED verdict
> ([../../chances/method/standing.md](../../chances/method/standing.md#the-ed-sentence)) and the built early-round data
> ([../../product/early-decision-strategy.md](../../product/early-decision-strategy.md)). Part 2 of [next steps](README.md).
> Replaces the ED guard's one-line suggestion and the ED II offer in [../redesign/rounds.md](../redesign/rounds.md).

## Goal
A student looks at the list and sees, on at most three rows, **Good ED opportunity** or **Good ED II opportunity**:
colleges where applying in a binding early round would move the college up a level for *this* student, by the data
the college published. Tapping shows the facts, the caveats, the cost question, and a button that sets the round.
Nothing says "apply"; the owner's decision (2026-10-14) is that the plan may flag an opportunity by name.

## What the data can say
- **Availability**: ED I, ED II, EA, REA from CDS C21/C22 (`school.reported.admission_profile.early_decision` /
  `early_action`; built `roundsOffered()`). Known at 216 colleges for ED and 56 for ED II as of 2026-10-13.
- **The verdict**: `EstimateResult.ed` is `"helps"` when the estimate, with the ED multiplier applied, places the
  college one level higher for the student; `"same"`, `"not_advised"` (High reach), or null when the college
  publishes no ED counts or the student has no level. The multiplier already discounts the raw ED gap (the hooked
  pool), caps the effect, and compares ED against the same document's overall rate where the lineage allows (33 of 79
  colleges) and the overall rate otherwise. **No pill without `helps`.** That rules out colleges where the ED and
  overall rates are about equal (Franklin & Marshall) or reversed (Loyola Maryland) without a special case.
- **Closeness** within a level (`closeness` 0–3, 3 nearest the level above; null when a cap or floor set the level,
  so always null at Ultra selective colleges). It orders candidates; it is never shown.
- **ED II**: one count pair covers both rounds at nearly every college, so the verdict is the same for ED I and ED II,
  but ED II's real edge is smaller (the class is part-filled by then; Emory, which reports separately, admitted 10% in
  ED II against 11% overall). The pill for ED II says so.

## Candidates and ranking
`edOpportunities(rows, estimates, schools)` in `lib/planner/ed-opportunities.ts` (pure):
1. **Candidates**: rows whose college offers ED (C21 `offered`), whose estimate says `ed === "helps"`, and whose level
   is Reach or Target. (High reach is `not_advised`; Likely and Safe don't need a binding round; Ultra selective has no
   verdict.) A row the student dismissed ("Not for me") is out. A row already in ED or ED II by the student's choice
   stays a candidate so its pill reads as confirmation.
2. **Rank** (the owner's order): the **Dream** first if it's a candidate; then **Reach, lower end** (closeness 3, then
   2); then **Target, upper end** (closeness 0, then 1); then the remaining Reaches (1, 0) and Targets (2, 3); ties by
   the student's own order.
3. **Cap**: the first three.
4. **Round per pill**: the first candidate is **ED** (ED I). Each later candidate is **ED II** if its college offers
   ED II and its ED II deadline falls after the first candidate's ED notification date (the built conflict rule);
   otherwise it is an **alternative ED**, shown with the same pill and a sheet that says ED is one college. So "easier"
   colleges (the upper-Target ones, ranked after the Reaches) are the ones that get ED II, which is what the owner asked.
5. **With no Dream**: the same ranking without the first rule. The built auto-round rule "no Dream, no binding round"
   still holds for the *starting* round; the pill is a flag the student can act on.

A college whose pill would show but whose round was set to ED by `autoRounds` (a Dream at Reach or Target) keeps the
pill; its button reads **Keep ED** and the sheet says "On your plan: ED".

## The pill
On the list row, right end, accent background, text **Good ED opportunity** or **Good ED II opportunity** (phones:
**ED** / **ED II** with the same color and an accessible label). At most three across the list. Tapping opens the
row's details with the ED sheet at the top. The Next steps tab shows the same opportunity as a card
("Good ED opportunity: Wake Forest · Target for you") whose button opens the sheet.

## The sheet
Facts first, then the caveats, then the questions, then the button. Every number is a cited college fact; nothing is
from the estimate but the level.
1. **Quad's read**: the built sentence, `ed.helps`: "Early decision would move this toward {level}; it's binding, so
   check the cost first." For ED II: "…Early decision II too, though less: {College} reports its ED rounds together,
   and much of the class is admitted in the first."
2. **What {College} reports**: ED admitted {n} of {m} ({rate}%) against {rate}% overall ({edition}, CDS C21/C1), with
   "same document" or "overall rate from {year}" per the lineage; the share of the class admitted early where the
   measure exists (`classShareLine`, built). Where the counts cover both rounds: "ED I and ED II together."
3. **The caveat**, one sentence: "Early pools include recruited athletes and legacies, so the edge for most applicants
   is smaller than the gap" (`hooked-applicant` glossary term).
4. **Three questions**, as checkboxes the student answers for themselves, stored on the item (`ed_checks jsonb`):
   *Would you go if admitted, whatever the others say?* · *Has a parent checked the cost?* (ticked by the built
   `cost_check` task; its calculator link beside it) · *Can the application be ready by mid-October?* (ED II: by the
   ED II date). Unticked boxes don't block the button; they are the advisors' three tests made visible.
5. **The dates**: deadline and notification for the round, with ⓘ and the last-cycle note where it applies.
6. **Buttons**: **Start it in ED** / **Start it in ED II** (sets `round` as the student's choice, `round_source =
   'student'`; generates the `cost_check` parent task if not present; ticks the `ed_decide` move) and **Not for me**
   (dismisses the opportunity for this college; `list_items.ed_dismissed_at`; the pill goes, the next candidate moves
   up). For a guardian: the facts and questions, no round button ("{First} picks the round"), the cost check as theirs.
7. **How early rounds work at {College}** links the profile's "Applying early" section.

## Moves and timing
| When | What shows | Source |
|---|---|---|
| Before junior spring | Nothing. The list is exploratory and a pill would read as pressure. | owner: "when best to show it in the lifecycle" |
| Junior spring → summer | The pills on the list; on the Next steps tab, one quiet card per candidate ("Good ED opportunity: {College}"), folded under More this season after the first | advisors firm ED over the summer |
| Summer before senior year | `ed_decide` move in Now: "Decide on ED (due {date})", one card listing the candidates, with each sheet one tap away; parent move `cost_check` for each candidate 21 days before (built, now generated per candidate, not only per ED row) | the built `decide_rounds` task becomes this move |
| Senior fall | The pills stay until the ED deadline; the decide card turns dated 14 days before and overdue after | college dates |
| Mid-December | On a recorded ED deferral or denial: `ed2_decide` in Now for the ED II candidate(s): "{ED college} said no. ED II at {College} is due {date}." (the built ED II re-offer, now a move) | [applying.md](applying.md) |
| After the ED II deadline | Nothing more; pills gone for the cycle | |

The pills recompute with the estimate: a retake that moves a college from High reach to Reach can add a pill; a
dismissed college never returns.

## What changes in the built rules
- `edHelpsMostSuggestion()` and `edTwoSuggestion()` ([../redesign/rounds.md](../redesign/rounds.md)) are replaced by
  the pills and moves; their `PlanNotice` lines go. The ED guard on the Dream's starting round stays.
- The rule "No sentence recommends applying early anywhere" becomes: *Quad may flag a Good ED opportunity by name,
  with the facts and caveats one tap away; it never says 'apply' and the student sets the round.* Updated in
  [../redesign/rounds.md](../redesign/rounds.md#rules) and [../README.md](../README.md#decisions-in-short) when built.
- No pill where coverage is missing: an ED college without counts shows, in the row's details, "ED offered; {College}
  hasn't published its ED counts" (the built line), and nothing on the row.

## Rules
- At most three pills; never two colleges labelled plain ED without the sheet saying ED is one college.
- A pill never shows a percentage, a multiple, odds, or closeness; the sheet's numbers are the college's own, cited.
- Nothing is written until the student presses the button; a guardian can't set a round.
- "Not for me" is final for the cycle; the brief and the tab never resurface it.
- Telemetry: `plan_ed_pill_shown {round, level, rank}`, `plan_ed_sheet_opened`, `plan_ed_started {round}`,
  `plan_ed_dismissed`; never the college.

## Files (planned)
`lib/planner/ed-opportunities.ts` (candidates, rank, round per pill, `edSheetFacts`), `components/planner/EdPill.tsx`,
`EdSheet.tsx`, `EdDecideCard.tsx`; `ed_decide` and `ed2_decide` kinds; migration `list_items.ed_dismissed_at`,
`list_items.ed_checks`; removal of the two notice lines. Tests: `tests/planner-ed-opportunities.test.mts` (Dream first;
the closeness order; three-cap; ED II only after the ED I notification; the alternative-ED wording; no pill at
`same`/`not_advised`/null; dismissal; the junior-spring gate; a guard that the pill text never carries a number).

## Open questions
1. Should a pill show for a Dream at Likely that offers ED (the verdict is `same`: ED changes nothing)? Recommendation:
   no pill; the Dream's starting round is ED already and the sheet is reachable from the details.
2. When ED counts are from the previous cycle's edition, show the pill with the last-cycle note or wait? Recommendation:
   show, with the note; the verdict is the best information the family has.
