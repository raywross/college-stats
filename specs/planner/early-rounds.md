# Stage 2, Priorities and Rounds: Who Gets the Early Application

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u3-on-featureplanner-rounds)); planned 2026-10-07. After [model.md](model.md), [list-building.md](list-building.md), and
> [early-decision-strategy.md](../product/early-decision-strategy.md) (the per-college early-round measures). Better
> with [net-price-estimator.md](../product/net-price-estimator.md) (the money question) and
> [chances-and-fit.md](../product/chances-and-fit.md) (standing). Part of the [planner](README.md).

## Goal
A student may apply **early decision** to one college (binding), **early decision II** to one more if the first says
no, **restrictive early action** to one college that then limits the others, and **early action** to as many as
offer it. Which college gets which is the most consequential decision of the fall, and most families make it from a
blog post. This stage lays out, per college, what rounds exist and when, what the early round did for applicants
last year, what the rounds rule out, and what a binding offer would cost this family, then proposes a plan the
student edits. The output is a `round` on every list item, which the timeline turns into dates.

## Research (2026-10-07)
- **Availability and dates** are in the Common Data Set: C21 (ED offered, first and second round closing and
  notification dates, ED applicants and admits), C22 (EA offered, restrictive or not, dates), stored per edition
  ([cds-admissions.md](../data-expansion/cds-admissions.md#store)). The template has no EA admit counts.
- **The advantage.** Class of 2030 ED rates were two to six times the regular rate at selective colleges (Brown 14.8%
  vs 3.5%; Dartmouth 4.6×; Vanderbilt ~14% vs ~3%; Duke ~13% vs ~3.4%; Northwestern ~20% vs ~6.5%). ED II is
  smaller but real: Washington University 27% across both binding rounds vs 9.3% outside them; Vanderbilt's ED II
  around 18–22%. Sources: the colleges' announcements as compiled by IvyWise, Oriel Admissions, and College
  Transitions; the site will use the CDS counts where published and a class profile where not
  ([early-decision-strategy.md](../product/early-decision-strategy.md#data)).
- **ED II exists at about 30 colleges** (among them Vanderbilt, NYU, WashU, Emory, Tufts, Bowdoin, Carnegie Mellon,
  Chicago, Boston College, Wesleyan, Pomona, Swarthmore), with January 1–15 deadlines and mid-February decisions,
  after ED I decisions in mid-December. A student deferred or denied in ED I is released from the commitment and may
  apply ED II elsewhere. Brown, Cornell, Dartmouth, Penn, Duke, and Northwestern have a single ED round; Harvard,
  Princeton, Yale, Stanford, and MIT have restrictive or single-choice early action and no ED.
- **Restrictive early action rules differ by college** (most allow early applications to public universities and to
  colleges with non-binding rolling admission; some allow other EA; all forbid ED elsewhere). The CDS only says
  "restrictive: yes/no", so the site states the general rule, links the college's own page, and asks the student to
  confirm what that college allows.
- **The money.** An ED admit can't compare offers. The accepted practice is that a student may be released from an
  ED commitment when the aid offer makes attendance impossible, but families shouldn't plan on it. The site's
  estimator gives a range per college from the guardian's inputs; where no estimate exists, the college's own net
  price calculator link is the fallback (every college has one, `school.links.price_calculator`).
- **What the hooked-pool caveat means here.** Recruited athletes, legacies, and other hooked applicants are
  concentrated in ED pools, so the advantage overstates what an unhooked applicant gains; the student's profile has
  optional hooks ([student-profile.md](../product/student-profile.md#fields)) that, when set, let the reason line say
  "legacy is considered here" and nothing more.

## Ranking
The stage opens with the list in **priority order**: the Dream first, then the student drags the rest into "where
I'd go if admitted everywhere" order (`list_items.priority`, keyboard-accessible, saved as they go). It takes a
minute and it is the input the proposal needs; without it the proposal uses the Dream and the category order and
says so. A parent with edit access can reorder; attribution shows ("Reordered by Dad"), and the student can put it back.

## The rounds table
One row per college, in priority order:

| Column | From | Shows |
|---|---|---|
| Rounds offered | C21/C22 | ED I · ED II · EA · REA · RD · Rolling as chips; a missing one is simply absent; "the college hasn't published its rounds" when the record is null |
| Dates | C21/C22, C14 | closing → notification for each round, each with ⓘ (edition) |
| Early advantage | [early-decision-strategy.md](../product/early-decision-strategy.md#data) | "ED admitted 24% vs 9% non-ED (CDS 2025–26) · 2.7×" or "ED offered; counts not published" |
| Share of class filled early | same | "about 48% of the class" |
| Interest considered | C7 | so a student knows an EA application is also a signal there |
| Your standing | chances, when built; else the suggested category | "Target" with the reason on hover; "Reach for everyone" under 20% |
| Money | the guardian's shared estimate ([net-price-estimator.md](../product/net-price-estimator.md)) | "Estimate $28–34K/yr, shared by Mom" · "No estimate yet: run the college's calculator" (link) |
| Round | the student's choice | a picker limited to the rounds offered |

## The proposal
`proposeRounds(items, schools, estimates, standing)` in `lib/planner/rounds.ts` (pure, tested) proposes a round for
every college. It is shown as a draft with **Use this plan** and per-row edits; nothing is written until the student
accepts, and every line carries its reason.

1. **ED I** goes to the highest-priority college that offers ED, **unless** it is the Dream's REA college (then no ED
   anywhere), or its standing is "Reach for everyone" *and* the student has a higher-priority college where it isn't
   (the proposal still allows ED at a Reach; it says "an early application doesn't turn a Reach into a Target" and
   lets the student decide).
2. **ED II** goes to the next college in priority that offers ED II and whose deadline is after the ED I college's
   notification date, as the fallback "if ED I says no or defers".
3. **REA / SCEA** goes to the Dream if it offers only that and nothing else early is binding; then every other
   private college's EA is flagged "check whether {College}'s restrictive early action allows this" and public
   universities' EA stays.
4. **EA** goes to every remaining college that offers it (there is no cost to applying early non-binding, and at
   colleges that consider interest it helps).
5. **Rolling** colleges get "apply early in the fall" with the priority date where one exists.
6. Everything else is **RD**.

The proposal then runs the three questions from [early-decision-strategy.md](../product/early-decision-strategy.md#display)
against the ED I and ED II choices and shows them as a checklist, not a verdict:
- *Is there a measurable advantage here?* The advantage line, or "counts not published".
- *Can the family afford to be bound?* Green with a shared estimate inside the family's limit; amber when the
  estimate is above it or unshared; red with "ED is binding; get an estimate or run the calculator before you decide",
  and the link.
- *Does it cost other options?* The conflicts below.

## Conflicts
Checked live as rounds change and shown as lines under the table; a plan with a red conflict can be saved (the
student may know something the data doesn't) but the strip's count says "1 conflict".
- Two colleges with `ed`; two with `ed2`; `ed` and `rea` together (red).
- `rea` plus a private college's `ea`, where the REA college's rules may forbid it (amber; link to the college).
- `ed2` whose deadline falls before the `ed` college's notification date (amber: "you'd have to decide before you
  hear from {ED college}").
- A round the college doesn't offer this cycle (red; happens after an import or a data change).
- An `ed` college with no shared estimate and an average cost above the family's limit (amber).

## What it writes
Accepting writes `round` on every item (the existing column), `priority`, and a `rounds_plan_accepted_at` on the
list so the strip knows the stage is done. The timeline regenerates the dated tasks for each college's round
([timeline.md](timeline.md#generators)): "Apply by Nov 1 (ED I)", "Decision Dec 15", and for the ED II college
"Apply by Jan 2 only if {ED college} isn't a yes (expected Dec 15)".

## Display
- **Stage panel**: the ranking (drag list) on top, collapsed once accepted; the rounds table; the proposal with its
  checklist and conflicts; Use this plan. A one-line summary when done: "ED I Michigan · ED II Tufts (if needed) ·
  EA at 3 · RD at 4".
- **Profile, "Applying early" section** ([early-decision-strategy.md](../product/early-decision-strategy.md#display)):
  for a signed-in student with this college on the list, a line "On your plan: EA" with a link to the stage.
- **Parent's view**: the same table and summary, read-only unless `can_edit`; the money column shows that guardian's
  own estimate and "shared" / "not shared" status.
- **Phones**: the table becomes a card per college with the chips, dates, and advantage; the proposal is a list.
- **Glossary**: `early-decision-ii`, `single-choice-early-action`, `binding`, plus the existing early-round terms.

## Rules
- No sentence recommends a college. The proposal's language is "goes to" and "because"; the student can change
  every line.
- The advantage is shown as a multiple of the non-ED rate ("2.7× the non-ED rate"), never as "your odds".
- Where the college publishes no ED counts, the row says so; the proposal still uses availability and priority.
- Dates come from the edition on record; when the cycle's edition isn't published yet (CDS files arrive in the
  spring and summer), the row says "2025–26 dates; the college hasn't published 2026–27" and the timeline marks those
  tasks "date from last cycle; confirm on the college's page", the same rule as
  [cycle-watch.md](../ideas/cycle-watch.md) proposes for changes.

## Files (planned)
`lib/planner/rounds.ts` (proposal, conflicts; pure), `components/planner/RoundsStage.tsx`, `PriorityList.tsx`,
`RoundsTable.tsx`, `tests/planner-rounds.test.mts` (a list with a Dream that offers ED; one whose Dream is REA-only;
an ED II whose deadline precedes the ED I decision; no estimates; an import with a round the college dropped),
glossary entries.

## Open questions
1. When the ED I college defers rather than denies, the student is released and may apply ED II elsewhere; should
   the plan treat "deferred" as triggering the ED II task automatically? Recommendation: yes; the outcome entry
   ([offers.md](offers.md#recording-decisions)) opens the ED II task with "you're no longer bound; ED II at {College}
   is due {date}".
2. Should the proposal consider merit aid (CDS H2A) as a reason to prefer EA or RD at a college over ED, since ED
   admits are thought to receive less merit? The evidence is anecdotal; recommendation: show the college's
   non-need award share in the money column with no inference.

## Built (2026-10-08, unit U3 on `feature/planner-rounds`)
- **`lib/early.ts`** (pure; the ED strategy spec reuses it): ED rate, non-ED rate (labeled "non-ED" when the college
  has EA, "regular" otherwise), the advantage as a multiple, share of class at an assumed 0.95 ED yield (stated in the
  line), the checks (ED admitted ≤ ED applicants ≤ total applicants, ED admitted ≤ total admitted; a failure blanks the
  measures and says the counts don't add up; over 8× the multiple is held for review), `advantageLine`,
  `classShareLine`, and `sameDocumentTotals` (C1 totals only from the ED counts' own document: the funnel when its
  lineage names the same file, else the residency grid of the same edition).
- **`lib/planner/rounds.ts`** (pure, runs on the server and in the browser): `isOffered` / `roundsOffered` (unknown
  stays pickable; REA is C22 with restrictive = yes), `roundDates` (month/day resolved against the student's cycle with
  `deadlineFor`'s rule, field and edition per date, `lastCycleNote`), `priorityOrder`, `standingFor`, `proposeRounds`
  (the six rules, a "goes to … because …" reason per line, the REA flag for private EA), `conflicts` (all seven rules,
  red or amber), `redConflictCount`, `bindingChecklist` (the three questions), `roundsSummary`.
- **Generator** `generators/rounds.ts`: one student-wide `decide_rounds` step 42 days before the earliest early
  deadline, in season, assigned to the student, carrying the deadline's field, edition, and last-cycle note.
  Accepting the plan ticks it.
- **UI**: `stages/RoundsStage.tsx` (server), `stages/PriorityList.tsx` (drag with the mouse, arrow keys on the handle,
  44px move buttons on phones; the Dream pinned first; "Reordered by {name}" with "Put it back"),
  `stages/RoundsTable.tsx` (one row per college, a card per college below `lg`; the checklist for each ED I / ED II;
  conflict lines; "Use this plan"; the summary line once accepted), `row/rounds.tsx` (the list row's picker limited to
  the rounds offered), `components/planner/OnYourPlan.tsx` in the profile's "Applying early" block.
- **Store** `lib/planner/store-rounds.ts`: `acceptRoundsPlan`, `setPriorityOrder`, `restorePriorityOrder`,
  `priorityAttribution`, `myPlanRound`.
- **Migration** `20261008133000_planner_rounds.sql`: `lists.priority_at`, `priority_by` (set by a trigger from the
  session), `priority_previous` (the order before, for "Put it back").
- **Glossary**: `early-decision-ii`, `single-choice-early-action`, `binding`.
- **Tests**: `tests/early.test.mts`, `tests/planner-rounds.test.mts` (the five fixtures, every conflict on and off,
  the generator, and the attribution trigger in PGlite with a guard that drops it).

Decisions and deviations:
- Standing is "Reach for everyone" under a 20% admit rate, else the list's own category (the suggested category from
  `suggest.ts` was being built alongside; `proposeRounds` takes standing as an input, so chances or the suggestion
  can replace it).
- Money: no estimator, so every binding choice's money question is red with the calculator link; the money column
  shows the college's average cost against the profile's max average cost. The "over the limit" conflict fires only
  when that limit is set.
- Rule 1's Reach clause: a Reach-for-everyone ED college is passed over when a higher-ranked college isn't one (the
  next ED college gets ED I); at the top of the list it gets ED I with the caveat.
- ED II is proposed only as a fallback to an ED I or REA choice; the Dream-is-REA case still allows ED II after the
  REA decision.
- Only red conflicts count on the strip (`StageInput.conflicts`); amber ones are lines under the table.
- The profile line loads through a Server Action after the page renders, so the profile stays static (ISR).
- Not done: hooks ("legacy is considered here") wait for profile hooks; open question 2 (merit share in the money
  column) not shown.

### Owner feedback, first pass (2026-10-08)
- **The rounds table was unreadable on desktop**: seven columns in one grid row squeezed the college name under the
  rounds chips. Each college is now a card on every width: the college and the rounds it offers on the top line with
  the round picker at the right, then four labelled cells underneath (Dates, Early advantage, Interest · standing,
  Money), two across on tablets and four across from `lg`. The column header row is gone; every cell carries its name.
- **Ranking must feel instant.** The priority list's move buttons and drag handle stay enabled while a save is in
  flight (the order was already optimistic); only "Back to the proposal" waits.
