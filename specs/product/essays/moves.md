# Part 4, Finish Your Essays: One Move That Follows the List

> Status: **built** 2026-10-30 (PR #194). Part 4 of [essays](README.md). After [prompts.md](prompts.md) and
> [workspace.md](workspace.md); shown on the Next steps tab ([../../planner/v3/now.md](../../planner/v3/now.md)) and
> ranked by [../../planner/record/ranking.md](../../planner/record/ranking.md); its screen is
> [tab.md](tab.md). Part of [product](../README.md).

## The owner's brief (2026-10-30)
"Starting in the summer before senior year and with increasing urgency leading into the fall students will need to
finish their essays. We should add Next steps tasks for this at the appropriate time and based on the student's list."

## Question it answers
*Which essay should I be writing right now, for which college, and how much is left?*

## What the site has
Three overlapping tasks and no reading of the drafts:
- The cycle file's **Draft the personal essay** (`personal_essay_draft`, Jun 15 to Aug 31, importance 78): opens the
  workspace; done only when the student taps Done.
- The cycle file's **Write each college's supplement essays** (`supplements`, Aug 1 to Oct 25, importance 50 by
  default): no button, nothing about which colleges.
- The apply generator's **Supplement n of N** rows per college (`supplement`, from the student's own typed count) and
  its shared **Write the Common App personal essay** row, importance 75 from senior fall, undated.

Meanwhile the data knows each college's prompts ([prompts.md](prompts.md): 27 colleges published, more each run)
and the workspace knows each draft's status (`draft`, `ready`, `submitted`) and which prompts it serves. Nothing
connects them. A student with twelve drafts in flight sees "Supplement 2 of 3" with no idea which one that is.

## The design: one essays move, always pointed at the next college
One move for the whole list, kind **`essays`**, key `{list}:essays:next`, replaces all of the above on the Next
steps tab. Its title, why, date, and urgency come from `essayProgress` (below), the same reading the Essays tab shows,
so the card and the screen never disagree. It never multiplies: a list of fifteen colleges is still one card, which
leaves the other two Now slots for the season's other moves. The detail per college lives on the tab.

### What it says, by state
| State | Title | Why (one or two lines) | Date |
|---|---|---|---|
| Nothing started (summer) | Write your essays | The personal essay is the summer's work: 650 words, and 4 to 8 drafts is normal. Your colleges' own prompts arrive by August. | none in summer |
| Personal essay in progress, no college prompts yet | Finish your personal essay | 412 of 650 words, draft. Start from your story. | none |
| College prompts on file, work left | Finish {College}'s essays | 2 of 3 to go for the {round} deadline. Then {Next college}, {date}. 14 essays left across 9 colleges. | that college's deadline |
| Only colleges not on file remain | Check what {College} asks you to write | We haven't read {College}'s essay page yet. Add what it asks for and write it here. | that college's deadline |
| Everything ready | Your essays are ready | All 23 ready. Paste each college's package into its form when you apply. | none |

The college named is the **earliest-deadline college with work left** (deadline order as the plan resolves it:
the chosen round's date through `applyDate`, else the regular date, undated last; the personal essay counts toward
every Common App college, so an unfinished personal essay makes every Common App college "work left" and the
earliest of them is named). The button is **Write it** and opens the Essays tab scrolled to that college
(`open_tab: essays`, `college` anchor); with nothing left it is **See them** (the tab). A guardian's card is the same
words (parents see the student's view).

### When it shows, and how urgent
- **Season**: the generator emits it from `summer_before_senior` through `senior_winter`, stamped with the **current
  season** on each regeneration (so it never reads as carried from a past season and never pays the −10). Before
  summer it is not generated: a junior never sees it, whatever the dates say (the application gate in
  `eligibleNow` covers it too: `essays` joins the application kinds).
- **Importance** (`essaysImportance(season)`, added to [ranking.md](../../planner/record/ranking.md)'s table):
  **72** in summer before senior year (just above "Your story" at 70: the story feeds the essay, and the two sit
  together on a summer plan), **85** in senior fall and winter. Plus the standard timing boost
  from the named college's deadline (+5 within 30 days, +10 within 14, +20 within 7, +30 overdue). So in late
  October a student with a Nov 1 ED deadline and essays left sees the card at 95, just under the Submit move itself.
- **Timing of the date**: `due_on` is the named college's deadline. The card shows it as every dated card does
  ("by Nov 1"). With no college named (summer, or everything ready) it is undated.
- **Done**: the move is ticked by the store, not the student, when `essayProgress.remaining` reaches zero after a
  status change (`setEssayStatus` to `ready` or `submitted`, a link that covers the last prompt, or a delete that
  removes an orphan prompt): `tickByKey(listId, "essays:next")`. The student can still tick it by hand (a student
  writing in Docs and pasting at the deadline); a regeneration never unticks. When work appears again (a college
  added with prompts, a draft set back to draft), the generator's title changes but a hand tick stays; the Essays
  tab is the truth.
- **Skipped**: "Skip for now" works as for any move; the generator keeps emitting it; it returns through Bring back.

### What counts as "work left" (`essayProgress`)
Pure, in `lib/essays/progress.ts`, shared by the generator, the card, and the tab:
```ts
export interface CollegeEssayProgress {
  unit_id: string; item_id: string; name: string;
  round: ListRound | null; deadline: string | null;      // the plan's own resolution (applyDate), ISO
  onFile: "published" | "none" | "refers_to_form" | "not_on_file";
  /** Required prompts, the personal essay for a Common App college, and `choose.n` of a choose set. */
  required: { ref: string; title: string; status: "not_started" | "draft" | "ready"; kind: EssayKind; limit: Limit | null }[];
  optional: { ref: string; title: string; status: ... }[];
  /** Free drafts the student made for this college (prompt_ref "free" with the college picked), counted by their own status. */
  own: { id: string; title: string; status: ... }[];
  ready: number; total: number;                           // over `required` (+ own)
}
export interface EssayProgress {
  main: { status: "not_started" | "draft" | "ready"; count: number; limit: 650 } | null;   // null when no Common App college
  colleges: CollegeEssayProgress[];                        // deadline order, undated last, withdrawn and declined colleges out
  remaining: number; total: number;                        // across main + every college's required
  next: CollegeEssayProgress | null;                       // the first with work left
  notOnFile: number;                                       // colleges whose page hasn't been read
}
export function essayProgress(input: { items, schools, essays: EssayRow[], links: EssayLinkRow[], platforms }): EssayProgress;
```
Rules:
- A prompt is **served** by a draft whose `prompt_ref` is the prompt's id or that is linked to it (`essay_links`);
  the first serving draft decides the status (`ready` and `submitted` both count as ready).
- **Required** means the prompt's `required` is true and `applies_to` is `all` (a program prompt is optional unless
  the student's intended major names that program, a later refinement); a **choose** set (`essays.choose`) contributes
  `n` required slots filled by any `n` ready drafts among its prompts.
- A college with `status: "none"` has nothing to write beyond the platform's; `refers_to_form` and not on file count
  as **unknown**: zero required, flagged (`onFile`), and the move names them only when every known college is done.
- **Platforms**: the personal essay (`platform:common_app:main`) is required once when any listed college takes the
  Common App (the item's platform is Common App or unset at a member); the Coalition's prompts are not required
  (students pick one; the Coalition's own essay is optional at most members), they show on the tab under the platform.
- Withdrawn and declined colleges are out; a college whose outcome is in and that is not enrolling is out.

### What goes
- `personal_essay_draft` and `supplements` stay in the cycle file for the **calendar** but their moves are importance
  **0** (`cycleKey` rule in `baseImportance`), so they never take a Now slot again.
- The apply generator stops emitting the shared `supplement:essay` row and the per-college `Supplement n of N` rows
  (the `supplements_count` field stays on the item and the Submit card can still show it as the student's own
  count). Existing rows become orphans, as a removed college's do, and leave the tab.
- The season explainer for summer and senior fall names the essays move ("the summer for the personal essay; the
  fall for each college's supplements, earliest deadline first").

## Worked example
Class of 2027, list: Duke (ED, Nov 1; 2 required + choose 1 of 5), Michigan (EA, Nov 1; 2 required), Georgia Tech
(EA, Oct 15; 2 short answers), Yale (RD, Jan 2; refers_to_form), Elon (rolling; none). Common App at all five.

| Date | Drafts | Card |
|---|---|---|
| Jul 10 | none | **Write your essays** · The personal essay is the summer's work… · 72 |
| Jul 28 | main 410 words, draft | **Finish your personal essay** · 410 of 650 words, draft. Start from your story. · 72 |
| Aug 20 | main ready | **Finish Georgia Tech's essays** · 2 of 2 to go for the EA deadline (Oct 15). Then Duke, Nov 1. 7 essays left across 3 colleges. · 85 + 0 |
| Oct 3 | GT ready | **Finish Duke's essays** · 1 of 3 to go… Then Michigan, Nov 1. 3 left across 2 colleges. · 85 + 5 = 90 |
| Oct 25 | Duke ready, Michigan 1 of 2 | **Finish Michigan's essays** · 1 of 2 to go for the EA deadline. 1 left. · 85 + 10 = 95 |
| Nov 3 | all ready | **Check what Yale asks you to write** · We haven't read Yale's page… · 85 (dated Jan 2) |
| Nov 20 | Yale's two free drafts ready | **Your essays are ready** · All 9 ready… · ticked by the store |

## Rules
- Never a word of essay text on the card, in telemetry, or in a notification: counts and college names only.
- A parent sees the same card; a parent cannot tick it (as any move).
- The move is one row: never one per prompt, never one per college.
- Dates come from the plan's own deadline resolution (the fix of 2026-10-29: in the student's cycle), never from
  the grid as printed.

## Telemetry
`plan_move_shown {kind: "essays", season, rank}` as every move; `essays_move_done {by: "store" | "hand", remaining: 0}`.

## Files (planned)
- `lib/essays/progress.ts` (new, pure): `essayProgress`; tests `tests/essays-progress.test.mts` with the worked
  example pinned.
- `lib/planner/generators/essays.ts` (new): `generate(input)` → the one move; `generators/index.ts` adds it after
  `apply`.
- `lib/planner/types.ts`: `TaskKind` gains `"essays"`; `GeneratorInput`/`PlanContext` gain `essays: { rows:
  EssayRow[]; links: EssayLinkRow[] } | null` (null when the tables aren't set up); `lib/planner/read-plan.ts`
  reads them with the plan (by the list's student), `lib/planner/context.ts` passes them.
- `supabase/migrations/20261030120000_essays_move.sql`: `plan_tasks_kind_check` widened with `essays` (the owner
  applies it to dev).
- `lib/planner/importance.ts`: `essaysImportance(season)`, `APPLICATION_KINDS` gains `essays`, the two cycle keys
  → 0; `lib/planner/generators/apply.ts`: the supplement rows go; `lib/planner/moves-catalog.ts`: explainer lines.
- `lib/essays/store.ts`: `setEssayStatus`, `linkEssay`, `deleteEssay` call `tickEssaysMove(studentId)` after their
  write (reads progress, ticks `{list}:essays:next` when `remaining === 0`).
- `components/planner/moves/EssaysCard.tsx` (or MoveCard with the `open_tab` action): the card; registry entry.
- Docs: [ranking.md](../../planner/record/ranking.md) "Changed" section; [seasons.md](../../planner/next-steps/seasons.md)
  summer and fall tables; [README.md](README.md) parts table.

## Complexity
Medium: one pure module, one generator, a kind, a migration line, and the store hook.

## Open questions
1. Should the move also name the personal essay once college prompts exist but the main essay is still a draft?
   Recommendation: yes, the main essay is "work left" at every Common App college, so the earliest such college is
   named and its why says "including your personal essay (410 of 650)".
2. Program prompts: required when the student's intended major matches? Recommendation: optional for now; the tab
   shows them under the college so the student decides.

## As built (2026-10-30)
Open question 1 was built as recommended: `lib/essays/progress.ts`'s `takesCommonApp` marks a college that uses the
personal essay, and an unfinished personal essay makes every such college "work left" (its why adds "including your
personal essay (n of 650)" in `lib/planner/generators/essays.ts`'s `essaysMove`). Open question 2 was not built:
program prompts stay optional for everyone (`applies_to: "all"` only counts as required), as recommended.

- `lib/essays/progress.ts` (`essayProgress`, pure) is the one reading, shared by the generator, the card, and the
  Essays tab ([tab.md](tab.md)). `lib/planner/generators/essays.ts` (`generate`, `essaysMove`, `essaysMoveState`,
  `essaysButton`) is the generator; `lib/planner/importance.ts` (`essaysImportance`) and
  `lib/planner/moves-catalog.ts` carry the ranking and the season explainer; `lib/planner/types.ts` gained
  `TaskKind: "essays"` and `MoveAction.open_tab.college`; `supabase/migrations/20261030120000_essays_move.sql` widens
  `plan_tasks_kind_check`. `components/planner/moves/MoveCard.tsx` renders the card (no separate `EssaysCard`); the
  anchor on `open_tab` opens the Essays tab scrolled to the named college. `lib/essays/move-tick.ts` holds the tick
  logic; `lib/essays/store.ts` calls it after `createEssay`, `setEssayStatus`, `linkEssay`, `unlinkEssay`, and
  `deleteEssay`.
- **Gate**: the season gate is `beforeApplicationSeason` (`lib/planner/importance.ts`), not a new function of its
  own; `essays` opens with `summer_before_senior`, every other application piece with `senior_fall`.
- **Free drafts tied to a college**: a draft on an **own ref**, `college:<unit_id>:<cycle>:own-<n>` (`ownRef`,
  `nextOwnRef` in `progress.ts`), not a `free` draft with no link as the spec's rule sketch assumed. `parsePromptRef`
  (`lib/essays/prompts.ts`) reads it as a college ref with `own: true`; a plain `free` draft with no link still
  counts nowhere.
- **Done**: the store ticks on `allReady` (`progress.ts`): something to write, all of it ready, and no college still
  waiting for its prompts — not the spec's bare `remaining === 0` (the worked example's Nov 3 row, where every known
  essay is ready but Yale isn't on file, would have ticked under the spec's wording but stays open as built, since
  "ready" shouldn't include a college nobody has read yet).
- **Choose sets**: `essays.choose`'s members are read by `ready`/`total`, never `required.length`, exactly as
  specified; several drafts serving one prompt resolve written-for first, then most recently edited.
- Withdrawn colleges, and any college whose recorded outcome isn't enrolling, are out, as specified.
- **Telemetry**: `essays_move_done {by: "store" | "hand"}` only — no `remaining` field (the spec's draft telemetry
  line names one; the build leaves it off since the move's own remaining count is read fresh from `essayProgress`
  whenever it matters, never stored on the event).
- **Worked example** (the table above), as the build's fixture actually reaches each state: the **Oct 3** row needs
  two of Duke's three essays ready, not one, to reach "1 of 3 to go… Then Michigan"; **Oct 25** is 7 days from the
  EA deadline, so the timing boost is **+20**, giving **85 + 20 = 105, clamped to 100** (not 95); **Nov 20**'s total
  across main plus every college is **10**, not 9 (the personal essay counts once in that total, as the main `main`
  field describes, on top of the colleges' nine).

## Not built
- Program prompts required by intended major (open question 2): left optional, as recommended.
- Counselor grants on the move or its data (out of scope for this build; the tab still only reads a student's own
  draft rows).
