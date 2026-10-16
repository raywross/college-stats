# Guide: Choose Next Year's APs

> Status: **planned** 2026-10-15. After [../now.md](../now.md). Gives the built course plan
> ([../../../chances/course-plan.md](../../../chances/course-plan.md), server-side, card UI removed 2026-10-12) a home,
> with the intake's AP search ([../../redesign/intake.md](../../redesign/intake.md#ap-courses)) beside it. Reads depth's
> course tracks ([../../../chances/depth.md](../../../chances/depth.md#course-tracks)). Part 7 of [plan v3](../README.md).

## Goal
The owner: "A task to help them choose APs. This should tie in what they've taken and have recommendations that add
depth, but let them add whatever they're adding. Changes on this page should populate their plan profile."

## When
The `choose_courses` moves (freshman, sophomore, junior; the cycle's `choose_courses_*` window, February–April, "check
your school's dates") open this guide. Outside the window it is reachable from the Numbers page's Courses section and
the profile's "What you'll need in high school" line, so a student whose school registers in January isn't blocked.

## The page
`/plan/guide/courses`

```
← Back to your plan
Choose next year's APs
Schools ask for next year's choices in late winter. Colleges read the courses as closely as the grades.

WHAT YOU'VE TAKEN                                                     by subject, by year
 Science   Biology (H) → Chemistry (H) → AP Chemistry (now) → ?           a deep track for your major
 Math      Algebra II (H) → Precalculus (H) → ?                           a steady track; most engineering programs expect calculus
 English   English 9 → English 10 (H) → AP Lang (now) → ?
 History   World History → AP US History (now) → ?
 …

SUGGESTED FOR NEXT YEAR                                               at most two, each with its reason
 ┌ AP Calculus AB                                                                       [Add to next year] ┐
 │ Engineering programs expect calculus; it's next in your math sequence, and your school offers it.        │
 │ At Elon it would move you up a level, if your grades stay strong.                                        │
 ┌ AP Physics 1                                                                         [Add to next year] ┐
 │ Cornell Engineering requires physics. Offered at your school and fits next year.                        │
 Not for me ▸

ADD ANYTHING ELSE YOU'RE TAKING
 [Search AP courses…]  popular: AP Statistics · AP Psychology · AP Government · …
 Next year so far: AP Chemistry… AP Calculus AB (added) · AP English Literature (added)   each removable

 Next year's courses are chosen ✓          ← ticks the move; the suggestions fold
```
- **What you've taken**: the course list grouped by subject family with an arrow per year and the depth reading's
  track sentence at the right (Deep / Steady / Light in words, as built in the Tracks line), the major's families first.
  A "?" marks next year's empty slot. Read-only; Edit opens the intake's AP step.
- **Suggested**: the built `coursePlan` output (`PlanContext.coursePlan`): up to two suggestions with their reason and
  the "what it changes" line where the estimate gives one, or the guardrail message in their place ("Strong grades in the
  advanced courses you have count for more than adding another"; "Your schedule is already about as demanding as your
  school allows"; the senior message). 9th and 10th graders see the **path** instead ("To take AP Calculus BC as a
  senior, take Precalculus by 11th grade") for the major's subjects. **Add to next year** is the built save (a planned
  row for next year, `saveCourses`); **Not for me** the built dismissal. Depth is the tie-in: a suggestion that continues
  a Steady track says so ("a fourth year makes this a deep track").
- **Add anything else**: the intake's AP search (`searchAp`, popular chips, aliases), each pick a planned course for next
  year; the running list of next year's courses with remove. Not limited to the school's known offering (the owner: "let
  them add whatever they're adding"); a course outside the school's list gets a small "not on your school's list; tell
  us if it is" that marks `academics.schoolOffers` when tapped.
- **Chosen**: one tap marks next year's schedule done (built `coursePlan.done`), ticks the move, and folds the
  suggestions.
- Every change is a profile save, so the Numbers page, the rigor reading, the estimate, and the depth tracks read it at
  once.

## Rules
- Only courses the school offers are *suggested*; anything can be *added* (the owner's rule).
- At most two suggestions; the built guardrails (grades, the yearly cap, already there, too late, not offered, earlier
  years) decide whether any show.
- No "you should"; every reason names its evidence; a group change always ends "if your grades stay strong" (built).
- A guardian sees the page read-only (no exam scores while the student keeps them private; the built redaction).
- Telemetry: `course_plan_shown`, `course_plan_added`, `course_plan_dismissed` (built), `plan_guide_opened {slug:
  "courses"}`, `plan_courses_added {count}`; never a course name.

## Files (planned)
`components/planner/guides/CoursesGuide.tsx` (restoring `NextYearCard`'s suggestion UI from git history, the track
view, the search), `lib/planner/courses-guide.ts` (pure: the by-subject rows, next year's slot), the registry entry.
Tests: `tests/planner-courses-guide.test.mts` (rows per subject and year; the next-year slot; adding writes a planned
row; the chosen tick; a guardian's redaction).

## Open questions
1. Should "Add anything else" also take honors and dual-enrollment courses (the course list supports them)?
   Recommendation: APs only here, as the owner asked; the Numbers page's full course editor stays for the rest.
