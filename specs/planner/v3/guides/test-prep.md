# Guide: Reach Your Score

> Status: **built** 2026-10-16 (PR #165). After [../now.md](../now.md); shares act tracking with [show-interest.md](show-interest.md).
> Brings back, as a guide, the useful parts of the dropped Scores tab ([../../redesign/scores.md](../../redesign/scores.md)):
> the standing line, the retake rule, and the test dates with "I'll take it". Part 5 of [plan v3](../README.md).

## Goal
The owner: "For students that haven't reached their target ACT or SAT, we should encourage them to study, and then
bring them to a page that shows them upcoming tests with a link to register. Similar to the college tour we should try
and track this and add to the calendar." And: "if the student has entered ACT or SAT scores, they don't need to take a
practice test."

## Who gets the move
A new playbook entry per season from junior fall through senior fall, `reach_score`, `applies: "below_target"`: the
profile has a focus test, a score (practice or real), and a target above it (`tests.target`). Title "Work toward your
{target}" (the student's own number is fine on their own card; it is never in a reminder or a parent's text). Why:
"Your target is your own. The dates below are the ones whose scores would arrive in time." Carries while true; closes
when the score reaches the target or the target is cleared. Without a target, the built retake notice ("a 1420 would
move Wake Forest up a level", `retakeSuggestion`) becomes the move instead, titled from the notice, same guide. A student
with no score yet keeps the built `pick_test` move, which opens this guide too.

## The page
`/plan/guide/test` (the moves above; the Numbers page's test row; the intake's test step's "see dates").

```
← Back to your plan
Reach your score
You're at 1310 on the SAT, aiming for 1400.

WHERE 1310 STANDS ON YOUR LIST
 In or above the middle 50% at 5 of 8 colleges.  A 1400 would be in or above it at 7.
 Wake Forest  ──●──▬▬▬▬▬   Davidson  ●▬▬▬▬▬▬▬   …  (the built RangeBar per college, your score the dot)

STUDY
 Official, free, and the ones advisors point to first:
 · Bluebook practice tests and Khan Academy's Official SAT Practice (College Board)
 · ACT's free practice tests and the official prep guide (ACT)
 Most students who retake gain some points; a plan of a few hours a week for six to eight weeks is the usual advice.
 [Open Khan Academy ↗]

UPCOMING SAT DATES                                   scores arrive in about two weeks
 ┌ Sat Dec 6 · register by Nov 21 · in time for every college on your list      [I'll take it] [Register ↗] ┐
 ┌ Sat Mar 14 · register by Feb 27 · in time for every college                   [I'll take it] [Register ↗] ┐
 ┌ Sat May 2 · register by Apr 17                                                 [I'll take it] [Register ↗] ┐
 Pending: did you register for the Dec 6 SAT?  [Yes] [Not yet]
 Official dates: College Board ↗

ON YOUR CALENDAR
 SAT · Dec 6 (registered) · register by Nov 21 ✓
```
- **The header line** is the student's own numbers (score, test, target; "practice score" when flagged). A guardian sees
  the same page in the third person (built convention). Nothing here is the estimate's.
- **Where it stands**: the built `fitsScoreValues` per college with the built `RangeBar` and "You" dot (the Compare and
  ScoreChecker visual), the count line, and the same count at the target. Test-blind colleges say so; colleges without a
  range are left out of the count and say "no range published". Via concordance where the college publishes only the
  other test (built).
- **Study**: a short, sourced list: College Board's Bluebook practice tests and Khan Academy Official SAT Practice (both
  free; the official pair), ACT's own free practice tests and prep guide; one line on cadence from the advisor
  consensus, no promise of a gain. Only the student's focus test's resources show. Links open in a new tab; no tracking
  (studying isn't an act to confirm).
- **Upcoming dates**: the student's test only, from `data/application-cycle.json` (built dates, registration deadlines,
  official links; projected dates marked). Juniors see the next four; seniors only dates whose scores (`SCORE_LAG`, 14
  days) arrive by at least one listed college's deadline in its chosen round, with the built in-time wording per date
  ("in time for every college on your list" / "too late for Wake Forest ED I; in time for ED II" / "scores arrive after
  these deadlines"). **I'll take it** stores the date (`tests.plannedDates`, built), which generates the built
  `test_register` and `test_day` tasks, so the calendar and the day-before text carry it. **Register** opens the official
  registration page (College Board or ACT) with the show-interest guide's act tracking (`act: "test_register"`, the
  event being the test date): the return prompt asks "Did you register for the Dec 6 SAT?", the next-day email asks if
  the prompt didn't; **Yes** marks the planned date registered (`tests.registeredDates`, new, a subset of
  `plannedDates`) and ticks the `test_register` task; the calendar's test row then reads "registered".
- **On your calendar**: the planned dates with their state (planned / registered), each removable.
- **Footer**: the move's Done and Skip.

## The practice-test rule
`applies: "no_real_score"` on the three PSAT moves ([../now.md](../now.md#timing-rules)): a student with a real SAT total
or ACT composite (not flagged practice) gets no practice-test move in any season.

## Rules
- Never "you should retake"; the page says where the score stands, what the target would change, and when the dates are
  (the Scores tab's rule, kept).
- Never a probability, never the admit rate, never the estimate's numbers; the score and target are the student's own.
- No score in any reminder, text, brief, or parent email (built rule); the registration confirmation email names the
  test and date only.
- Each range is cited with its edition; each date links its official page.
- Telemetry: `plan_guide_opened {slug: "test"}`, `plan_test_date_picked {test}` (built), `plan_test_registered {test,
  via}`; never a score.

## Files (planned)
`lib/planner/test-guide.ts` (pure: `datesFor(profile, listDeadlines, season)` from the cycle, the in-time text (restored
from the deleted `lib/planner/scores.ts`, in git history), the standing counts), `components/planner/guides/TestGuide.tsx`,
`TestDateRow.tsx` (reusing `ActButton`), `lib/student-profile.ts` (`tests.registeredDates`), the `reach_score` entry
and `below_target` applies-key, the PSAT entries' `no_real_score`. Tests: `tests/planner-test-guide.test.mts` (the
dates a junior and a senior see; the in-time wording per round; I'll take it generates the two tasks; a confirmed
registration ticks `test_register`; `below_target` and `no_real_score` on every profile shape; no score in any email
string).

## Open questions
1. Should the move be dated to the next registration deadline so it can go overdue? Recommendation: no; it carries,
   undated, and the picked date's `test_register` task is the dated one.
2. A student whose target is at or below their score keeps the target (the intake allows it). Recommendation: the move
   doesn't fire and the Numbers page shows "You're there" by the target.

## As built
- `reach_score_*` moves are generated one per season (junior fall → senior fall) with `applies: "below_target"`. Titles filled from `profile.tests.target` ("Work toward your 1400"). Seasons without a target don't emit the move.
- The test guide page shows the student's own score and target; a guardian sees the target-free version.
- "I'll take it" updates `tests.plannedDates`; test registration is tracked via the same `plan_interest_acts` table and `ActButton` as Show interest (confirm an act to write the date to `tests.registeredDates`).
- `plan_test_date_picked {test}` telemetry re-added.
- The no-target fallback to the retake notice is not built (owner question).

## Changed (owner, 2026-10-16): the dates first
"The main reason to go to the page is to schedule an exam. That should be the first thing we show. Let the other two
be pop ups or info icons." The page is now: the header line (the student's score and target) with two buttons,
**Where it stands** and **How to study**, each opening its content in a sheet (a bottom sheet on phones); then
**Upcoming dates** with "I'll take it" and Register; then **On your calendar**. Opening either sheet records
`plan_why_opened { screen: "test_guide", section }`.
