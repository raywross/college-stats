# Part 2, Now: Three Cards, Each a Door to a Guide

> Status: **built** 2026-10-16 (PR #165). Replaces the Next steps tab's layout ([../next-steps/seasons.md](../next-steps/seasons.md#the-next-steps-tab))
> and adds the guide pattern every guide in [guides/](guides/) follows, the Skip record, and two timing rules. Part 2 of
> [plan v3](README.md). The season model, the moves, the generators, and the notifications are unchanged.

## Goal
The owner: "Next steps is too busy and overwhelming for a student. What we're trying to do here is give them a few
things they can do now or should be thinking about. We should have 'help me' screens that we jump to in order to guide
them through. We shouldn't have a million tasks: 2 or 3 things that they can do now. They should be able to clear them
or skip them, and we should keep track that they did that."

## The tab
```
Junior spring · Class of 2028                              [How this season works]

┌─────────────────────────────────────────────────────────────────────┐
│ Build your list                                                      │
│ Your list has 3 Reaches and 2 Targets and no Likely yet.             │
│                                        [Help me build it →]          │
├─────────────────────────────────────────────────────────────────────┤
│ Show Elon you're interested                                          │
│ Elon says applicant interest is important (2025–26, CDS C7).         │
│                                        [Show me how →]               │
├─────────────────────────────────────────────────────────────────────┤
│ Pick your recommenders                                               │
│ Junior-year teachers know your work best; the asking comes by June.  │
│                                        [Help me pick →]              │
└─────────────────────────────────────────────────────────────────────┘
                                                      Done and skipped (4) ▸
```
- **At most three cards** (`NOW_MAX` 3). A card is the move's title, its why (one or two lines, cited where it's a college
  fact), the date when it has one, the assignee chip when it isn't the viewer, and **one button** that opens the move's
  guide (the button's words come from the guide: "Help me build it", "Show me how"). A move with no guide keeps its
  built one-button action (the PSAT page, the Common App link, Mark applied) and the plain `MoveCard`.
- **Done and Skip** live in the card's corner menu (`⋯`: Done · Skip for now) and in the guide's footer, not as two
  buttons on every card. Done folds the card with a check for a minute, with Undo, as built. Skip folds it at once.
- **When a card goes**, the next-ranked open move takes its place, so there are three while three apply.
- **Done and skipped (n)**: one folded line; opened, this season's done moves with a check and date, and its skipped
  moves with "Skipped Oct 12" and **Bring back** (clears the skip). Nothing else on the tab: no "More this season", no
  "Coming up", no counts.
- **Header**: the season in words and the class year; **How this season works** opens the built explainer sheet, now
  with next season's one line kept (the one place a student sees ahead).
- **Nothing applies**: "Nothing to do right now. Enjoy it." and the explainer's lead.
- **A parent** gets this same tab, word for word (owner, 2026-10-16; [parents.md](parents.md) "the student's view, everywhere on the plan").

## Ranking
`nowMoves` keeps its buckets and takes three: overdue dated moves, dated moves within 14 days, ED decide moves inside
their window, then the playbook's order, then the rest by date. Two changes:
1. **Season gate (owner: "we shouldn't show stuff that's for next year").** A move is eligible only when its season
   (`taskSeason`) is the current one or an earlier one that carried, **or** it is dated within 14 days (so "Common App
   opens Aug 1" shows in late July). A move of a later season is otherwise invisible to the student: not in Now, not in
   a fold. The generators already emit only this season's and next season's playbook entries; the college, apply, and
   offers generators emit dated tasks for the whole cycle, and this gate is what keeps a junior from seeing them.
   `ApplyStatusControl`, the decision picker, the Offers tab trigger, and "Tell us where you landed" are therefore never
   on a junior's plan (and `applying.md`'s moves start in `senior_fall` as written).
2. **Skipped moves are out** for the student (`dismissed`, as built) until brought back.

## Skip, recorded
`plan_tasks.dismissed` stays the flag. The migration adds `dismissed_at timestamptz` and `dismissed_by uuid` (set by the
built `dismiss` action, cleared with the flag by a new `undismiss`), so a parent can see when and who, and telemetry
`plan_move_skipped {kind, season}` is unchanged. The skip is per move; the generators never reset it (built). A skipped
move stays out of briefs and the week (built rule).

## Timing rules
- **No practice test for a student with a real score (owner).** The three PSAT moves (`freshman_psat_practice`,
  `sophomore_psat_practice`, `psat_nmsqt`) get `applies: "no_real_score"`: false when the profile has an SAT total or
  ACT composite that isn't marked practice. The cycle file's PSAT entries, where any exist, get the same `applies`
  value. (Overview question 4 covers the NMSQT caveat.)
- **Nothing before its season** (above). `Coming up` leaves the student's tab; the explainer's one line about next season
  is the only preview.
- **Guides are reachable anytime** from their natural places (below), whether or not a move is open, so "not yet" never
  means "can't".

## The guide pattern
Every guide is a page at `/plan/guide/<slug>` with `?for=<student>` (the plan's person resolution) and the guide's own
query (`?college=<unit id>`, `?level=likely`). Server-rendered like `/plan`, the same access rules (the student, or a
guardian who can see them; a guardian who can't edit sees the guide read-only), the plan's frame without the tabs.

```
← Back to your plan                                      Junior spring · Class of 2028
Build your list
Your list has 3 Reaches and 2 Targets and no Likely yet.        ← the move's why, when opened from a move

[ the guide's body ]

─────────────────────────────────────────────────────────────────────
[Done with this]   [Skip for now]                       ← the move's footer, when one is open
```
- **Header**: the guide's title, the open move's why beneath it when a move led here (`?move=<task id>`), else the
  guide's own one-line purpose.
- **Body**: the guide's design. Each guide spec draws it.
- **Footer**: the move's Done and Skip when a move is open, then back to the plan (both return to `/plan`); without a
  move, "Back to your plan" only. Many guides tick the move themselves when the work is done (the list reaches shape,
  a visit is logged, a date is picked); the footer's Done is for the student who did it elsewhere.
- **Registry**: `lib/planner/guides.ts` maps a move kind (or a `kind:variant`, or a playbook key) to `{ slug, button,
  title, hrefFor(move) }`; `MoveCard` reads it for the button; `app/plan/guide/[slug]/page.tsx` renders the guide
  component. A kind with no entry has no guide.

| Move (kind or playbook key) | Guide | Button |
|---|---|---|
| `shape_gap:*`, `build_list`, `long_list` | [list-size](guides/list-size.md) `list` | Help me build it |
| `show_interest`, `visit_ed`, `fall_break_visit`, `spring_break_visit`, the early years' `visit_travel` | [show-interest](guides/show-interest.md) `interest` | Show me how |
| `pick_test`, `register_spring_test`, the built retake notice, the test-date tasks | [test-prep](guides/test-prep.md) `test` | Help me get there |
| `story`, `brag_sheet`, the essay window's "start from your story" | [your-story](guides/your-story.md) `story` | Write it |
| `choose_courses` (both years), `junior_choose_courses` | [ap-choices](guides/ap-choices.md) `courses` | Help me choose |
| `pick_recommenders` (new), the cycle's `ask_recommenders`, `thank_recommenders` | [recommenders](guides/recommenders.md) `recommenders` | Help me pick |
| `ed_decide`, `ed2_decide` | the built ED sheet as a page, `ed` | See the facts |
| `profile`, `activities`, `class_year` | the intake on the step (built) | Add it |
| everything else | the built action | as built |

**Reached without a move:** the list guide from the Colleges tab's balance notice and the add-college pill's "Help me
build it" link; the interest guide from a row's interest pill and from the college profile's visit card when signed in;
the test guide from the Numbers page's test row; the story guide from the Numbers page's Your story section; the courses
guide from the Numbers page's Courses section and the course-plan card; the recommenders guide from the Numbers page.

## Rules
- A card's words are the catalog's; a guide's words are its own spec's, tested for no number from the estimate.
- Done, Skip, and Bring back are attributed (`done_by`, `dismissed_by`) and optimistic, rolling back on a refused write.
- A guardian who can't edit sees the three cards without the menu and without the footer's buttons.
- The people line's "Next:" is Now's first card (built).
- Telemetry: `plan_guide_opened {slug, from: move|pill|notice|profile}`, `plan_move_restored {kind, season}`, and the
  built `plan_move_shown`, `plan_move_done`, `plan_move_skipped`.

## Files (planned)
`lib/planner/moves.ts` (`NOW_MAX` 3, the season gate, `skippedMoves`), `lib/planner/guides.ts` (the registry),
`lib/planner/generators/season.ts` (`no_real_score`), `lib/planner/moves-catalog.ts` (the PSAT entries' applies),
`lib/planner/store.ts` (`undismiss`, `dismissed_at`/`dismissed_by`), `components/planner/NextSteps.tsx` (three cards,
the corner menu, Done and skipped), `components/planner/moves/MoveCard.tsx` (the guide button),
`app/plan/guide/[slug]/page.tsx`, `components/planner/guides/GuideFrame.tsx`, migration
`…_plan_v3.sql` (`dismissed_at`, `dismissed_by`, the bundle function). Tests: `tests/planner-moves.test.mts` (three;
the season gate with a junior's cycle tasks; the 14-day lead; a skipped move out and back; no practice move with a real
score), `tests/planner-guides.test.mts` (every registry entry has a page; every guide's words pass the catalog guard).

## Open questions
1. Should the corner menu also offer "Remind me next season" (snooze to the season's end)? Recommendation: not now;
   Skip plus the parent's view covers it, and a third state complicates the record.
2. Should Done and skipped show the whole year or this season? Recommendation: this season, as the built Done fold did.

## As built
- Skip is stamped: `dismiss(taskId, true)` sets `dismissed_at = now()` and `dismissed_by = auth.uid()`; `undismiss(taskId)` clears all three. The three-card tab shows Done and skipped as a folded line with dates and a Bring back button for editors.
- `NOW_MAX` 3 also applies to the weekly email's child moves and the calendar week's moves (they read `.now`).
- `PSAT entries get `applies: "no_real_score"`: false when the profile has a real SAT or ACT (not practice).
- `reach_score_*` moves are generated one per season (junior fall → senior fall), with titles filled from `profile.tests.target` ("Work toward your 1400"). Seasons without a target don't emit the move.
- `pick_recommenders` replaces `notice_teachers`, starting junior spring with `applies: "recommenders_open"` (fewer than two entries asked/agreed/invited).
- Guides write through built stores; no guide keeps data except the act-tracking table. A guardian without edit sees the three cards without the menu and no footer buttons.
- **Fix round (2026-10-16, plan-v3-fix-cards).** A guardian now sees the same three cards the student does (`parents.md`'s "As built" note), with `parentSafeTitle` masking a `reach_score_*` title (later the same day the mask and Your part went too: a parent sees the student's view exactly). The `profile` playbook entry's title names the first missing section in `PROFILE_SECTIONS`' order ("Add your high school", "Add your AP courses", "Add your grades" or "Add your class standing" once the GPA's in, "Add a test score or target", "Add your clubs", "Add your sports", "Add an intended major", "Add work and internships", "Add awards and more", "Add your state", "Add your connections (or none)") instead of the generic "Fill in your numbers and courses" (`profile-progress.ts`'s `SECTION_MOVE_TITLE`/`firstMissingSection`, `moves-catalog.ts`'s new `titleFor`). `build_list`/`long_list` name the list's thinnest level against the senior shape's minimums ("Add a few Reach schools" / "Add a Reach school", `list-shape.ts`'s `listGapTitle`); `shape_gap:reach_min` is retitled "Add a Reach school" to match (was "Room for a Reach").

## Superseded (2026-10-16)
The "Ranking" section's buckets are replaced by an importance score per move ([../record/ranking.md](../record/ranking.md));
the season gate, the cap of three, Done and Skip stand. The story and recommenders moves open the summer before senior
year (the owner's timing), and the record ([../record/README.md](../record/README.md)) is where facts are entered.
