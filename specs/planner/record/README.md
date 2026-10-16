# Your Record: One Place to Enter Everything, and Three Things Ranked

> Status: **built** 2026-10-16 (PR #165). Overview of the record specs (not a work item itself). Changes the intake
> ([../redesign/intake.md](../redesign/intake.md)), the household Numbers tab
> ([../../product/household-hub.md](../../product/household-hub.md)), and how Now picks its three cards
> ([../v3/now.md](../v3/now.md)); each part below says what it replaces.

## Why
The owner, after using the preview: "You've split where we're entering information. On the Plan page, each student fills
out a section called 'What's your plan'. Then in the household page there's a section called 'Numbers'. These are really
the same thing, but some functions are in one place, some the other. They should all be together. I really like the
guided tour; it's very usable." And: "'How complete is this' may be a better view than the check boxes." "'What's your
plan' needs to be renamed: this is really the student profile, or their CV, or a combination." "'Parents can edit'
belongs under 'your account'." "'Choose next year's courses' and 'Reach your score' don't belong on the profile; those
are tasks we should show at the right time, weighed against the other things. Come up with an importance ranking."
"Choosing a major goes in the guided section, entered the way the other entries work: type, with a few common choices to
click, more than one." "Your story and Pick your recommenders are their own sections too; they don't need filling out
until the summer before senior year." "On each screen, less explanatory text: collapsed areas or info icons."

## The name
The guided tour and the Numbers tab both hold facts about the student: grades, tests, courses, activities, work,
connections, the major, where they'd go, their story, their recommenders. That is both the profile (who they are) and the
CV (what they've done): everything a college will read about them. The site already uses "profile" for a college's page,
so the student's is **Your record** ("Jordan's record" to a parent). One place, one name; the tour fills it, the overview
shows how complete it is. The word is set once (`RECORD_LABEL` in `lib/planner/record.ts`), so a different choice is a
one-line change. Alternatives considered: "About you" (friendly, but says nothing about accomplishments), "Your profile"
(collides with college profiles), "Your résumé" (job-flavored).

## The parts
| Part | Spec | What it changes | Complexity |
|---|---|---|---|
| 1 | [steps.md](steps.md) | **One guided entry, "Your record"**: the Numbers tab's fields become steps of the tour (Basics: state, fee waiver, first generation; Where you'd go: size, setting, states or regions, type, the cost limit); new steps for the major, your story, and your recommenders; a **record overview** page with "How complete is this" (what each tool needs, what's missing, Edit per section) replacing the Numbers page and the rail's check marks; "Parents can edit" moves to `/account`; the course and test links leave the record (they are moves) | Large |
| 2 | [majors.md](majors.md) | **The major picker**: type a word, see the matching families and the common ones as chips, pick up to three; aliases ("pre-med", "nursing", "CS", "finance") | Small |
| 3 | [ranking.md](ranking.md) | **Importance ranking**: every move gets a base importance by kind, adjusted for timing and season; Now shows the three highest that apply; as one closes the next surfaces. Your story and Pick your recommenders open the summer before senior year; the course choice only in its window | Medium |
| 4 | [less-text.md](less-text.md) | **Less explanatory text** on every plan screen: a title and one line, with the rest behind a "Why this matters" fold or an info icon; the per-screen list | Small |

## Design principles
In addition to plan v3's ([../v3/README.md](../v3/README.md#design-principles)):
1. **One place for a fact.** Anything about the student is entered in the record and read everywhere; no field has a
   second home. A guide may show a fact and link to the step that edits it; it never edits a profile fact itself except
   through the record's own saves (the courses guide and recommenders guide keep writing the profile, since the owner
   asked for those edits to flow back).
2. **The tour is the way in; the overview is the map.** First run walks the required steps and offers the rest. After
   that, the overview shows every section, what it unlocks, and Edit; a section's Edit opens the tour at that step.
3. **A task is not a field.** Anything with a season or a deadline (choose next year's courses, reach your score, write
   your story in time for the essay, pick your recommenders) is a move, ranked and shown on Now when it's time; the record
   holds only what the student knows today.
4. **Three by importance, not by order.** Now shows the three highest-ranked moves that apply; the rest wait their turn.
5. **Say it once, then fold it.** Every screen opens with a title and one line. Why it matters, how to think about it, and
   where the numbers come from live behind one fold or an info icon.

## Where it shows
- **`/plan`**: the first-run tour when the record has no class year and no grades or test (as the intake does today);
  otherwise the people line's ring and "Next:" read the record's completeness and the top-ranked move, and its ✎ opens
  **Your record** (the overview).
- **`/household/[person]/record`** (the Numbers tab, renamed): the overview. `/household/[person]/numbers` redirects to
  it. The segmented control reads **Plan | Record**.
- **`/plan?record=1&step=n`**: the tour in edit mode at a step (`setup=1` still works and means the same).
- **`/account`**: "Parents can edit" under the student's own account sections, beside Household.
- **Now**: three cards by importance ([ranking.md](ranking.md)).

## What this replaces
| Built | Now |
|---|---|
| The Numbers tab (`components/me/StudentNumbers.tsx`, `ProfileForm.tsx`, `CompletenessMeter.tsx`) | The record overview (`components/record/RecordOverview.tsx`) with the completeness view; the form's fields are tour steps |
| The intake's nine steps (`IntakeStep` 0–9) | Thirteen steps (`RecordStep`): Grades, Test, AP courses, Sports, Clubs, Work, Connections, Other, Major, Basics, Where you'd go, Your story, Recommenders, Review, Done |
| "Parents can edit" on the Numbers page | On `/account` |
| The Numbers page's "Choose next year's courses", "Pick your recommenders", "Reach your score" links | Gone; those are moves, ranked and shown on Now at the right time (the guides stay reachable from their moves and from the overview's section lines: the story section links the story guide, the recommenders section the recommenders guide) |
| `nowMoves`' buckets (overdue, soon, ED window, playbook order) | `importance(task)` and a sort by it, same season gate |
| The story move in junior fall; recommenders in March of junior year | Both from the summer before senior year (the owner's timing) |
| The intake's checkbox-style rail | Stays on the tour (it's the tour's progress); the **overview** shows completeness per section with what it unlocks |
| Explanatory paragraphs at the top of steps and guides | One line each; the rest folded ([less-text.md](less-text.md)) |

## Build order
```
steps ──► majors
  ├─────► ranking
  └─────► less-text
```
Steps first (the record's shape, the overview, the routes); the major picker is a step inside it; the ranking changes
`moves.ts` and the catalog's timing and can run beside; less-text touches every guide and step last so it edits the
final copy. Build with the `build-roadmap-section` skill, one unit per part (steps split in two: the data and routes, then
the overview and steps' UI).

## Open questions for the owner (answered)
1. **The name.** "Your record" is the proposal (one constant to change). Alternatives: "About you", "Your profile".
   **Adopted: "Your record."**
2. **How many majors.** Three today (`MAX_INTENDED_MAJORS`); the owner said "more than one". Recommendation: keep three
   (the estimate's major reading and the likeness fact use the first; three keeps the list honest).
   **Adopted: three majors.**
3. **The cost limit's home.** It is a parent's fact (the walk-away number) stored on the student's preferences.
   Recommendation: in the Where you'd go step, labeled "The most your family would pay in a year (a parent can fill this
   in)", editable by a guardian with edit access.
   **Adopted: in the Where you'd go step, parent's field.**

## As built by R1a–R6
- Four record specs and reading.md all built, with all role-gated access and merge-and-verify green light
- The name "Your record" is `RECORD_LABEL` in `lib/planner/record.ts`; changing it changes the UI everywhere
- The major picker handles three families maximum with aliases and the eight common families as chips
- Importance ranking sorts moves by season, deadline, and move kind; "story" and "pick recommenders" open summer before senior year
- Every screen now opens with one line; longer text lives behind folds and info icons
- The record overview replaces the Numbers tab; "Parents can edit" moved to /account
