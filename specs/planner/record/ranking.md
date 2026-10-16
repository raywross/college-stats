# Part 3, Importance Ranking: Which Three Show

> Status: **built** 2026-10-16 (PR #165). Replaces Now's buckets ([../v3/now.md](../v3/now.md#ranking)); the season gate, the
> cap of three, Done and Skip are unchanged. Part 3 of [Your record](README.md). The owner: "Something like 'Reach your
> score' would show up if they haven't reached their test target. It should be weighed against the other things we'd
> show. Come up with an importance ranking system on the different things we recommend, build a spec, and show me the
> rankings. If there's five things in the next few weeks we'd take the three with the highest. As they close them out
> we'd add the others."

## The rule
Every open move that passes the season gate gets an **importance** from 0 to 100:

```
importance = clamp(base(kind or key, season) + timing(date, today) − carried, 0, 100)
```
- **base**: the table below, by the move's kind (or its playbook or cycle key), sometimes by the season it shows in.
- **timing**: a dated move's urgency: overdue **+30**; due within 7 days **+20**; within 14 days **+10**; within 30 days
  **+5**; later or undated **0**. A window dates by its end (`taskDate`).
- **carried**: **−10** when the move's season is earlier than the current one (a carried move from a past season yields
  to this season's).
- Ties: dated before undated, then the catalog's order, then title.

Now shows the **three** highest; `importance` is stored nowhere and never shown. A move with base 0 in a season is
not shown there at all (the season tables already keep most of these away; the base makes the rule explicit for the
few that span seasons, like the story).

## The table
The base importance by what the move is for, highest first. "Rises" means the base changes with the season, as listed.

| Importance | Move (kind or key) | Why this high | Seasons |
|---|---|---|---|
| 100 | `class_year` (no graduation year) | Nothing else works without it | always |
| 100 | `apply` / `submit` (a college's application in its chosen round), `deposit`, `decide_by` | Hard deadlines with consequences | as dated |
| 95 | `ed_decide` in its window, `ed2_decide` | A binding choice with a date | summer before senior year, senior fall/winter |
| 92 | `test_register` (a picked date's registration deadline) | Missing it loses the test date | as dated |
| 90 | `decision_expected` (record the decision), `confirm_complete`, `ed2_conditional`, `continued_interest`, `waitlist_accept`, `waitlist_decide` | The application's loose ends | senior winter/spring |
| 88 | `test_day` | The day itself | as dated |
| 85 | `compare_offers` | The money decision before May 1 | senior spring |
| 85 | the record's **grades** (`profile` entry when grades are the missing section) | The estimate reads nothing without a GPA and class year | always |
| 80 | the record's **test** (score or target, or "not testing") | The estimate's second input | always |
| 78 | `personal_essay_draft` (cycle) | The summer's main work | summer before senior year |
| 75 | the record's **AP courses** | Rigor is read from them | always |
| 75 | `register_spring_test` (junior winter), `pick_test` (junior fall) | A test date before applications | junior fall/winter |
| 75 | `shape_gap:likely_min` (no Likely or Safe you'd attend) | The list's one must-have | junior spring on |
| 75 | `recommendation` tasks (invite each recommender), `supplement`, `transcript`, `send_scores`, `fee`, `portal_setup`, `portal_check` | Pieces of a dated application | senior fall |
| 72 | `reach_score` (under the target) | The owner's example: study and the next date, while there's time | junior fall → senior fall; **0** once no test date's scores would arrive before the earliest deadline |
| 70 | `choose_courses` (any year's course choice) | Inside its February–April window only | **0** outside the window |
| 70 | `story` | The summer's writing | **0** before summer before senior year; 70 summer before senior year; 65 senior fall |
| 68 | `pick_recommenders`, `ask_recommenders` (cycle) | Ask before teachers are swamped | **0** before summer before senior year; 68 summer; 75 senior fall (Common App invitations) |
| 65 | `build_list` / `long_list` ("Add a few Reach schools"), `shape_gap:target_min` | The list takes shape | junior fall on; 55 freshman/sophomore |
| 65 | `mid_year_transcript`, `thank_recommenders` | Senior-year housekeeping | senior winter |
| 60 | `visit_ed` (visit an ED candidate) | Binding decisions deserve a visit | junior fall on |
| 60 | the record's **high school** | Unlocks the school's own data | always |
| 58 | `shape_gap:reach_min` ("Add a Reach school") | Room for ambition | senior fall on |
| 55 | `show_interest` where the college says interest is important or very important | A fact the college states | junior fall on |
| 55 | `spring_break_visit`, `fall_break_visit` | Advisors' visiting seasons | their season |
| 55 | the record's **activities** (clubs, sports, work, other) | Depth is read from them | always |
| 52 | `psat_nmsqt` (junior October) | The one that counts for National Merit | junior fall; 40 for the practice years |
| 50 | the record's **major** | Unlocks "like your list" and majors and earnings | always; 60 from junior spring |
| 50 | `brag_sheet` | Feeds the counselor's letter | junior spring |
| 48 | `show_interest` where interest is considered | Weaker signal | junior spring on |
| 45 | `shape_gap:over_max` ("Review the list"), `shape_gap:total_off` | Informational | senior |
| 45 | the record's **connections**, **basics**, **where you'd go** | Useful, not urgent | always |
| 40 | `outcome_share` | A favor to the next class | senior spring |
| 40 | `visit_travel` (early years) | A walk on any campus | freshman/sophomore |
| 35 | `summer_program` | Optional | junior winter |
| 30 | `review_before_submit` (a parent's) | The parent's lane | senior fall |
| 20 | `keep_grades` | Informational | senior spring |
| 0 | the financial moves (`aid_forms`, `cost_check`, `shape_cost`, `money_talk`, `net_price`, `walk_away`, `fsa_ids`, `list_cost`, FAFSA/CSS) | Hidden for now (owner, 2026-10-15) | |
| 0 | `follow`, `request_info`, `write_visit_notes` (the old per-college to-dos) | Not moves | |

A kind not in the table gets **50**. The table lives in code as `MOVE_IMPORTANCE` (`lib/planner/importance.ts`), one
entry per row, with the season rules as small functions; the spec and the code are kept in step by a test that lists
every `TaskKind` and playbook key and asserts each has an entry or the default on purpose.

## Worked example
A junior in October with a real SAT below their target, a list of five Reaches, no clubs entered, no major, and the
PSAT entry: eligible moves and their importance:

| Move | base | timing | carried | importance |
|---|---|---|---|---|
| Add your clubs (record: activities) | 55 | 0 | −10 (freshman entry carried) | 45 |
| Work toward your 1450 (`reach_score_junior_fall`) | 72 | 0 | 0 | **72** |
| Add a few Likely schools (`build_list`) | 65 | 0 | 0 | **65** |
| PSAT/NMSQT in October (window ends Oct 31, 15 days away) | 52 | +5 | 0 | 57 |
| Pick your test and a first date (`pick_test`, but a test is picked) | — | | | not eligible |
| Add a major (record) | 50 | 0 | −10 | 40 |
| Show Elon you're interested (`show_interest`, important) | 55 | 0 | 0 | 55 |

Now shows **Work toward your 1450**, **Add a few Likely schools**, and **PSAT/NMSQT in October**; when the PSAT window
passes, **Show Elon you're interested** takes its place, then **Add your clubs**. Two weeks before an SAT registration
deadline the student picked, that `test_register` task (92 + 10) jumps to the top.

## Timing rules moved here
- **Your story**: base 0 before `summer_before_senior` (the entry's season moves from `junior_fall` to
  `summer_before_senior`; it carries into senior fall). The guide stays reachable from the record any time.
- **Pick your recommenders**: the entry's season moves from `junior_spring` to `summer_before_senior`; base 68 there, 75
  in senior fall. (The owner, 2026-10-16: "it probably doesn't need to be filled out until the summer before senior year;
  same thing with pick your recommenders.") The cycle's `ask_recommenders` window (April 15–June 10) stays as data but
  its move gets base 0 before summer, so it doesn't contradict.
- **Choose next year's courses**: 70 inside the February–April window, 0 outside (the guide stays reachable from the
  record's Courses row).
- **Reach your score**: 0 once no remaining test date's scores would arrive before the earliest listed deadline
  (`datesFor` returns none), so a senior in November isn't told to study for a test that can't count.

## Rules
- Importance never shows: not on a card, not in telemetry beyond `plan_move_shown {kind, season, rank}` (the position 1–3).
- A parent sees the same three (the owner, 2026-10-16: parents see what the student sees).
- Skipped moves are out of the ranking until brought back; Done moves are out.
- The season gate ([../v3/now.md](../v3/now.md#ranking)) runs first; importance orders what passes it.

## Files
`lib/planner/importance.ts` (pure: `MOVE_IMPORTANCE`, `baseImportance(task, season, facts)`, `timingBoost(task, today)`,
`importance(task, opts)`, `compareByImportance`), `lib/planner/importance-facts.ts` (new, pure: `importanceFactsFrom`),
`lib/planner/moves.ts` (`nowMoves` sorts by `importance` desc with the tie rules; the buckets go),
`lib/planner/moves-catalog.ts` (the story and recommenders entries' seasons), `lib/planner/generators/season.ts`
(`reach_score`'s "no date would count" check uses `datesFor`), `lib/analytics.ts` (`plan_move_shown.rank`). Tests:
`tests/planner-importance.test.mts` (every kind has an entry or the default on purpose; the worked example above
reproduces; the timing boosts; the season-zero rules; three highest win; closing one surfaces the fourth).

## Open questions (answered)
1. Should a parent's own moves (Your part) rank in the same list? Recommendation: no; they stay a separate short list
   above, hidden while the financial moves are hidden.
   **Adopted: Your part stays separate.**
2. Should "Add your clubs" ever outrank the list? With these numbers a bare record (no grades) does, as it should; an
   activities gap doesn't. Recommendation: as written; revisit after a month of `plan_move_shown`.
   **Built and monitored via telemetry.**

## As built by R1b–R2
- `MOVE_IMPORTANCE` table defines base importance by kind, playbook key, cycle key, or shape-gap variant
- `baseImportance` applies season-varying rules first (story, pick_recommenders, choose_courses, reach_score), then the table
- `timingBoost` adds 30/20/10/5 for overdue/within-7d/14d/30d
- `importance(task, facts)` = clamp(base + timing − carried, 0, 100), never shown to users
- Moves with importance 0 in a season are filtered out before the top three are ranked
- Story and pick_recommenders now show from `summer_before_senior` onward (moved from earlier seasons)
- Catalog entries' seasons updated; explainer paragraphs adjusted for story timing
- `plan_move_shown` tracks rank (1–3 for Now, null for Your part or outside Now)
