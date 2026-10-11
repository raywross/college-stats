# Method: the Estimate's Rules (Standing, Second Version)

> Method (not a work item; was "standing-v2", part 4). The rules [Quad's estimate](../estimate.md) computes until a
> trained model replaces them. Kept here until launch; moves to a private repository then. Never shown on the site.
> Inputs from
> [rigor-in-context.md](../rigor-in-context.md) and [base-rates.md](../base-rates.md); better with
> [how-colleges-read.md](../how-colleges-read.md) (the crowding share it reads). Replaces the internals of
> `standingFor` in `lib/planner/standing.ts` (built on `feature/plan-redesign`, PR #105, from
> [../planner/redesign/standing.md](../../planner/redesign/standing.md) and the GPA work in
> `specs/planner/redesign/gpa.md`) behind the same signature, as that spec anticipated, and implements the rules
> half of [chances-and-fit.md](../../product/chances-and-fit.md). The profile's standing card and the planner call the same
> function.

## Goal
Keep what the built model does well (published rules, three groups, reasons with numbers, never a percentage) and
take the proposal's best structural idea: admission at a selective college is **a threshold, then a lottery**. First,
are the student's academics in the pool the college admits from? Second, how many applicants in *the student's* pool
get in? The built model already has both halves implicitly (positions, then admit-rate cutoffs). This version makes
them explicit, feeds each with better evidence, and shows them as two lines a family can read.

```
Stage 1  IN THE POOL?            Stage 2  THE POOL'S ODDS             Group
score position  ─┐               base rate for this student ─┐
GPA position    ─┼─► academic ──►  (guarantee, major,        ├─► Reach / Target / Likely
rigor position* ─┤    position      residency, or overall)   ─┘     + "Reach for everyone"
rank position*  ─┘                                                  + "Guaranteed"
* only where the college says it weighs them (C7) and the data exists
```

## Stage 1: the academic position

### Which positions count
A position counts at a college only when the college says it weighs that evidence. From C7 (147 colleges) when
present, else the IPEDS factors (1,586 colleges):

| Position | Counts when | Built or new |
|---|---|---|
| **Score** | Test policy required or recommended; or test-optional and C7 rates tests at least *considered*. Test-blind, or test-optional with C7 *not considered* (22 colleges, e.g. Elon) → unused | Built rule, plus the C7 check |
| **GPA** | C7 GPA at least *considered*, or IPEDS GPA required/considered | Built (`specs/planner/redesign/gpa.md`: middle 50% from bands, or estimated) |
| **Rigor** | C7 rigor at least *important*, or IPEDS high school record *required* | New, from [rigor-in-context.md](../rigor-in-context.md) |
| **Class rank** | C7 rank at least *considered*, the student gave a rank, and C10 has `submitted_share ≥ 0.15` | New |
| **Major subjects** | The student has an intended major and the unit they'd apply to says it reads math or science grades, requires courses, or has a gate | New, from [major-and-grades.md](major-effects.md); unlike rigor, it can lower the group, because the college itself says it reads that evidence |

### The score and GPA positions
Unchanged from the built model: `below` / `in` / `above` the middle 50% (scores via the official concordance when
the college reports the other test; GPA from the C11 bands or the estimate, with its ranges). The test-optional
"withheld" rule stays.

### GPA crowding
At a college where at least half of first-years had a 3.75 or higher (`derived.gpa_top_share ≥ 0.5`,
[how-colleges-read.md](../how-colleges-read.md#the-block-readingtherecord)), being "above" the GPA middle 50% is nearly
impossible (its top is 4.0) and being "in" it says little. So at a crowded college:
- GPA `below` still counts as `below` (a low GPA is still a low GPA).
- GPA `in` or `above` counts as **meets the bar**: it adds nothing on its own, and the rigor position decides the GPA
  slot when it exists: rigor `above` → the slot is `above`; otherwise `in`.
- The reason says it: "Your GPA (3.92) meets the bar here; 70% of first-years had a 3.75 or higher, so your courses
  carry more of the weight. You've taken or planned 8 of the 9 AP courses your school offers."

### The rigor position (asymmetric for now)
From [the reading](rigor-reading.md#the-reading): *most* → `above`, *much* or *few offered* → `in`,
*some* → `below`, *can't place* → `unknown`. Until the [outcomes](outcomes.md) shows rigor predicts outcomes
on the site's own data, **rigor can raise a GPA slot but never lower the group**: a `below` rigor position is
shown as a sentence and not used. This keeps the redesign's "encourage, don't grade" while the evidence is collected,
and is one constant (`RIGOR_CAN_LOWER = false`) to flip after the pilot.

### The class-rank position
The student's rank (top X%) placed among the first-years who reported one, using C10's cumulative tiers (top tenth,
quarter, half) with an even spread inside each tier, the same way the GPA bands are read:
`shareAtOrAbove = share of ranked first-years at the student's rank or higher`. `above` when ≤ 0.25, `below` when ≥
0.75, else `in`. Example: Elon reports 20% of ranked first-years in the top tenth, so a student in the top 10% is
`above`; at Georgia Tech (89% in the top tenth) the same student is `below`, which is honest and why the rank only
counts where the college says it weighs rank.

### Combining
The built combining rules stay, applied to the positions that count: every known position `above`; one `above` and
the rest `in`; any `below`; otherwise `in`. Rigor fills the GPA slot at crowded colleges (above) instead of adding a
fourth vote; class rank is a third vote beside score and GPA.

## Stage 2: the pool's odds
`baseRateFor(student, school)` from [base-rates.md](../base-rates.md) gives the rate; the built cutoffs read it in place
of the overall admit rate:
- **Guaranteed** program fires → **Likely**, labeled "Guaranteed for you", whatever Stage 1 says (the program says so).
- Base rate under 20% → **Reach**, labeled "Reach for everyone" (the proposal's *Far Reach*). With residency now in
  the base rate, an in-state applicant at a public university admitting its own state at 29% is no longer a Reach for
  everyone (Georgia Tech: 9% overall, 29% in-state, 10% out-of-state).
- Otherwise the built thresholds (Likely at 50% / 60% / 70% depending on the positions) unchanged, in the `STANDING`
  constants object.
- No base rate (open admission) → **Likely**, "Admits everyone who applies".

## Groups and labels
Three groups stay; two labels sit on top. The proposal's five bands map onto them without printing a probability:

| Proposal's band | Here | Why not a separate group |
|---|---|---|
| Far Reach (< 15%) | **Reach**, labeled "Reach for everyone" | Already built; a separate chip adds a fourth color to every list for the same advice |
| Reach | **Reach** | |
| Target | **Target** | |
| Likely | **Likely** | |
| Safety (> 85%) | **Likely**, labeled "Guaranteed for you" only when a published rule guarantees it | Counselors avoid "safety" for anything short of a guarantee the family can also afford; the site can't know an 85% from public data |

The list's balance line ([../planner/redesign/list.md](../../planner/redesign/list.md)) counts groups as today; a
guaranteed college counts as Likely and the line can say "including 1 guaranteed".

## The two lines a family sees
Wherever the group's reasons show (the profile standing card, the planner row's ⓘ, Compare's row), the first two
lines are the two stages:

> **Your academics:** in the middle of admitted students (SAT 1300 inside 1220–1470; GPA 3.85 inside 3.6–4.0).
> **Your pool:** applicants from Indiana were admitted at 71% (fall 2025). → **Likely**

> **Your academics:** in the middle of admitted students.
> **Your pool:** applicants from outside Indiana were admitted at 44%. → **Target**

The remaining reasons follow (crowding, rigor, rank, the test-optional advice, the ED sentence), each cited.

## Pinned examples
In `tests/chances-standing.test.mts`, alongside the built examples, which must all still hold when the new inputs are
absent (a test runs the built table through the new function with no rigor, rank, state, or major).

| Student | College (2026-10-10 data) | Group | Why |
|---|---|---|---|
| Indiana resident, SAT 1300, GPA 3.85 | Purdue: 43% overall, 71% in-state, SAT 1220–1470 | Likely | In the pool; in-state rate 71% |
| Ohio resident, same numbers | Purdue: 44% out-of-state | Target | Same pool position; out-of-state rate |
| Georgia resident, SAT 1500, GPA 3.95 | Georgia Tech: 9% overall, 29% in-state, SAT 1370–1530, weighted GPA reporter | Target | In the pool; in-state rate 29% (was "Reach for everyone") |
| Same student, from Florida | Georgia Tech: 10% out-of-state | Reach for everyone | Base rate under 20% |
| GPA 3.90, 8 of 9 APs offered (*most*), test-optional and not sending | Elon: 63%, 70% of first-years at 3.75+, rigor very important, tests not considered | Likely | GPA meets the bar; rigor fills the slot as above |
| GPA 3.90, no courses entered | Elon | Target | GPA in, nothing above, under 70% |
| GPA 3.90, top 10% of class, no courses | Elon: 20% of ranked first-years in the top tenth | Likely | GPA in, rank above, 60%+ |
| Texas resident, top 4% of class, SAT 1350 | UT Austin, with its automatic-admission entry (top 5% for fall 2026 and 2027) | Likely, "Guaranteed for you" | The program, not the numbers; the reason adds that the major isn't guaranteed |
| GPA 3.90, 2 of 14 APs (*some*) | A crowded college admitting 45% | Target (unchanged) | Rigor below is shown, not used (`RIGOR_CAN_LOWER = false`) |

The Purdue, Georgia Tech, and Elon figures are their current records and will move with new editions; the test
fixtures copy them as fixed inputs so the examples stay pinned.

## What the student enters
Nothing new is required. Each new input improves the groups where it applies and the plan says which:
- State (on the household, built) → residency base rates and guarantees.
- Intended major (built) → major base rates where published.
- Class rank (built, optional) → the rank position and guarantees.
- Courses (new, optional, [rigor-in-context.md](../rigor-in-context.md)) → the rigor position at crowded colleges.
- Math and science grades (new, optional, for STEM majors, [major-and-grades.md](../major-and-grades.md#the-students-side))
  → the major-subjects position where a unit reads them.
After the numbers step, one line names the most useful missing input for this list, only when one would change at
least one group: "Adding your class rank would sort 2 more colleges" (computed by re-running the model with the input
set at its median; never shown when it would change nothing).

## Where it shows
- **Profile**: the "Where you stand" chip and standing card planned in
  [chances-and-fit.md](../../product/chances-and-fit.md#display) call this function; the card leads with the two lines.
- **Planner**: the Colleges tab's automatic groups ([../planner/redesign/standing.md](../../planner/redesign/standing.md#suggested-until-changed))
  recompute with the new inputs; a student-picked group is still never overwritten. The Scores tab's
  `scoreToMoveUp` runs through the same function, so a retake suggestion accounts for residency (a Georgia resident's
  Georgia Tech can now move up; a Florida resident's can't).
- **Compare** and **Explore** (the standing facet): same function, same reasons.
- **iPhone API**: the reasons are already text with citations; the two stage lines are two more reason entries.

## Rules
- Never a probability, a percentage chance, or a score out of 100; the base rate is shown as what it is, the share of
  that pool admitted, with its year.
- A position only counts where the college says it weighs that evidence.
- A new input can only add information; with every new input empty the function returns exactly the built result.
- Thresholds live in `STANDING` and change only with a pilot result recorded in [calibration.md](outcomes.md).

## Files (planned)
`lib/planner/standing.ts` (the two stages; `StandingStudent` gains `rigor`, `classRankPercentile`, `state`,
`intendedMajor`, `round`; `StandingSchool` gains `baseRate`, `gpaTopShare`, `c7`, `classRank`), the reason builders
for the two lines, `lib/planner/context.ts` and `app/api/plan/schools/route.ts` passing the new inputs,
`tests/chances-standing.test.mts` (the table, the built table with new inputs empty, crowding on and off, rigor never
lowering, rank via tiers, guaranteed overriding Stage 1).

## Open questions
1. Should rigor ever lower a group? Recommendation: not until the calibration shows *some*-rigor students at crowded
   colleges are admitted measurably less often than *most*-rigor students with the same other positions.
2. Is 20% still the right "for everyone" cutoff once the base rate is the student's own pool? Recommendation: keep it;
   the pilot reports Likely and Target error by base-rate band, and the cutoff moves only on that evidence.
3. Should the "most useful missing input" line appear on the profile too? Recommendation: planner only; the profile
   shows one college and the line would usually be "nothing".
