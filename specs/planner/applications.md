# Stage 5, Applying: What Each College Needs and Whether It's In

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u6-on-featureplanner-apply-2)); planned 2026-10-07. After [timeline.md](timeline.md). Uses CDS C8 and C13 via
> [cds-test-scores-and-policy.md](../data-expansion/cds-test-scores-and-policy.md) and
> [cds-application-logistics.md](../data-expansion/cds-application-logistics.md), H8 via
> [cds-financial-aid.md](../data-expansion/cds-financial-aid.md). Part of the [planner](README.md).

## Goal
From August of senior year to the last deadline, the question is simple and the tracking isn't: what does each
college still need from us, is it submitted, and is it complete? Common App's dashboard answers part of it for
Common App colleges and nothing for the rest; the college's own portal answers it one login at a time. This stage
is the one checklist across every college: what the site knows the college requires, what the student says they've
done, the portal link, and the follow-ups a deferral or a wait list creates. The site can't submit anything for the
student; it can make sure nothing is forgotten.

## What the site knows per college
Shown on each college's card as a requirements list with a ⓘ each, and nothing invented:

| Requirement | From | Shown as |
|---|---|---|
| Application deadline for the chosen round | the timeline's task | "Apply by Jan 2 (ED II)" |
| Application fee and waiver | C13 (fee, waiver available, online fee, online waiver); IPEDS application fee | "$75 · fee waiver available" with the waiver note |
| Test policy this cycle | C8 (required / optional / blind / considered if submitted) | "Test-optional for fall 2027" and, with the student's numbers, "Your SAT is above the middle 50%: consider sending" (the built `fitsScoreValues` wording) |
| Aid forms | H8: FAFSA, CSS Profile, college's own form, noncustodial profile, with priority dates | one line each, the parent's task where it's a parent's form |
| Interest considered | C7 | so the student knows a portal visit or an optional interview counts |
| Interview | C7 "interview" importance | "Interviews are considered here" / "not considered" |
| Platform | the student's pick (Common App, Coalition, the college's own, UC, ApplyTexas, other); the site has no reliable per-college source | a chip, used to group the student's work ("Common App: 6 colleges") |
| Essays and recommendations | student-entered counts; not in any public dataset | "2 supplements · 2 recommendations" with ticks |

A college with no CDS record shows the deadline from the student's own date and the fee from IPEDS, and says the
rest isn't published.

## Status per college
The built `status` and `outcome` stay the facts; this stage gives them a day and a progression:

```
considering → applying (started) → applied (applied_on) → complete (complete_on: all materials received) → decided
```
- **Started** when any sub-task is ticked or the student says so; **Applied** sets `applied_on` and the status (one
  tick, from the card, the list row, or the timeline's Apply task; they are the same fact); **Complete** when the
  student confirms the portal shows everything received.
- **Portal**: a URL the student pastes once (`portal_url`), opened from the card; the site never stores a login.
  After `applied_on`, a weekly `stage` task "Check {College}'s portal" runs until `complete_on`, then stops.
- **Deferred** (an early round moved to regular): the built rule returns the item to `applied`; this stage adds the
  follow-ups: "Send {College} a short update if they accept one" (a letter of continued interest), and for an ED I
  deferral, "You're released from the ED commitment; ED II at {College} is due {date}" ([early-rounds.md](early-rounds.md#open-questions)).
- **Waitlisted**: tasks "Accept your place on the wait list by {date}" (from the letter, student-entered), "Deposit
  somewhere else by May 1: a wait list is not an offer", and the continued-interest note; the offers stage shows the
  wait-list row in context ([offers.md](offers.md#recording-decisions)).
- **Withdrawn** (`withdrawn_on`): the student pulled the application, usually after an ED yes; the card greys out.

## Sub-tasks
Generated once per college as `stage` tasks, undated, grouped under the Apply task in the college view:
1. Fee or waiver ("you said you're eligible for a waiver" when the profile says so).
2. Test scores: send / don't send (the policy line decides the wording; "sent" records the date).
3. Transcript requested from the high school (one task per college or one shared, by the student's choice; schools
   differ).
4. Recommendations: the student's count, each with a name and "asked" / "submitted" (names stay in the family's data,
   never in telemetry or emails).
5. Supplements: the student's count, each a tick.
6. Submit (ties to `applied_on`).
7. Aid forms (the H8 list; parent-assigned).
8. Portal set up and checked (after submit).

The counts in 4 and 5 are entered once per college; Common App colleges share the main essay (one shared task).

## Display
- **Stage panel**: a card per college in deadline order (the next due first), each with the requirements list,
  the sub-tasks, the status chips, the portal button, and the fee line; a header line "3 of 8 in · next: Michigan,
  Nov 1". A **By platform** toggle groups the cards (Common App, Coalition, own).
- **List row**: the status picker already there gains the Applied date and the portal button in "More".
- **Timeline**: the Apply task and the sub-tasks; the weekly portal check.
- **Parent's view**: read-only; the parent's own tasks (fees if they pay, aid forms) show on their page
  ([parents.md](parents.md#the-parents-tasks)); a parent with edit access can tick anything and it's attributed.
- **Phones**: the cards are one column with the sub-tasks folded; the status is a bottom-sheet picker.
- **Glossary**: `application-portal`, `letter-of-continued-interest`, `fee-waiver`, plus the existing
  `test-optional`, `test-blind`, `deferred`, `waitlisted`.

## Rules
- The site never submits, pays, uploads to, or logs in to anything on the student's behalf; every status here is
  the student's word, and the card says "as you recorded it".
- No requirement is shown as required unless the college's data says so; essays and recommendations are the
  student's counts.
- Fee-waiver eligibility wording comes from the Common App and NACAC criteria the profile already asks about
  (Pell-likely, first-generation are hooks on the profile; the waiver question is its own yes/no, asked once).
- Deferral and wait-list tasks appear only when the outcome is recorded; nothing is generated speculatively.

## Files (planned)
`lib/planner/requirements.ts` (pure: the requirements list from the school record and profile), the `stage`
generators for sub-tasks and portal checks in `lib/planner/tasks.ts`, `components/planner/ApplyStage.tsx`,
`CollegeApplyCard.tsx`, `tests/planner-apply.test.mts` (requirements for a college with full CDS data, one with none;
applied sets status; deferred generates the ED II line only when an ED II college exists; the portal check stops at
complete).

## Open questions
1. Screenshot import of the Common App dashboard to seed statuses: later, not this pass (owner decision 2026-10-07,
   [README.md](README.md#owner-decisions-2026-10-07)); it would ride on the letter reader when that exists.
2. Should the transcript request be one shared task by default? High schools differ (some send to every college at
   once, some per college); recommendation: shared by default, with "per college" as a switch.

## Built (2026-10-08, unit U6 on `feature/planner-apply-2`)
What exists:
- **Requirements** `lib/planner/requirements.ts` (pure): `requirementsFor(item, school, profile)` returns the
  table's eight lines (deadline, fee, test policy, aid forms, interest, interview, platform, essays/recommendations),
  each with a `cite` key into `PlanSchool.cites` and a `published` flag; a college with no CDS record falls back to
  the student's own deadline (`deadline_text`/`deadline_date`) and the federal application fee, and marks the rest
  unpublished rather than inventing it. `sendScoreAdvice` is the built `fitsScoreValues` wording ("Your SAT is above
  this college's middle 50%: consider sending"), shown only at a test-optional college with a saved score.
  `orderForApply` (deadline order, undated last) and `groupByPlatform` ("By platform") back the stage panel.
- **Generator** `lib/planner/generators/apply.ts`: the eight sub-tasks once a college is `applying` or later
  (`fee`, `send_scores`, `transcript`, `recommendation` × `recommendations_count`, `supplement` ×
  `supplements_count`, `submit`, `portal_setup`; `aid_forms` is college.ts's own task, already generated). The
  transcript request is one list-wide shared task by default (`transcript_shared !== false` on every applying
  college), or a per-college task for any college that switched it off. Common App colleges share one personal-essay
  task (`supplement`, suffix `essay`). `portal_check` runs weekly from `applied_on`: each week is its own key
  (`{item}:portal_check:{n}`), so a finished week's task is replaced by the next week's rather than reopened
  (`mergeTasks` never resets `done_at`); it stops being generated once `complete_on` is set. Deferral
  (`continued_interest`, plus the ED II pointer only when an ED II college exists on the list) and wait-list tasks
  (`waitlist_accept`, `waitlist_deposit_elsewhere`, `continued_interest`) generate only once the outcome is recorded.
  A withdrawn college gets none of this.
- **Views.** `components/planner/stages/ApplyStage.tsx`: the header line ("N of M in · next: College, date"), any
  shared tasks first, then a card per college in deadline order (`CollegeApplyCard.tsx`: the requirements list with
  its ⓘs, the status/outcome picker, the fee and portal controls, and the sub-tasks folded under "What's left" in a
  `<details>`); `ApplyPlatformToggle` regroups the same cards "By platform". `ApplyStatusControl` is the status (and
  outcome) picker: an inline `<select>` from `sm`, a button opening a bottom sheet of big rows on phones — picking
  "Applied" calls `markApplied` (not the bare status write) so the date is recorded with it.
  `components/planner/row/apply.tsx` adds the Applied checkbox, the platform chip, and the portal button/field to
  the list row's "More".
- **Server** `lib/planner/store-apply.ts` (`"use server"`, the `ready(capability)` pattern, `planner.tab`):
  `markApplied`/`unmarkApplied` (ties `applied_on` to the timeline's `apply`/`ed2_conditional` task, per Wave 1's
  note that the unit setting `applied_on` ticks it), `markComplete`, `setPlatform`, `setPortalUrl` (rejects anything
  that isn't `http(s)://`), `setCounts`, `setTranscriptShared`, `markWithdrawn`. Every write calls `regenerate(listId)`.
- **Profile** `feeWaiverEligible: boolean | null` on `StudentProfileBasics` (the `plansTestOptional` pattern, but
  tri-state: not set / yes / no), asked once on `/me` (a "Not set / Yes / No" select in Basics); the apply
  generator's fee task and `requirements.ts`'s fee line read it.
- **Glossary** `application-portal`, `letter-of-continued-interest`, `fee-waiver`.
- **Tests** `tests/planner-apply.test.mts`: requirements for a college with full CDS data (every line published)
  and one with none (the rest says "hasn't published", with the student's own date and the federal fee still
  showing); `sendScoreAdvice`'s three cases; `orderForApply`/`groupByPlatform`; the pure status rule `markApplied`
  relies on; the generator's sub-tasks, the shared transcript and Common App essay, the portal check opening and
  stopping at complete, the ED II pointer appearing only with an ED II college on the list, and wait-list tasks
  appearing only once recorded.

Deviations and decisions the brief didn't name:
- No new migration: every column and `plan_tasks.kind` value U6 needs was already in U1's migration
  (`20261008120000_planner.sql`), so there is no `20261008140000_planner_apply.sql`.
- The sub-tasks' `source` is `'stage'` (not `'college'`): they come from the student's own counts and choices, not
  the college's published dates, even though some (fee, test policy wording) read college data for their text.
- `send_scores`'s title comes from the test policy's headline answer (required/required-some/recommended/
  considered/not-considered), whichever shape `PlanSchool.testPolicy` is in (the full CDS grid or just the federal
  answer); `isReportedTestPolicy`/`testPolicyAnswer` in `requirements.ts` tell them apart once, for both the
  requirements line and the generator.
- `markComplete`'s default parameter is `todayIso()`, so `markComplete(itemId)` records today and
  `markComplete(itemId, null)` clears it (one function, not a separate clear action).
- Recommendation and supplement counts are capped at 20 for validation and generate at most 12 sub-tasks each
  (`MAX_SUBITEMS`), so a typo (200) can't flood the plan with tasks.
- Status is set through `lib/lists.ts`'s existing `setItemStatus`/`setOutcome` for every status except "applied"
  (which goes through `markApplied` so the date is recorded); the Plan tab's own regeneration-on-open covers the
  rare case where that leaves the tasks stale for a moment.
- Not done here: a per-recommender name field (the spec keeps names out of the task text and telemetry by design,
  "asked"/"submitted" has no name field yet in this pass); screenshot import, as the spec already deferred it.

### Owner feedback, first pass (2026-10-08)
- **The platform picker offers only platforms the college can take** (`platformsFor` in `lib/planner/requirements.ts`,
  used by the Apply card and the list row): the University of California takes only its own application; ApplyTexas
  appears only for Texas public colleges and for any college whose apply link points at applytexas.org; everyone
  else may take the Common App or the Coalition (the site has no member list yet, so neither is ruled out until the
  [Common App data](../data-expansion/common-app.md) arrives), its own site, or "other". A platform saved earlier that
  the rule no longer offers stays selectable as "(not offered)". Tested in `tests/planner-apply.test.mts`.
