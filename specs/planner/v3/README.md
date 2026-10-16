# Plan v3: A Few Things to Do Now, Each With a Guide

> Status: **built** 2026-10-16 (PR #165) from the owner's review of the built Next steps (PR #160, merged 2026-10-15). Overview of
> the v3 specs (not a work item itself). Builds on the [planner](../README.md), its [redesign](../redesign/README.md), and
> [next steps](../next-steps/README.md); the parts below change what those built, and each says what it replaces.

## Why
The owner's review, in their words: the list's expand control is "confusing and hard to use"; the Next steps tab is
"too busy and overwhelming for a student"; some moves ask about next year ("I'm looking at a junior and it's asking them
about where they got into school"); and a student with a real SAT or ACT score is still told to take a practice test.

What the plan should do instead: **give a student two or three things they can do now or should be thinking about**,
and when they tap one, **take them to a screen designed for that one job**: making the list bigger, showing a college
interest, getting to a target score, writing their story, choosing APs, picking recommenders. The student can finish a
thing or skip it, the plan remembers either, and the parent's view carries the whole season's list with what was
skipped. Everything the student used to find under a row's "Details" either moves to the profile (connections) or into a
guide (visits, information requests, follows), so the list row is a name, a pill, and a trash can.

## The parts
| Part | Spec | What it changes | Complexity |
|---|---|---|---|
| 1 | [connections.md](connections.md) | Legacy, sibling, and recruiting leave the list row for a **Connections** step in the profile intake (after Work, before Other), entered like AP courses: pick a college, pick the connection. The row loses its expand control; **Remove** becomes a trash icon on the bar; visits, information requests, and follows leave the list (they return inside the Show interest guide) | Medium |
| 2 | [now.md](now.md) | The Next steps tab becomes **Now**: at most three cards, each opening a **guide**; Done and Skip, both remembered; nothing from a later season; no practice-test move for a student with a real score; the guide pattern (`/plan/guide/<slug>`) every guide below follows | Medium |
| 3 | [guides/list-size.md](guides/list-size.md) | **Build your list**: what a good list looks like for this season, where this list stands, and colleges like the ones already on it at the level that's missing | Large |
| 4 | [guides/show-interest.md](guides/show-interest.md) | **Show interest**: for one college, the acts that count in the order the evidence supports (tour, session, information request, follow) with the college's own upcoming events; what the student did is tracked by a return prompt and a next-day confirmation email, and confirmed registrations land on the calendar | Large |
| 5 | [guides/test-prep.md](guides/test-prep.md) | **Reach your score**: for a student under their target, study resources, where the current score stands on the list, and the upcoming dates for their test with registration tracked like a tour | Medium |
| 6 | [guides/your-story.md](guides/your-story.md) | **Your story**: one free-form narrative in place of three prompts, with depth and breadth as the frame and what the record already says beside it | Small |
| 7 | [guides/ap-choices.md](guides/ap-choices.md) | **Choose next year's APs**: the courses taken, the suggestions that add depth, and any course the student wants to add; every change writes the profile | Medium |
| 8 | [guides/recommenders.md](guides/recommenders.md) | **Pick your recommenders**: from the second half of junior year, teachers entered and ranked, what to think about, and how to ask | Small |
| 9 | [parents.md](parents.md) | The parent's Next steps: the season's whole list with when each move comes, what the student finished, and what they skipped | Small |

## Design principles
In addition to next steps' ([../next-steps/README.md](../next-steps/README.md#design-principles)):
1. **Three, not six.** Now shows at most three cards. When one is done or skipped the next surfaces, so the student is
   never shown the whole season, and never nothing while something applies.
2. **A card is a door, not a form.** A card has a title, one line of why, and one button that opens a guide. The guide is
   where the work happens; nothing on the tab asks for input beyond Done and Skip.
3. **One guide, one job.** Each guide is its own screen, designed for the task, reachable from its move and from the
   places that task naturally comes up (the list's balance notice, a pill, the profile). A guide never shows another
   guide's content.
4. **Capture where it's intuitive.** A fact about the student (a parent went to Duke) is entered in the profile with
   the other facts about the student, once, and read by every college it applies to. A fact about an act (we toured
   Duke) is captured in the guide that led to the act.
5. **Track honestly.** The site can't see what happens on a college's own page. It asks the student when they come
   back, confirms by email the next day, and writes a date to the calendar only once someone has said yes.
6. **Not until it's time.** A move appears in its own season, never earlier; a dated move from the next season appears
   at most two weeks ahead. Nothing on a junior's plan asks about applications or decisions.
7. **Skipping is a signal, not a failure.** Skip hides the card for the student and records who skipped it and when.
   The parent sees it as a fact ("Skipped Oct 12"), never as a count in red.

## Where it shows
- **`/plan`** (Next steps, the default): the season, up to three cards, a folded "Done and skipped" line, and "How this
  season works".
- **`/plan/guide/<slug>`**: the guides, each with a back link to the plan and the move's Done and Skip in its footer.
- **The list rows**: heart, crest and name, one pill, the senior status word, and a trash icon. No expand control. The ED
  pill opens the ED sheet as a dialog; the interest pill opens the Show interest guide for that college.
- **The intake**: a ninth step, Connections, between Work and Other; the people line's ring counts it.
- **A parent's `/plan`**: their part first, then the season's full list with Done and Skipped marks ([parents.md](parents.md)).

## What this replaces
| Built | Now |
|---|---|
| The row's Details control and capture panel ([../redesign/list.md](../redesign/list.md#simpler-planner-owner-2026-10-12)) | Gone. Connections → the profile; visits, information requests, follows → the Show interest guide; Remove → the bar's trash icon |
| `list_items.legacy`, `legacy_sibling`, `recruited` as the source of the hooks | `student_profiles.data.connections`, read by `hooksFromPlan`; the columns are backfilled from, then left unused |
| Now (six cards) + More this season + Coming up + Done ([../next-steps/seasons.md](../next-steps/seasons.md#the-next-steps-tab)) | Now (three cards) + a folded Done and skipped line. More this season and Coming up are the parent's, not the student's |
| The ED sheet inline under the row | The same sheet as a dialog from the pill, and the `ed` guide |
| The interest pill opening the capture panel | The pill opening `/plan/guide/interest?college=…` |
| Three story prompts ([../next-steps/your-story.md](../next-steps/your-story.md)) | One narrative field; the prompts become hints beside it |
| "Notice two teachers" in junior fall | "Pick your recommenders" from March of junior year, with the recommenders guide |
| The `plans_tests` dates reachable only through the intake | The test guide, with "I'll take it" and registration tracking |
| PSAT moves for everyone | None for a student with a real SAT or ACT score |

## Build order
```
connections ──► now ──► list-size
                 ├────► show-interest ──► test-prep (shares the act-tracking)
                 ├────► your-story
                 ├────► ap-choices
                 ├────► recommenders
                 └────► parents
```
Connections first: it removes the row's panel, which the Now work assumes gone. Now next: the three-card tab, the guide
route and footer, the Skip record, and the timing rules; every guide plugs into it. The guides are independent of each
other except that test-prep reuses show-interest's act tracking. Parents last, since it reads the skip record and the
season's list. Build with the `build-roadmap-section` skill, one unit per part; the two large guides each get an opus
unit.

## Shared rules
- Everything in next steps' shared rules holds: every move names its source; a skipped move never resurfaces in a brief;
  nothing on a card or guide is a number from the estimate; parents never see hooks or the story; telemetry records kinds
  and seasons, never a college on a pill or the text of anything typed.
- **A guide's advice is sourced the way a move's why is**: an advisor placement, a college's own filing with its edition,
  or the student's own record. No "you should".
- **Tracking an act never pretends.** An unconfirmed click is "pending", shown as such to the student and to no one else;
  it reaches the calendar only once confirmed, and expires a week after the event's date unconfirmed.
- **Guides write through the built stores** (`saveCourses`, `saveStory`, `logVisit`, `markInfoRequested`, `recordFollow`,
  `saveProfile`); no guide keeps data of its own except the act-tracking table and the recommenders field.

## Open questions for the owner
Each part keeps its own; these cut across:
1. **Which card did the junior see?** The one that asked "where they got into school" wasn't found in the generators
   (the decision and "where you landed" moves need an applied or enrolling college). The timing rule in [now.md](now.md)
   removes every next-season card regardless; naming the card would let the build check the fix against it.
2. **Recruiting in the Connections step?** It is per college like legacy, so the step can hold it ("A coach here is
   recruiting me" with the built picks). Recommendation: yes, one step for every "you and this college" fact.
3. **Social follows**: keep them as the last option inside the Show interest guide, or drop them from the site for now
   as the owner suggested for the row? Recommendation: keep, last, with the built "weakest signal" line; it costs
   nothing and `hooksFromPlan` already reads it.
4. **The PSAT/NMSQT for juniors with a real score**: the owner's rule drops every practice-test move. The junior PSAT is
   also the National Merit qualifier. Recommendation: drop it too, as asked; a student chasing National Merit knows.

## As built
1. **Recruiting in the Connections step**: adopted. The step captures legacy, sibling, and recruiting as three family chips on each college card.
2. **Social follows**: adopted. Kept as the last option in the Show interest guide with the built "weakest signal" line.
3. **The PSAT/NMSQT for juniors with a real score**: adopted. The PSAT entries get `applies: "no_real_score"` (false when the profile has a real SAT or ACT). The junior PSAT/NMSQT is dropped too for such a student.
4. **Which card did the junior see?**: still open. The card asking "where they got into school" wasn't found in the generators; naming it would let the build check the fix against it.
