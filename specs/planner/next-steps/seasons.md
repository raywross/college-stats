# Part 1, Seasons: The Playbook and the Next Steps Tab

> Status: **built** 2026-10-14 (feature/next-steps, PR #160). After the built planner ([../redesign/page.md](../redesign/page.md),
> [../timeline.md](../timeline.md), [../parents.md](../parents.md)). Part 1 of [next steps](README.md); every other part
> adds moves to the playbook defined here.

## Goal
Open the plan and know what to do this season, why, and in what order, whether the student is a freshman or a senior
in December. The season comes from the graduation year, so the same sophomore sees the same three things in October
whether they signed up in August or yesterday.

## The season
`seasonOf(gradYear, today)` in `lib/planner/seasons.ts` (pure), replacing the planner's `gradeOf()` boundaries with one
set the whole plan uses. The school year turns on **August 1** (the cycle's start, `currentCycle` in `lib/planner/cycle.ts`;
`gradeOf`'s September start for senior fall goes away). With S = gradYear − 1 (the senior year's calendar start):

| Season | Months | Grade |
|---|---|---|
| `freshman` | Aug of S−3 → Jul of S−2 | 9 |
| `sophomore` | Aug of S−2 → Jul of S−1 | 10 |
| `junior_fall` | Aug–Dec of S−1 | 11 |
| `junior_winter` | Jan–Feb of S | 11 |
| `junior_spring` | Mar–May of S | 11 |
| `summer_before_senior` | Jun–Jul of S | rising 12 |
| `senior_fall` | Aug–Dec of S | 12 |
| `senior_winter` | Jan–Feb of S+1 | 12 |
| `senior_spring` | Mar–May of S+1 | 12 |
| `summer_after` | Jun–Jul of S+1 | graduated |
| `graduated` | after | |
| `unknown` | no graduation year | |

`gradeOf()` becomes a thin map over `seasonOf()` for the callers that still read it (the hub caption, `roundsPicked`,
the folds), so there is one boundary. A plan with no graduation year has one move: the intake's "Class of" step.

## Moves
A **move** is a `plan_tasks` row ([../model.md](../model.md#tables)) with a home on the Next steps tab. The table
already has a key, kind, title, detail, due date or window, assignee, source, done, snoozed and dismissed; moves add:
- `season` (text, the season the move belongs to; a dated move's season is the season its date falls in).
- `action` (jsonb: `{ href }` or `{ kind: "mark_applied" | "set_round" | "open_intake" | … , args }`), what the card's
  one button does.
- New `kind` values per part (the check in `plan_task_kinds` is widened; each part lists its kinds), and a new
  `source: 'season'` for the playbook's own entries.

Generation stays in `generateTasks()`: a fifth generator, `season`, reads the playbook below and emits this season's
and next season's entries that apply (the `applies` vocabulary of the cycle file, extended with `has_dream`,
`list_empty`, `profile_missing:{section}`, `story_missing`, `no_visit_logged`, `ed_candidate`, `interest_candidate`,
`shape_gap`). Each part's rule set contributes through the same call. Regeneration is idempotent on `key`.

**What a late joiner sees.** Only the current season's moves and next season's preview are generated. A move from an
earlier season is generated now only if it is still true and still matters (its playbook row says `carries: true`):
no Likely on the list in senior fall carries; "take the PSAT" in junior fall does not. Nothing is ever shown as overdue
from before the person joined (the built 30-day rule for cycle entries stays).

## The playbook
One table per season: the move, who it belongs to, its source, the action, and whether it carries forward. Wording is
the catalog's (`lib/planner/moves-catalog.ts`, tested for no numbers from the estimate). "Advisors" cites the
consensus in [README.md](README.md#research-2026-10-13); a college fact cites its field and edition.

### Freshman and sophomore
Few moves, none dated except the PSAT. The tab leads with "This year is for trying things."
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Fill in your numbers and courses | student | profile progress (`lib/planner/profile-progress.ts`) | open the intake on the first missing step | yes |
| Plan next year's courses (Feb–Apr) | student | [course plan](../../chances/course-plan.md), the `choose_courses` window | the course-plan card, re-homed here (its UI was removed 2026-10-12) | no |
| Add the activities you've started; pick one or two to go deeper in | student | [depth](../../chances/depth.md) reading "Sampling" or none | the activities intake step, with depth's prompt as the why | yes |
| PSAT in October (practice this year) | student | the cycle file | the official page | no |
| Start a long list: places that interest you, no sorting yet | student | list empty | the add-college box | yes |
| Visit a campus when you travel; any campus | student + parent | advisors | the visit page of the nearest listed college, else Explore by distance | no |
| Talk about what you can pay, privately | parent | advisors (Selingo, College Coach) | the Numbers page's cost limit (`preferences.maxAverageCost`) with a one-paragraph why | yes |

### Junior fall (Aug–Dec)
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| PSAT/NMSQT in October | student | cycle file (`psat`) | official page | no |
| Pick your test and a first date | student | `tests.focus` null | the intake's test step; the first SAT/ACT dates that land before June ([../redesign/scores.md](../redesign/scores.md)) | yes |
| Build the list toward 15–20 to visit and cut | student | [list-shape.md](list-shape.md) junior shape | add-college, with the rail | yes |
| Visit over fall break | student + parent | advisors; [interest-and-visits.md](interest-and-visits.md) | the first interest/visit move | no |
| Notice two teachers you'd ask to write for you | student | advisors | a note move (free text on the task) | yes |
| Write your story (three prompts) | student | [your-story.md](your-story.md) | the prompts | yes |
| Run the net price calculator at three colleges on the list | parent | advisors (before the list is final); `links.price_calculator` | the calculators, with the cost limit beside them | yes |

### Junior winter (Jan–Feb)
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Register for a spring SAT/ACT | student | cycle file (`test_register`) | official page | no |
| Choose senior-year courses | student | course plan window | the course-plan card | no |
| Set the family's walk-away number | parent | advisors; profile cost limit | Numbers page | yes |
| Create your FSA IDs (both of you) | parent + student | cycle file (`fsa_id`) | studentaid.gov | yes |
| Apply to a summer program by its deadline | student | advisors (optional, undated) | none; informational | no |

### Junior spring (Mar–May)
The season advisors call pivotal; the tab leads with the list and the first ED pills ([ed-opportunities.md](ed-opportunities.md#moves-and-timing)).
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Take the SAT/ACT | student | cycle file | official page | no |
| Visit over spring break; go to the admitted-students-style open days where interest counts | student + parent | interest-and-visits | the visit moves | no |
| Ask two teachers before summer | student | cycle window `ask_recommenders` | a tick | yes |
| Fill in the counselor's brag sheet; your story helps | student | advisors; your-story | the prompts | yes |
| Get the list to shape | student | list-shape (junior shape by May) | the gap move | yes |
| Add a Likely you'd be happy at, and one you can afford | student + parent | list-shape | the rail at Likely/Safe | yes |
| Check the cost of the ED candidates together | parent | ed-opportunities; `cost_check` | calculators | yes |

### Summer before senior year (Jun–Jul)
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Write your essays (the personal essay first; college prompts arrive by August) | student | the essays move ([essays/moves.md](../../product/essays/moves.md)) | open the Essays tab | yes |
| Final list: 12–15 | student | list-shape senior shape | gap moves | yes |
| Decide on ED (due Nov 1 or 15) | student + parent | ed-opportunities `ed_decide` | the ED sheet | yes |
| Retake if a realistic gain would move a college up | student | scores coach | test dates | no |
| Review the list's cost together | parent | shape's affordability check | calculators / estimate | yes |

### Senior fall (Aug–Dec)
Dated moves lead; the applying moves are in [applying.md](applying.md).
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Common App opens Aug 1: set it up and send recommender invitations | student | cycle file | commonapp.org | no |
| Submit each early college by its deadline | student | college dates (built `apply` tasks) | Mark applied | n/a |
| FAFSA and CSS Profile from Oct 1 | parent | cycle file (built) | studentaid.gov / cssprofile | yes |
| Show interest at the colleges where it counts, if you haven't | student | interest-and-visits | one-tap options | no |
| Last test date for early rounds (October) | student | scores coach | official page | no |
| Review before they submit; don't write | parent | advisors (NACAC) | a tick on each submit move's parent lane | no |
| Finish each college's essays (earliest deadline first) | student | the essays move ([essays/moves.md](../../product/essays/moves.md)) | open the Essays tab | n/a |

### Senior winter (Jan–Feb)
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Record each early decision as it arrives | student | applying | outcome picker | n/a |
| ED II at {College}, if {ED college} said no (due Jan 1–15) | student + parent | ed-opportunities, after a deferral or denial | set round | n/a |
| Submit the regular-decision colleges | student | built apply tasks | Mark applied | n/a |
| Ask for the mid-year transcript | student | cycle file | tick | no |
| Scholarship and aid deadlines by college | parent | built `aid_forms` | per college | n/a |

### Senior spring (Mar–May)
| Move | Who | Source | Action | Carries |
|---|---|---|---|---|
| Record each decision | student | applying | outcome picker | n/a |
| Compare the offers | parent + student | [../offers.md](../offers.md) | Offers tab | n/a |
| Decide by May 1; deposit; withdraw the others | student + parent | built `deposit`/`withdraw` | the choice | n/a |
| Tell us where you landed | student | applying (outcome share) | one tap | n/a |
| Keep the grades up (offers can be withdrawn) | student | advisors | informational | no |

### Summer after
The built summer list ([../offers.md](../offers.md#after-the-choice)): final transcript, orientation, housing, health
forms, AP scores to the college.

## The Next steps tab
`PlanTab` gains `"next"`, labelled **Next steps**, first in the strip and the default for students and guardians
(`defaultTab()` in `lib/planner/plan-tabs.ts`; `?tab=next`). Icon `Footprints`. Layout, phone and desktop alike:

```
Junior spring · Class of 2028                          [How this season works]
┌─────────────────────────────────────────────────────────────────────┐
│ Ask two teachers before summer                          by Jun 10   │
│ While they remember your work. Advisors place this in junior spring.│
│ [Done]  [Not now]                                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Good ED opportunity: Wake Forest                      Target for you│
│ Wake Forest reports an early round that would move it… [See why]    │
├─────────────────────────────────────────────────────────────────────┤
│ Add a Likely you'd be happy at                        2 of 2 missing │
│ Your list has 3 Reaches and 2 Targets and no Likely yet. [Show some]│
└─────────────────────────────────────────────────────────────────────┘
More this season (3) ▸     Coming up: summer before senior year (4) ▸     Done (6) ▸
```

- **Now**: at most six cards, ordered: overdue dated moves (warning color, as the calendar does), dated moves within
  14 days, ED decide moves inside their window, then the playbook's own order for the season. A card is the move's
  title, its why (one or two lines, the college fact cited with ⓘ), the date or "this season", the assignee chip when
  it isn't the viewer ("Mom", "Maya"), and one button plus **Not now** (skip, remembered; the brief never resurfaces a
  skipped move). Done folds the card with a check and a short line; undo for a minute.
- **More this season**: the rest, folded, same cards.
- **Coming up**: next season's playbook as titles only, so a family sees what's ahead without being asked to do it.
- **Done**: a count, expanding to the season's finished moves.
- **Header**: the season in words and the class year; **How this season works** opens a sheet with the season's
  playbook as a paragraph (the catalog's `seasonExplainer`), and for juniors and seniors a line on what counts next
  season. No progress bar, no count of what's undone.
- **Nothing to do**: "Nothing to do this season. Enjoy it." with Coming up open.
- **A parent** sees the child's cards (ticking them only with edit access, attributed as any edit) and, first, a
  **Your part** group: their own moves for this child (`assignee: guardian | either`), reusing `yourPart()` from
  `lib/planner/summary.ts`. A parent with several children picks one through the people line as today.
- **The people line's "Next:"** is the Now list's first card for that child (today it is the first missing profile
  section; those become freshman/sophomore moves, so the ring keeps its meaning and the step gains a season). Tapping it
  opens the tab scrolled to the card.
- **Colleges and Calendar** are unchanged except for the pills ([ed-opportunities.md](ed-opportunities.md),
  [interest-and-visits.md](interest-and-visits.md)) and the balance notice reading the shape ([list-shape.md](list-shape.md)).

## Rules
- A move's why is a fact or an advisor placement, never "you should". A dated move names its source and edition.
- No red for being late with an undated move; only a dated move can be overdue.
- Moves generate for the student the plan is about; a guardian's own moves generate once per guardian per child.
- The `season` generator never ticks a move; the actions do (marking applied ticks the submit move; setting a round
  ticks the decide move; a logged visit ticks the visit move).
- Telemetry: `plan_move_shown {kind, season}`, `plan_move_done {kind, season, by: student|guardian}`,
  `plan_move_skipped {kind, season}`, `plan_season_explainer_opened {season}`.

## Files (planned)
`lib/planner/seasons.ts` (`seasonOf`, `SEASON_LABELS`, `seasonBounds`, `gradeOf` shim), `lib/planner/moves-catalog.ts`
(titles, whys, `seasonExplainer`; a test fails on a percentage, multiple, or odds), `lib/planner/generators/season.ts`,
`lib/planner/moves.ts` (`nowMoves`, `foldMoves`, the ordering), `components/planner/NextSteps.tsx`, `MoveCard.tsx`,
`SeasonExplainer.tsx`, the course-plan card re-homed (`components/planner/NextYearCard.tsx`, restored), changes to
`plan-tabs.ts`, `PlanTabs.tsx`, `PlanPeople.tsx` (Next:), migration `plan_tasks.season`, `plan_tasks.action`, the
widened kind check and `source = 'season'`. Tests: `tests/planner-seasons.test.mts` (every boundary month, late joiners
in each season, carries, the Now order, nothing overdue before the join date, the parent's Your part).

## Open questions
1. Should Coming up show dates for next season's dated moves (the test date, Nov 1)? Recommendation: yes for dated
   ones, titles only for the rest.
2. A student with two guardians: do both get the parent moves? Recommendation: yes, each on their own page; a tick by
   either closes it for both, attributed.
