# Part 9, The Parent's Next Steps: The Whole Season, and What Was Skipped

> Status: **built** 2026-10-16 (PR #165). After [now.md](now.md).
> Extends [../parents.md](../parents.md) and the guardian's view in [../next-steps/seasons.md](../next-steps/seasons.md#the-next-steps-tab).
> Part 9 of [plan v3](README.md).

## Goal
The owner: "We could have a parent page with more detail that shows the full list of things we're thinking about and
when, and also shows what students have skipped."

The student's tab is three cards. The parent's is the map: their own part first, then everything the plan has in mind
for this season and the next, each with its timing, and the student's Done and Skipped marks as facts.

## The tab
A guardian's `/plan` (Next steps) shows, for the selected child:
1. **Your part**: the guardian's own open moves for this child (built `yourPartMoves`), as cards with their actions.
   Hidden while the financial moves are hidden, which today leaves it mostly empty; it fills when they return.
2. **{First name}'s season**: every open move of the current season that the student would see or has seen, in Now's
   order, as compact rows (title, the why's first clause, the date or "this season", and a state): **Now** for the
   three the student currently sees, **Next** for the rest, **Done** with the date, **Skipped Oct 12** for a dismissed
   one. A row's title opens the guide read-only (or with edit, when the guardian can edit, where the guide allows it).
3. **Coming up: {next season}**: next season's moves, titles and dates, folded open (the student doesn't see this; the
   parent does).
4. **Done and skipped this season**: folded; the same rows with their dates, the skipped ones with **Bring back** for
   a guardian with edit access (attributed; the student sees who).

```
Your part (0)                                                    How this season works
Jordan's season · Junior spring
 Now     Build your list                      this season         →
 Now     Show Elon you're interested          this season         →
 Now     Pick your recommenders               by Jun 10           →
 Next    Take the SAT                         May 2
 Done    Visit over spring break              Mar 14 ✓
 Skipped Write your story                     Skipped Mar 2       [Bring back]
Coming up · Summer before senior year (4) ▾
```

## Rules
- Nothing here grades: no count of what's undone in red, no "behind", no comparison between children (built rules).
  "Skipped" is a date, not a warning.
- A parent never sees the story's text, hooks, or private notes; the story row says "Written" or "Not yet".
- The weekly parent summary ([../next-steps/notifications.md](../next-steps/notifications.md)) adds one line for the
  week's skipped moves ("Jordan skipped: Write your story"), titles only.
- Telemetry: `plan_parent_season_viewed {season}`, `plan_move_restored {kind, season, by: guardian}`.

## Files (planned)
`components/planner/ParentNextSteps.tsx` (replacing the guardian branch of `NextSteps.tsx`), `lib/planner/moves.ts`
(`seasonRows` with states), the summary's skipped line (`lib/emails/parent-summary.ts`). Tests: `tests/planner-moves.test.mts`
(the states; a skipped move shows to the parent and not the student; Bring back needs edit access).

## Open questions
1. Should a parent be able to skip a move on the student's behalf? Recommendation: no; only Bring back.

## As built
- A parent's Next steps tab shows: Your part (the student's `myYourPart` moves, hidden when empty) → "{First}'s {Season}" rows with states Now and Next → "Coming up · {next season} (n)" folded open → "Done and skipped this season" folded with Bring back buttons for each skipped move (editors only).
- A row's title links its guide read-only (via `guideHref` with `person` parameter).
- `reach_score_*` titles on the parent's view read "Work toward the target score" (never the number).
- The weekly email includes skipped moves from the last seven days (dismissed within seven days), titles only: "Jordan skipped: Write your story".
- Telemetry: `plan_parent_season_viewed {season}`, `plan_move_restored {kind, season, by: "guardian"}`.
- **Set aside (2026-10-16, plan-v3-fix-cards).** Owner, after seeing the preview: "For now, when a parent looks at a student they should see what they see." `NextSteps.tsx` no longer routes a guardian to `GuardianNextSteps`; a guardian now gets the exact three-card student view (`now.md`), with their own Your part cards above it when non-empty. This file's component (`components/planner/ParentNextSteps.tsx`), and the `seasonRows`/`comingUpRows`/`parentSafeTitle` helpers in `lib/planner/moves.ts` this spec describes, are kept in place but unused, in case the fuller parent view (Coming up, the "{First}'s season" rows, Now/Next states) comes back. `parentSafeTitle` still does its one job either way: a guardian never sees a `reach_score_*` move's own number.

## Changed (owner review, 2026-10-16, later): a parent can skip
"There's no way to dismiss them." A guardian with edit access now gets **Skip for now** in a card's ⋯ menu and in a
guide's footer, like the student; `dismissed_by` records who. (The earlier "a parent only brings back" was this spec's
own recommendation, overridden by the owner.)

## Changed (owner, 2026-10-16, after release): the student's view, everywhere on the plan
"I had wanted the parent view to be the same… the plan suggestions are different for the parent than for the same
child, also the helper screens are different… make it so that it works the same for both parents and students, using
the student view." A guardian who opens a child's plan now sees what the student sees, word for word:

- **Suggestions.** The three cards, the Done and skipped fold, and the people line's "Next:" all come from
  `nowMoves(viewer: "student")`. No separate Your part list: a parent's own moves (`assignee` guardian or either) rank
  among the three as they do for the student. Titles are verbatim (`parentSafeTitle` is no longer called on the site;
  the owner's 2026-10-11 rule is that a student's data is never hidden from a guardian). The assignee chip reads as the
  student's ("Parent" on a parent's move, no chip on the student's own).
- **Helper screens.** The test, recommenders, courses, interest, list, and story guides, the ED sheet, task rows, and
  the record's title use the student's words ("your score", "Your teachers", "Your record"). The courses guide is
  editable by a guardian with edit access (it was read-only), the recommenders guide's thank-you Done shows for them,
  and a guardian may record a follow (`recordFollow` no longer requires the student's own account; edit access, through
  the list's row-level security, is the rule, as for Request information). The list guide's Explore link carries the
  student's scores for a guardian too.
- **What stays the student's alone.** The story's text: a guardian sees the guide's framing and the record's sentences,
  and in place of the field the one line "{First} has written their story." (`saveStory` still refuses a guardian). The
  ED round: "Start it in ED" / "Not for me" stay the student's (`store-ed.ts`), and a guardian reads "{First} picks the
  round."
- **Unchanged.** Parent emails (the weekly summary and the season brief) keep Your part; telemetry still records
  `by: "guardian"`; the calendar's subscribe feed is still the guardian's own.
