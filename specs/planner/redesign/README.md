# The Planner, Redesigned: Numbers First, Less on the Screen, a Calendar for Parents

> Overview of the planner redesign (not a work item itself). Written 2026-10-09 from the owner's review of the built
> planner ([../README.md](../README.md), built 2026-10-08 as PR #103), feedback from students who tried it, and new
> research. Each part below is a separate work item on the [roadmap](../../roadmap.md). A clickable preview with a
> sample family over real college records is at **`/plan/preview`** on preview deployments (not served in production).

## Why
The planner is meant to be the site's main selling point: it takes everything Quad has collected about colleges and
uses it to get a family organized. The first build did the work but showed too much of it. What the owner and the
students who tried it said (2026-10-09):

1. **It's buried.** The plan sits under the profile menu → Household → a person → the Plan tab. It should be a
   top-level link with the same weight as Explore.
2. **It's too much information.** A student shown the Rounds stage said *"this thing is stressing me out."* That
   stage had a ranking list, then a table per college with every round, dates, the early-round advantage, the share
   of the class filled early, demonstrated interest, standing, money, a three-question checklist for binding rounds,
   and a conflict list. What the plan actually needs from the student is *which round they're considering*, and the
   screen before it (the Dream) already gives a starting point: a Dream that offers ED should start as ED.
3. **Force-ranking the list was universally hated**, and isn't needed. The Dream says what the ranking was for.
4. **Start with the student's numbers** and use them to fill in Reach / Target / Likely. Let the student change any
   of it, but don't make them do the sorting.
5. **SAT and ACT are crowding things out.** Students take one test and work to raise it. Ask which one, say where the
   score stands at each college, encourage a retake only when a realistic gain would move a college up a group, and
   show the test dates when they're wanted.
6. **Parents want a schedule**: a calendar or timeline, color-coded, that pops, with an easy switch between children.

## Research (2026-10-09)
- **What the leading tools ask first.** Naviance, Scoir, CollegeVine, Niche, and Cialfo all start from an academic
  snapshot (GPA and one test score; Scoir falls back to the PSAT), then the list, then a round per college, then
  deadlines. Every one classifies automatically. Scoir is the clearest about letting the student or counselor
  override a label, and it shows which labels are automatic. Common App's "My Colleges" asks for each college's
  admission plan (ED, EA, REA, RD) when the college is added, one question per college, no ranking. Nobody asks
  for a ranked list.
- **Counselor rules for the groups.** A score below the 25th percentile of enrolled students is a reach, inside the
  middle 50% a target, above the 75th likely (Compass Prep, College Transitions). A low admit rate caps the group
  for everyone; the cutoff varies (15%, 20% at CollegeVine, 25% in some guides), and Quad's
  [chances-and-fit.md](../../product/chances-and-fit.md) already uses 20%. Balance: BigFuture's minimum is 3 / 2 / 1;
  CollegeVine 2–3 reach, 4–5 target, 2–3 likely; counselors commonly say 8–12 colleges with at least two likely
  colleges the student would happily attend.
- **Stress.** Princeton Review's College Hopes & Worries survey: 73% of applicants and parents reported high or very
  high stress in both 2025 and 2026 (56% in 2003). The top 2026 worry was cost (37%), ahead of admission (29%). No
  peer-reviewed study measures anxiety from chancing tools, but admissions officers warn of "false hopes and undue
  dismay." Nielsen Norman's progressive disclosure: put the few things most people need on the first screen and move
  the rest one step away. Harvard's Making Caring Common ("Turning the Tide") asks colleges and families to reduce
  achievement pressure. Kaplan's survey of admissions officers: parents are most helpful with deadlines, visits, and
  aid paperwork.
- **One test, retaken.** Older data put the share taking both tests at roughly a quarter; most take one. ACT: 57% of
  retesters raise their composite, typically by about a point (2 among those who improve, in Tennessee's 2024 senior
  retest); ACT says students take it two to three times on average. SAT: secondary sources put the average retake
  gain at about 40–60 points (no primary College Board figure found). Most colleges superscore. The 2018 ACT/SAT
  concordance (about 589,000 students who took both) maps one test onto the other; no update exists yet for the
  digital SAT or the enhanced ACT.
- **Early rounds.** Nov 1 is the most common early deadline, then Nov 15; ED II is usually due Jan 1 or Jan 15 and
  answers in mid-February. One ED at a time; REA rules out early rounds at other private colleges. Counselors say
  ED is for a clear first choice *and* only after the family has run the net price calculator, since the only release
  from ED is aid that makes attending impossible. An antitrust suit over ED (*D'Amico v. COFHE*) survived dismissal
  in August 2026, so ED rules may change in later cycles.
- **Parents and several children.** Naviance has a "Switch Child" menu, PowerSchool puts each child's name as a tab in
  the header, and Scoir links one parent account to several students. Spreadsheet and Notion trackers families
  build themselves color rows by days remaining and add a calendar view. What's missing everywhere is one calendar
  across children.

## Design principles
1. **One question per screen, and we answer the rest.** The student gives three numbers and marks a Dream; the site
   fills in groups and rounds, marked as suggestions, each changeable with one tap.
2. **The list is the plan.** One row per college: Dream, group, round, deadline. Everything else (reasons, admit
   rates, early-round statistics, interest) is one tap away or stays on the college's profile.
3. **Say it when it matters, then stop.** A conflict, a retake suggestion, an ED II idea: each appears only when it
   is true and actionable, as one sentence with one button.
4. **Encourage, don't grade.** "In or above the middle 50% at 6 of 8 colleges" before anything else. No
   probabilities, no "behind," no red for being a Reach.
5. **Parents see time.** The parent's default view is a calendar across their children; the list is one tab away.
6. **Same rules everywhere.** The groups, rounds, and suggestions come from pure functions
   (`lib/planner/standing.ts`, `lib/planner/auto-rounds.ts`) that the Plan page, the hub, the iPhone API, and the
   preview all call.

## The parts
| Part | Spec | What changes | Complexity |
|---|---|---|---|
| 1 | [page.md](page.md) | **Plan** in the top navigation; `/plan` for students and parents; three tabs (Colleges, Scores, Calendar) replace the six-stage strip; the child switcher | Medium |
| 2 | [standing.md](standing.md) | Numbers first: GPA plus **one** test; the standing model that sorts the list automatically, with the student's own choice kept | Medium |
| 3 | [list.md](list.md) | The list as the plan: Dream, group, round, deadline per row; reasons behind ⓘ; the balance line; the ranking removed | Small |
| 4 | [rounds.md](rounds.md) | Starting rounds from the Dream; no ranking, no proposal table, no checklist; one-line conflicts; ED II as an offer; the cost check as a parent task | Medium |
| 5 | [scores.md](scores.md) | Where the score stands, send or don't, and a retake suggestion only when a realistic gain moves a college up, with the test dates that land in time | Medium |
| 6 | [calendar.md](calendar.md) | The family calendar: a color-coded timeline of the school year per child or for everyone, "Coming up" as a list, calendar feed and print | Medium |

## What stays, what goes
| Built in PR #103 | In the redesign |
|---|---|
| The six-stage strip (List, Rounds, Actions, Timeline, Apply, Offers) | **Gone.** Three tabs: Colleges, Scores, Calendar. The stage machine (`stage.ts`) stays as internal state for the hub caption, reminders, and which tab opens |
| Stage 1 list with suggested category beside the student's chip | The suggestion **is** the group until the student changes it ([standing.md](standing.md#suggested-until-changed)) |
| `PriorityList` (rank the list) and `list_items.priority` | **Gone** from the UI; the column is left unused, then dropped in a later migration |
| `RoundsTable`, the proposal, `bindingChecklist`, "Use this plan" | **Gone.** A round chip per row, started from the Dream ([rounds.md](rounds.md)); `lists.rounds_plan_accepted_at` no longer read |
| Early-round advantage, class filled early, interest per college | Off the plan; on the college's profile ([early-decision-strategy.md](../../product/early-decision-strategy.md)) |
| SAT/ACT dates as tasks for everyone with `plans_tests` | Only for the student's own test, and only while testing or when a retake would help ([scores.md](scores.md#test-dates)) |
| Actions stage (follow, request information, visits) | A section in each college's row drawer ("Show interest"), not a stage |
| Applications stage | The row's status chip once the season starts, plus the drawer's requirements |
| Offers stage | A fourth tab, **Offers**, that appears when the first decision is recorded |
| Timeline month and college views | Replaced by the calendar ([calendar.md](calendar.md)); the generated tasks, cycle file, calendar feed, and reminders all stay |
| Parents: summary line, nudges, Your part, stuck signals, weekly email | All stay; the summary line moves into the child switcher, and Your part reads from the calendar's money and parent lanes |

## Build order
```
standing ──► list ──► rounds ──► scores
    │                   │
page (nav, /plan, tabs, switcher) ──► calendar
```
`standing` first: the numbers form and the model are what every other part reads. `page` can go in parallel (it is
mostly routing and the frame). The list and rounds are small once standing exists. Scores needs the model's
"score to move up". The calendar needs rounds (its bars follow the chosen round) and the page's switcher. Build with
the `build-roadmap-section` skill, one unit per part.

## Shared rules
In addition to the planner's [shared rules](../README.md#shared-rules):
- **A suggestion is labeled as one** (a ✦ on the chip) until the student changes it; once changed, it is theirs and a
  later change of numbers never overwrites it. "Use the suggestion" puts it back.
- **No admit rates, percentages, or statistics on the plan's first screen.** The college's profile is where those
  live; the plan links to it.
- **Every date still names its source and edition** (ⓘ on each date), and a test date links to the official page.
- **One test per student** in the plan. A student who has both scores picks the one they're working on; the other
  stays in their numbers but isn't used.
- **Nothing here is a verdict**: groups are a classification with published rules, the retake suggestion says how
  many points and which colleges, never "you should."

## Owner decisions needed
1. **Phone tab bar.** Today: Home, Explore, Search, Compare, More. Proposal: Explore, Search, **Plan**, Compare, More
   (Home is the logo). Alternative: keep Home and move Compare under More ([page.md](page.md#navigation)).
2. **Signed-out Plan.** Proposal: `/plan` signed out is a short pitch plus the numbers step; a visitor can enter
   numbers and add colleges (kept in the browser like the signed-out profile today) and is asked to sign up to save,
   share with a parent, and get reminders ([page.md](page.md#signed-out)).
3. **Retake threshold.** Proposal: suggest another test when 60 SAT points or 2 ACT points would move a college up a
   group ([scores.md](scores.md#when-to-suggest-another-test)). Lower is more cautious; higher suggests more retakes.
