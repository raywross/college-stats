# Scores: Where You Stand, and Whether Another Test Would Help

> Status: **built** 2026-10-10 on feature/plan-redesign ([build plan](build-plan.md)). Part 5 of the [planner redesign](README.md). After [standing.md](standing.md).
> Replaces the SAT and ACT dates the timeline generated for everyone ([../timeline.md](../timeline.md)) with a coach
> for the one test the student is taking.

## Goal
A student takes one test and works to raise it. The Scores tab tells them where that score stands at each college on
their list, whether to send it, and, only when a realistic gain would move a college up a group, says so with the
number to aim for and the test dates whose scores arrive in time. Encouraging first; dates when they're wanted.

## The tab
```
YOU'RE TAKING THE SAT
1390
🎉 In or above the middle 50% at 6 of 8 colleges on the list.

┌ WORTH ONE MORE TEST ─────────────────────────────────────────────┐
│ A 1420 (+30) would move one college up a group                    │
│ Wake Forest  [Reach] → [Target]  with 1420                         │
│ Students who retake gain about 40–60 points on average…            │
│ SAT · Nov 7 (30 days) · register by Oct 23                         │
│   Too late for the round you picked; in time for Wake Forest ED II │
│ SAT · Dec 5 (58 days) · register by Nov 20                         │
└───────────────────────────────────────────────────────────────────┘

College by college
Wake Forest   [Reach]   ──●── ▬▬▬▬     Optional here: consider not sending   1420 → Target
William & Mary [Target]  ●▬▬▬▬▬▬▬       Send it
…
```
1. **The score**, big, with which test, and "practice" when it's a practice score.
2. **One encouraging line**: "In or above the middle 50% at N of M colleges on the list." When it's all of them:
   "Your score already works everywhere; time is better spent on essays."
3. **The suggestion card** (bright, `bg-pop`) only when [the rule](#when-to-suggest-another-test) fires; otherwise a
   plain card: "No test needed for this list. A typical retake wouldn't move any of these colleges to a new group,"
   with "Show upcoming SAT dates" for a student who wants to try anyway.
4. **College by college**: each college's middle 50% as a bar on one axis for the student's test (SAT 1000–1600, ACT
   18–36), the student's score as a dot, the group chip, the send advice, the ⓘ for the range, and "1420 → Target"
   when a move exists. A college compared through the concordance draws its range converted to the student's test
   and says "via concordance".

## When to suggest another test
`retakeSuggestion(student, schools)`: for each college on the list, `scoreToMoveUp()` finds the fewest points on the
student's own test that would move it up one group, holding GPA (stepping 10 on the SAT, 1 on the ACT, through the
same rules as [standing.md](standing.md#the-rules)). A move counts when it's within **60 SAT points or 2 ACT points**
(`RETAKE_REACH`), roughly what students who retake commonly gain (ACT: 57% of retesters improve, typically by about a
point, 2 among improvers in Tennessee's 2024 senior retest; SAT: secondary sources put the average gain at about
40–60 points; no primary College Board figure found). The card names every counting move and the largest number
needed among them ("a 1420 (+30)"). No move for:
- a college that is already Likely;
- a Reach for everyone (admit rate under 20%): scores alone don't change that, and the card says nothing about it;
- a test-blind college.

A move into "send it" at a test-optional college (from below the range into it) counts like any other: crossing the
25th percentile changes both the advice and, usually, the group.

## Score timing
A test date helps a college only if its scores can arrive by that college's deadline in the round chosen.
`SCORE_LAG` is 14 days for both tests (the digital SAT reports in days, e.g. Nov 7 scores on Nov 20; ACT
multiple-choice scores usually in two weeks). For each date the card says:
- "Scores in time for Wake Forest ED I" when the chosen round's deadline is at least the lag after the test;
- otherwise, "Too late for the round you picked; in time for Wake Forest ED II (Jan 1)" when a later round the college
  offers would still take it (this is the honest trade-off: switch rounds or don't retake);
- otherwise, "Scores arrive after these deadlines."

Many colleges accept early-round scores from the November date even when the official lag says otherwise; the card
links each college's admissions page rather than promising it.

## Test dates
- From `data/application-cycle.json` (built; SAT and ACT dates with registration deadlines and official source
  links, read 2026-10-08; projected dates marked). Only the student's own test.
- A senior sees only dates whose scores could still reach a deadline on their list (at most three); a junior sees the
  next four.
- Each date: the date, days away, "register by …" (or "registration closed; late registration may be open"), and
  "official dates" linking the College Board or ACT page.
- On the calendar, the test lane appears only while the student is still testing (not yet applying) or when the
  suggestion is live ([calendar.md](calendar.md#lanes)); otherwise test dates aren't on the plan at all.
- The `plans_tests` cycle tasks (one per national date, for everyone) are replaced by at most two: "Register for the
  SAT on Nov 7" (due the registration deadline) and the test day itself, generated only when the student taps **I'll
  take it** on a date. Untapped dates never become tasks or reminders.

## Parents
The parent sees the same tab in the third person ("Maya is taking the SAT"). No score is ever sent in a reminder,
nudge, or text (built rule). A parent can't change the test choice unless they have edit access.

## Rules
- Never "you should retake"; the card says how many points and which colleges, and the dates.
- Never a probability, and never the admit rate on this tab.
- Each range is cited (ⓘ) with its edition; each test date links its official page.
- Telemetry: `plan_scores_opened {suggestion: bool}`, `plan_test_date_picked {test}`; never a score.

## Files (planned)
`lib/planner/standing.ts` (`scoreToMoveUp`, `retakeSuggestion`, `RETAKE_REACH`; drafted), `lib/planner/scores.ts`
(date filtering and "in time" text, pure, tested), `components/planner/ScoresTab.tsx`, `ScoreRow.tsx`; the `tests`
generator in `lib/planner/generators/cycle.ts` changes from every date to the picked date; glossary entries
`superscore` (built), `concordance`, `test-optional`.

## Open questions
1. ~~The retake threshold~~: 60 SAT / 2 ACT, decided 2026-10-10.
2. Should the suggestion also count GPA-only colleges where a score would *start* counting (test-optional, no GPA
   data)? Recommendation: no; keep the card about colleges whose group a score already decides.
