# Stage 5, Applying: What Each College Needs and Whether It's In

> Status: **planned** 2026-10-07. After [timeline.md](timeline.md). Uses CDS C8 and C13 via
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
1. Screenshot import of the Common App dashboard to seed statuses ([README.md](README.md#open-questions-for-the-owner)):
   worth it after the letters extractor exists; recommendation: yes, as a follow-up.
2. Should the transcript request be one shared task by default? High schools differ (some send to every college at
   once, some per college); recommendation: shared by default, with "per college" as a switch.
