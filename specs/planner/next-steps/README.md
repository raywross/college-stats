# Next Steps: The Plan Drives the Work, Season by Season

> Overview of the next-steps specs (not a work item itself). Written 2026-10-14 from the owner's brief ("drive actions
> from students and parents: tasks contextual to the graduation year, shown when they log in and sent to bring them
> back; good ED opportunities on the list; visits and interest where they count; a shape for a good list") and research
> into how college advisors run the process. Each part below is a separate work item on the [roadmap](../../roadmap.md).
> Builds on the [planner](../README.md) and its [redesign](../redesign/README.md); extends the [chances](../../chances/README.md) work.

## Why
The planner knows a great deal and asks for little: three numbers, a Dream, a list. It sorts the list, starts the
rounds, generates a hundred dated tasks, and can email and text. What it doesn't do is **lead**. A sophomore who opens
it sees a list and a calendar with nothing on it; a junior in March, the month advisors call the pivotal one, sees the
same two tabs; a senior can't even mark a college applied since the simplification of 2026-10-12 took the status chip
off the row "to tie into the recommendations in a future PR". The task engine still runs on every open and the Sunday
email still reads it, but nothing on `/plan` shows a task.

A paid advisor's real product is sequence: the right three things this season, said once, with a reason. These specs
give the plan that sequence, anchored on the student's graduation year rather than the day they signed up, and put it
where a family will see it: a **Next steps** tab that `/plan` opens to, pills on the list rows, and the reminders that
already exist. Nothing here adds a new engine; it adds a surface, a season rule, and three rule sets (early decision
opportunities, interest and visits, the shape of a good list) over what is built.

## Research (2026-10-13)
Summarized here; each part cites what it uses.

- **Advisors agree on the sequence.** College Board, NACAC, Princeton Review, IvyWise, College Coach, Spark, Crimson,
  Empowerly and a dozen district timelines place the same tasks in the same seasons. 9th–10th: a four-year course plan,
  try activities then deepen one or two, the PSAT as practice, informal visits when travelling; parents settle what
  they can pay, privately. Junior fall: the PSAT that counts, visits over breaks, notice which teachers to ask. Junior
  winter and spring: net price calculators and the money conversation **before the list is final**, the first SAT or
  ACT, spring-break visits, ask two teachers before summer, the counselor's brag sheet. Summer: the list to its final
  size, four to eight drafts of the personal essay, the ED decision firmed. Senior: Common App opens August 1 (the
  account rolls over, recommender invitations don't), FAFSA and CSS Profile October 1, early deadlines November 1 and
  15, results in mid-December, the ED II window of two to four weeks after, regular deadlines January 1–15, decisions by
  April 1, the reply date May 1, then the summer list. Where sources disagree (the first SAT in junior fall or spring;
  recommendations asked in spring or September) the specs take the earlier date, since the task can wait but can't be
  moved up.
- **What a paid engagement delivers** (IECA standards, IvyWise, Command, Crimson, Collegewise, Spark, College Coach,
  Empowerly): a course plan, a testing plan, an activities résumé kept each semester, a positioning or "story", a
  balanced list with cost beside each college, an essay calendar, a recommendation plan, a visit plan, the ED/EA
  conversation in August of senior year, the money conversation in junior year, and a decision framework in April.
  Advisors never write essays or fill in forms (IECA); neither does the site. Cadence: weekly in senior year, monthly
  before. Fees average about $6,400 per student (2025 survey of 600 consultants), which is the gap this work fills.
- **The balanced list.** 8–12 colleges is the consensus (College Board's minimum 3 reach / 2 match / 1 safety;
  CollegeVine 25/40/35; Scoir 3 likely / 3–4 level / 2–3 reach; IvyWise 13–15; Common App's actual 2025–26 average 7.06
  applications per applicant). Every source now says **at least two Likelies the student would happily attend**, and
  several add that one must be **affordable** ("financial safety": College Board, College Transitions, College Kickstart).
  The owner set the site's shape at 12–15 ([list-shape.md](list-shape.md)).
- **Early decision.** Raw ED-to-regular gaps run 2–4× at the most selective colleges (Brown 16.5% ED against about 4%;
  Bowdoin 14.8% against 5.4%) and near zero or negative at others (Franklin & Marshall 28.1% ED against 28.2% overall;
  Loyola Maryland 42% against 76%). Dartmouth's own FAQ calls its early rate "somewhat misleading" because it includes
  recruited athletes; Brown's ED rate falls from 21.9% to 15.6% with athletes removed; the only rigorous estimate (Avery,
  Fairbanks and Zeckhauser, 14 colleges) put the edge at about 100 SAT points. Nearly every college reports ED I and
  ED II together (Emory, which doesn't, admitted 10% in ED II against 11% overall). Advisors' three tests: the student
  would attend regardless; the family can be bound without comparing offers; the college is plausible, not a lottery.
  Quad's estimate already discounts the gap and gives a verdict per college and student
  ([../../chances/method/standing.md](../../chances/method/standing.md)); the pill in [ed-opportunities.md](ed-opportunities.md)
  shows only when that verdict says ED moves the level.
- **Demonstrated interest.** About 40% of colleges weigh it (NACAC; 44% at least "moderate"), concentrated at mid-sized
  selective privates managing yield; the Ivies, Stanford, MIT, Caltech and most large publics say "not considered".
  The one peer-reviewed study (Dearden, Li, Meyerhoefer and Yang, 2017, one selective private university, 12,501
  applicants) found a registered visit worth far more than an email, and both worth more for stronger applicants. What
  colleges log in Slate: event registration and attendance, inquiry forms, contact with the regional representative,
  email opens. No college confirms counting social-media follows. So the order is visit, then contact or an information
  session, then opening its email, then follows, and one action is enough ([interest-and-visits.md](interest-and-visits.md)).
- **Reminders.** Castleman and Page's texting trials (one concrete, dated task) remain the evidence the planner's
  reminders were built on; Naviance's reminders fire only when a school configures them and leave an "Overdue" pile;
  College Kickstart sequences its action plan by dependency ("what you can skip if the early round lands") rather than
  as a flat list. The specs keep the built cadence and add one brief when a season turns ([notifications.md](notifications.md)).

## The parts
| Part | Spec | What it adds | Complexity |
|---|---|---|---|
| 1 | [seasons.md](seasons.md) | The season model anchored on the graduation year; the playbook of moves per season for students and parents; the **Next steps** tab, now the default; the people line's "Next:"; what a late joiner sees | Large |
| 2 | [ed-opportunities.md](ed-opportunities.md) | **Good ED opportunity** pills on the list (at most three, Dream first, then the lower end of Reach, then the upper end of Target), ED I or ED II by what the college offers, the facts behind each, and the decide-by-date moves | Medium |
| 3 | [interest-and-visits.md](interest-and-visits.md) | Visit moves for every ED candidate; "show interest" moves (visit, contact or information session, follow) where the college says interest counts, in the upper-Target / lower-Reach band; the **Interest counts here** pill | Medium |
| 4 | [list-shape.md](list-shape.md) | The shape of a good list by season (12–15 for seniors: 0–2 High reach, 2–3 Reach, 5–8 Target, 2–3 Likely, 2–3 Safe, one affordable), the gap moves, and a rail of colleges at the missing level | Medium |
| 5 | [applying.md](applying.md) | The senior moves that re-home what the simplification removed: submit and mark applied, record each decision, ED II after a deferral, compare offers, decide by May 1, tell us where you landed | Medium |
| 6 | [notifications.md](notifications.md) | Bringing people back: the season brief, the weekly moves in Your week and the parent summary, the day-before texts, the header dot; monthly before junior year, weekly after | Medium |
| 7 | [your-story.md](your-story.md) | Three private prompts that start the narrative in junior year and feed the essay window | Small |

## Design principles
In addition to the planner's ([../README.md](../README.md#shared-rules)) and the redesign's ([../redesign/README.md](../redesign/README.md#design-principles)):
1. **The season decides, not the sign-up date.** Every move is placed by `seasonOf(gradYear, today)`. A junior who
   joins in March sees junior-spring moves and nothing overdue from the fall; a senior who joins in October sees this
   week. Moves from past seasons that still matter (no Likely on the list) come forward as this season's moves, not
   as a backlog.
2. **Three to six things, each with a why and a button.** A move is one card: what, why (cited when it's a college
   fact), one action, done or skip. Never a wall of tasks; "More this season" and "Coming up" are folded.
3. **A flag, never an instruction.** The owner's decision (2026-10-14): the plan may name a **Good ED opportunity**
   and say why; it never says "apply". This replaces the rounds rule "no sentence recommends applying early
   anywhere" ([../redesign/rounds.md](../redesign/rounds.md#rules)); the rule becomes *Quad may flag an opportunity by
   name; the student decides, and the facts and caveats are one tap away.*
4. **Only where the data allows.** No ED pill without published ED counts and a verdict from the estimate; no interest
   move where the college says interest isn't considered or hasn't said; no invented dates. Where data is missing the
   row's details say so and nothing is suggested.
5. **One engine.** Moves are `plan_tasks` rows with new kinds, generated by the existing idempotent generators, so the
   Sunday email, the day-before text, the calendar feed and the parent summary read them without new plumbing. Pills
   are the row-level rendering of an open move for that college.
6. **Parents get their part, not a copy.** Money, calculators, aid forms, the ED cost check, the award comparison: on
   their own cards, in their own brief, with the student's moves visible but not theirs to tick unless they can edit.
7. **Encourage, don't grade.** No "behind", no counts of what's undone in red, no comparison between siblings. A
   season with nothing to do says so.

## Where it shows
- **`/plan`** opens to **Next steps** (owner, 2026-10-14) for students and parents; Colleges and Calendar are one tap
  away; Offers appears with the first decision as today.
- **The people line's "Next:"** is the top move, replacing the profile-completeness-only step (profile steps become
  moves in the early seasons, so nothing is lost).
- **The list rows** carry at most one pill: **Good ED opportunity** (or **Good ED II opportunity**), else **Interest
  counts here**, else none; the row's "Details" count already marks the smaller to-dos.
- **The header's Plan dot** lights for a new move since the last visit, not only for a deadline within seven days.
- **Email and text** through the built channels, with one brief when a season turns.

## Owner decisions (2026-10-14)
1. **ED wording:** "Good ED opportunity", a plain flag with the facts behind it and a "Start it in ED" button.
2. **Placement:** a new **Next steps** tab, the default on login.
3. **The senior list:** 12–15 colleges: 0–2 High reach, 2–3 Reach, 5–8 Target, 2–3 Likely, 2–3 Safe.
4. **New capture:** the "Your story" prompts only; no résumé export and no essay tracker in this section.

Assumptions stated with the questions and not objected to: one Dream stays one; interest moves fire at any Reach or
Target where the college rates interest important or very important, and only in the upper-Target / lower-Reach band
where it is merely considered; nothing sends instantly; email and texts stay dormant until the domain and Twilio are
set up; no essay editor.

## Build order
```
seasons ──► ed-opportunities ──► interest-and-visits
   │               │
   ├──► list-shape │
   ├──► applying   │
   ├──► your-story │
   └──► notifications (after the others, so the brief has moves to carry)
```
`seasons` first: the season function, the move kinds, the tab, the people line. The three rule sets and the applying
moves are independent of each other once the tab exists; interest reads the ED candidates, so it follows
ed-opportunities. Notifications last. Build with the `build-roadmap-section` skill, one unit per part.

## Shared rules
- **Every move names its source**: a college's date with its edition, the cycle file's entry, the estimate's verdict, the
  list's counts, or the season itself ("Advisors place this in junior spring"). A move with no source isn't generated.
- **A move is never deleted by regeneration.** Done stays done; a move whose reason went away (the college dropped
  ED II, the list gained a Likely) is marked and folded, as tasks are today ([../timeline.md](../timeline.md#rules)).
- **Skip is a choice.** "Not for me" dismisses a move or pill for that college or season and is remembered; the brief
  never resurfaces it.
- **Nothing on a card or pill is a number from the estimate.** The level and the closeness order what shows; the card
  says "Target for you" and never a percentage, a multiple, or "your odds" ([../../chances/README.md](../../chances/README.md#shared-rules)).
- **Parents see moves, never hooks or private notes**; the Your story prompts are private to the student.
- **Telemetry** records the move kind and season, done or skipped, never the college by name on a pill (the group is
  fine), never the text of a story prompt ([../../product/telemetry.md](../../product/telemetry.md#privacy)).

## Open questions for the owner
None at the overview level; each part keeps its own.
