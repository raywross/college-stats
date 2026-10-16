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
