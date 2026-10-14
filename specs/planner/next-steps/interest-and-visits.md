# Part 3, Interest and Visits: Where Showing Up Counts

> Status: **built** 2026-10-14 (feature/next-steps, PR #160). After [seasons.md](seasons.md) and [ed-opportunities.md](ed-opportunities.md); builds
> on the built capture panel ([../redesign/list.md](../redesign/list.md#simpler-planner-owner-2026-10-12)), the visit
> log ([../actions.md](../actions.md)), and CDS C7 ([../../data-expansion/cds-admissions.md](../../data-expansion/cds-admissions.md)).
> Part 3 of [next steps](README.md).

## Goal
Suggest a visit at every college the plan flags for ED, and one act of interest at the colleges that say interest
counts, where the student stands close enough for it to matter. Say which act counts most, in the order the evidence
supports, and stop once one is logged.

## What the data can say
- **Whether interest counts**: `reported.admission_profile.factors.interest` (C7), `very_important | important |
  considered | not_considered`, known at 245 colleges (14 / 33 / 91 / 102) as of 2026-10-13. No rating, no move.
- **Whether the student has shown it**: `hooksFromPlan()` (`lib/planner/hooks.ts`) reads `visited_on`, any
  `plan_visits` row, `info_requested_on`, and `followed_networks` / `follows_social` into one boolean. The estimate
  applies one multiplier for any of them (`HOOKS_V3.interest`), so a second act changes nothing in the level.
- **What counts most**, from the research in [README.md](README.md#research-2026-10-13): a registered visit or
  information session, then contact with the regional representative or an information request, then opening the
  college's email (not something the site can log), then social-media follows, which no college confirms counting.
- **Where the student stands**: the level and closeness ([ed-opportunities.md](ed-opportunities.md#what-the-data-can-say)).

## Who gets a move
`interestMoves(rows, estimates, schools, hooks, edCandidates)` in `lib/planner/interest.ts` (pure), one move per
college, in this order:
1. **Every ED candidate** (the three from part 2, dismissed or not): a **visit** move, "Visit {College} before you
   decide on a binding round", regardless of C7, while no visit is logged. The why is the binding round, not interest.
2. Colleges whose C7 is **important or very important**, at **any Reach or Target**, while no interest is logged.
3. Colleges whose C7 is **considered**, at **Reach with closeness 3 or 2** or **Target with closeness 0 or 1** (the
   owner's upper-Target / lower-Reach band), while no interest is logged.

Not considered, no rating, High reach, Likely and Safe, and Ultra selective: no move. At most three open interest
moves at a time, ordered as above and then by the ED rank and closeness; the rest wait until one closes.

## The move
A card, "Show {College} you're interested" (or the visit wording for an ED candidate), with the why: "{College} says
applicant interest is {important} ({edition}, CDS C7)." and one line of what counts most. Under it, the options in
order, each one tap and each already built in the row's capture panel:
1. **Visit**: the college's visit page (`visitPageLink`, built) and **We visited** (logs a `plan_visits` row; a planned
   visit shows as "Visit planned for Nov 3"). Where a visit isn't practical, the virtual-tour link.
2. **Information session or a request**: **We requested info** (`info_requested_on`); the admissions page.
3. **Follow**: the per-network toggles, last, with "the weakest signal; no college says it counts this" in the small
   print. Never suggested on its own.

Any logged act ticks the move (the generator reads `hooks.interest`). "Not now" skips it for the season; it returns
the next season while the condition holds, since a visit can wait a season but an unlogged interest in senior fall
can't.

## The pill
On a list row with an open interest move and no ED pill: **Interest counts here** (phones: **Interest**), muted
accent, tapping opens the details at the capture panel with the move's why above the chips. The row's "Details" count
(`rowToDo`, built) keeps marking the smaller to-dos.

## Timing
| Season | What shows |
|---|---|
| Freshman–sophomore | The generic "visit a campus when you travel" move ([seasons.md](seasons.md)); no college-specific moves |
| Junior fall | Visit moves for ED candidates don't exist yet (no pills before spring); interest moves for important / very important colleges, since fall-break visits are when advisors place them |
| Junior spring → summer | All three rules; the visit moves lead the spring-break card |
| Senior fall | The remaining interest moves become "if you haven't yet, one of these before {deadline}", dated to 14 days before the college's deadline in the chosen round |
| After the deadline | Closed |

## Rules
- Where C7 says not considered, the capture panel keeps its built line ("do these for yourself, not for the
  application") and no move or pill appears.
- The move never says a visit improves the odds; it says what the college reports and what colleges log.
- A guardian sees the move and its options; **We visited** and **We requested info** are theirs to tap too (a family
  visits together, as the built panel allows); follows stay the student's.
- Telemetry: `plan_interest_move_shown {rule, level}`, `plan_interest_act {act}`, never the college.

## Files (planned)
`lib/planner/interest.ts`, `components/planner/InterestCard.tsx`, `InterestPill.tsx`; kinds `visit_ed`, `show_interest`;
the generator's `interest_candidate` applies-key. Tests: `tests/planner-interest.test.mts` (each rule; the band; the
three-cap; a logged act closes it; not considered never fires; the senior-fall dating; the ED-candidate visit without C7).

## Open questions
1. Should a visit move for an ED candidate persist after the student dismissed the ED pill? Recommendation: yes for the
   season it was generated in, then it follows the interest rules only.
2. A visit-events source ([../../ideas/visit-events.md](../../ideas/visit-events.md)) would let the card name the next
   tour date; until then it links the visit page.
