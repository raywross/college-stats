# Part 5, Applying: The Senior Moves From Submit to "Where I Landed"

> Status: **planned** 2026-10-14. After [seasons.md](seasons.md); re-homes the built but unrendered application and
> decision controls ([../applications.md](../applications.md), [../offers.md](../offers.md)) that the simplification of
> 2026-10-12 took off the list row ([../redesign/list.md](../redesign/list.md#simpler-planner-owner-2026-10-12): "there
> for seniors; remove for now, I'll want to tie this into the recommendations in a future PR"). Part 5 of [next steps](README.md).

## Goal
From August of senior year the plan walks the student through each college: submit it, mark it, record what the
college said, act on a deferral, compare the offers, choose by May 1, and tell Quad where they landed. Each is a move
with a date from the college's own record, and each writes the fact the rest of the planner already reads
(`list_items.status`, `applied_on`, `outcome`, `decision_date`, `enrolling`), so the Offers tab appears again and the
outcome pool fills.

## What exists and has no screen
`markApplied`, `markComplete`, `setPlatform`, `setPortalUrl`, `setCounts`, `markWithdrawn` (`lib/planner/store-apply.ts`);
`recordDecision` and `OutcomePicker` (`lib/planner/store-offers.ts`); `choose`, `withdrawCollege`; the generated
`fee`, `send_scores`, `transcript`, `recommendation`, `supplement`, `submit`, `portal_setup`, `portal_check`,
`continued_interest`, `waitlist_*`, `add_offer`, `deposit`, `withdraw` tasks; `application_snapshots` written on
applied; `consentOutcomeShare`. All built on 2026-10-08; `CollegeApplyCard` and `ApplyStatusControl` are imported by
nothing. This part gives them cards; it adds no new store code beyond the outcome-share move.

## The moves
Generated per college from `senior_fall` (and for a late joiner, from whenever they arrive) by the built `college` and
`apply` generators, surfaced as cards with these actions:

| Move | When | Card | Action |
|---|---|---|---|
| **Submit {College} ({round} · {date})** | from 30 days before the chosen round's deadline; overdue after | the deadline with ⓘ, the fee and waiver (C13), the platform, the counts of supplements and recommendations as sub-steps, "Common App" link when it's the platform | **Mark applied** (`markApplied`: `applied_on`, status `applied`, the snapshot); the sub-step ticks |
| **Confirm {College} has everything** | 7 days after applied, while not complete | the portal link (`portal_url`, set here) | **It's complete** (`markComplete`) |
| **Record {College}'s decision (expected {date})** | from the round's notification date (C21/C22/C16) until recorded | the date with ⓘ | the outcome picker: Admitted · Denied · Waitlisted · Deferred (`recordDecision`); Admitted opens the Offers tab's entry for this college |
| **ED II at {College}, if you want it** | on a recorded deferral or denial from the ED college, while an ED II candidate exists | from [ed-opportunities.md](ed-opportunities.md#moves-and-timing) | **Start it in ED II** |
| **Write to {College}: you're still interested** | on a deferral (built `continued_interest`) | one paragraph on what a letter of continued interest is; no template | tick |
| **Wait list at {College}: accept a spot or let it go** | on a waitlist (built `waitlist_accept`) | the college's rule where published | tick |
| **Compare your offers** | once two colleges are admitted with an offer entered, from March | | Offers tab |
| **Decide by May 1** | from April 1 while no college is `enrolling`; dated by the reply rule (C17) | the admitted colleges as chips | **I'm going to {College}** (`choose`, built: deposit, withdrawals, the summer list) |
| **Tell us where you landed** | after the choice, once | why: it helps the next class's estimate; what's shared (college, round, outcome, enrolled, a standing bucket, state; never a name or a number) | one tap (`consentOutcomeShare`, built) or **No thanks** |

Each card's parent lane: "Review before submit" (a tick, no write), the cost check (built), the aid forms (built), the
deposit (built, `guardian`).

## On the list row
From `senior_fall`, each row gains back a small muted status word at the right (Not started · Working on it ·
Submitted · Decision, the built `SeasonStatus`), after any pill; the row stays one line. Before senior fall the row is
unchanged. This is the owner's "there for seniors" tied to the moves: the word is read-only on the row; the card is
where it changes. Recommendation, not yet decided by the owner.

## Rules
- A move's date is the college's record for the round the student chose; a typed date says "your date"; no date, no
  dated move ("{College} hasn't published this; add your own").
- Marking applied ticks the submit move and nothing else; recording a decision ticks the decision move; the built
  generators keep their keys, so a round change moves the date and keeps a tick.
- Outcome sharing is opt-in, asked once, after the choice, with its scope in the card; never a condition of anything.
- A guardian with edit access can mark applied and record a decision, attributed; the student can undo.
- Telemetry: `plan_applied {round}`, `plan_decision_recorded {outcome}`, `plan_outcome_shared {yes|no}`; never the college.

## Files (planned)
`components/planner/moves/SubmitCard.tsx`, `DecisionCard.tsx`, `DecideCard.tsx`, `OutcomeShareCard.tsx` (reusing
`ApplyStatusControl`, `OutcomePicker`, `ChooseButton`), the row's status word (`PlanRow.tsx`, `list-row.ts`
`SEASON_STATUS_LABEL`, built); kinds `confirm_complete`, `compare_offers`, `decide_by`, `outcome_share` (the rest exist).
Tests: `tests/planner-applying.test.mts` (each move's window and its tick; the Offers tab appears after the first
decision; the deferral opens ED II; the share move once).

## Open questions
1. Bring the status word back on the row from senior fall (above)? Recommendation: yes, muted, read-only.
2. Should "Tell us where you landed" also ask students who never recorded a decision (they chose a college not on the
   list)? Recommendation: yes, a free-text college pick, same scope.
