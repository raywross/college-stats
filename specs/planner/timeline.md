# Stage 4, The Timeline: Key Dates and Tasks That Keep the Plan Moving

> Status: **built** 2026-10-08 on `feature/planner` ([below](#built-2026-10-08-unit-u5-on-featureplanner-timeline)); planned 2026-10-07; the application plan of 2026-10-06 (`product/application-plan.md`) moved here and
> rewritten as the planner's stage 4. After [model.md](model.md) and [early-rounds.md](early-rounds.md) (a task's
> date follows the chosen round). Builds on [cds-application-logistics.md](../data-expansion/cds-application-logistics.md),
> [cds-admissions.md](../data-expansion/cds-admissions.md), [cds-financial-aid.md](../data-expansion/cds-financial-aid.md),
> and the digest in [follow-colleges.md](../product/follow-colleges.md). Part of the [planner](README.md).

## Goal
A list of ten colleges is a hundred small things to do over eighteen months, and most families keep them in their
heads. The timeline is the project plan: every task with a date, who it belongs to, where its date came from, and
what's next, generated from the college's own published dates, the cycle's shared dates, and the stage the student
is in, with the family's own tasks beside them. It is the backbone the other stages hang their tasks on, the thing
the weekly email and the calendar feed read, and what a parent looks at to see how it's going.

## Research (2026-10-06, extended 2026-10-07)
- **What the site has per college**: regular-round closing and priority dates, notification and reply rules, housing
  deposit date and refund rule, gap-year policy (C13–C17, [cds-application-logistics.md](../data-expansion/cds-application-logistics.md));
  ED and EA closing and notification dates (C21/C22); the aid forms required (FAFSA, CSS Profile, the college's own
  form, noncustodial profile) and their priority dates (H8, [cds-financial-aid.md](../data-expansion/cds-financial-aid.md));
  the coming cycle's test policy (C8); the visit link and admissions page; social accounts. All cited by edition.
- **Dates that apply to everyone** are few and public: the FAFSA opens October 1 (the Department's target since the
  2024 reset); the CSS Profile opens October 1; most early rounds close November 1 or 15 and answer by mid-December;
  ED II and most regular rounds close January 1–15; the national reply date is May 1 where the college uses it. SAT
  and ACT dates and registration deadlines are published a year ahead by College Board and ACT. These go in a
  versioned file, below, so a change is a data PR.
- **Tasks without a fixed date** are most of the real work and are what comparable tools leave out: ask two
  teachers for recommendations before summer; draft the personal essay over the summer; send test scores; request
  the transcript; write the supplements; check the portal after submitting; thank the recommenders. Counselors'
  published timelines (NACAC's, College Board's, Common App's) agree on the order and the season; the file encodes
  them as windows, with the source.
- **Reminders that work are concrete** (Castleman and Page, [README.md](README.md#research-2026-10-07)): one task,
  a date, a link, a few at a time. The timeline's reminders follow that, and parents get a summary rather than a
  copy ([parents.md](parents.md)).
- **Comparable tools.** Scoir and Naviance list deadlines per college and let a student mark "applied"; Common App
  shows each college's requirement grid once added; College Kickstart has an action plan without a family account.
  None generates the pre-application steps from the college's data or gives the parent the same view.

## The cycle file
`data/application-cycle.json`, one object per cycle year, reviewed in a data PR each spring when the next cycle's
dates are published, with a schema check in `npm run verify`:

```json
{
  "cycle": "2027-28",
  "entries": [
    { "key": "fafsa_opens", "label": "FAFSA opens", "date": "2027-10-01", "applies": "all", "assignee": "guardian",
      "source": "https://studentaid.gov/h/apply-for-aid/fafsa", "detail": "File early: some state and college aid is first come, first served." },
    { "key": "css_profile_opens", "label": "CSS Profile opens", "date": "2027-10-01", "applies": "has_css_college", "assignee": "guardian", "source": "…" },
    { "key": "ask_recommenders", "label": "Ask two teachers for recommendations", "window": ["2027-04-15", "2027-06-10"],
      "applies": "all", "assignee": "student", "source": "…", "detail": "Before summer, while they remember your work." },
    { "key": "personal_essay_draft", "label": "Draft the personal essay", "window": ["2027-06-15", "2027-08-31"], "applies": "has_common_app", "assignee": "student", "source": "…" },
    { "key": "sat_2027_08", "label": "SAT", "date": "2027-08-28", "register_by": "2027-08-13", "applies": "plans_tests", "assignee": "student", "source": "…" },
    { "key": "reply_date", "label": "National reply date", "date": "2028-05-01", "applies": "uses_may1", "assignee": "either", "source": "…" },
    { "key": "final_transcript", "label": "Ask your school to send the final transcript", "window": ["2028-05-15", "2028-06-30"], "applies": "committed", "assignee": "student", "source": "…" }
  ]
}
```
`applies` is a small vocabulary resolved against the student's list and profile (`all`, `has_css_college`,
`has_common_app`, `plans_tests`, `uses_may1`, `has_ed`, `committed`, `international`, `noncustodial`); a key the
code doesn't know fails the schema check. Windows become tasks with `window_start`/`window_end` and no hard due date.

## Generators
`generateTasks()` ([model.md](model.md#shared-code-contracts-for-the-stage-units)) composes four sources. Every task
has a key, so regenerating after a data publish or a round change updates dates and text and keeps ticks.

**`college`**: dates from the college's record for the item's round (`list_items.round`):
| Task | From | Due |
|---|---|---|
| Apply ({round}) | C21/C22 closing for ED/EA/REA; C14 for RD; C14 priority date for rolling | the date; the fee and waiver shown beside it (C13) |
| Decision expected ({round}) | notification dates | informational; marking it opens outcome entry ([offers.md](offers.md#recording-decisions)) |
| Aid forms for {College} | H8: CSS Profile, the college's form, noncustodial profile, with the college's priority date | the earliest aid priority date, else the application deadline |
| Reply by | C17 reply rule (fixed date / May 1 / weeks after notice) | once `admitted` |
| Housing deposit | C17 housing deposit date, amount, refund rule | once `enrolling` |
| ED II apply, conditional | the ED II college's closing date | with "only if {ED I college} isn't a yes (expected {date})" |

Nothing is generated for a college without the data; the card says "the college hasn't published this; add your
own date" with a field, and a date the person typed says "your date". When the record on file is the previous
cycle's edition, the task says "date from the 2026–27 edition; confirm on the college's page" with the link.

**`cycle`**: the file's entries that apply to this student, once per student (the FAFSA is one task shown on every
college's card as "shared"), with `assignee` from the file (FAFSA, CSS Profile, deposits and anything that needs a
payment or a parent's tax information default to `guardian`; essays and asks to `student`).

**`stage`**: undated, in-season tasks the other stages register: decide the round (six weeks before the earliest
early deadline, [early-rounds.md](early-rounds.md)); follow and request information ([actions.md](actions.md));
write the supplements and check the portal ([applications.md](applications.md)); write down the visit; a wait-list
letter; withdraw the others and the summer list ([offers.md](offers.md#after-the-choice)).

**`own`**: the family's tasks: a title, an optional date, an assignee, and a college or "general". Free text; the
site's kinds are its vocabulary, not the family's.

## The plan by grade
`gradeOf(gradYear, today)` decides what is **in season**; tasks out of season exist but sit folded under "Later".
| Grade | In season | The tab leads with |
|---|---|---|
| Sophomore and earlier | List (explore), visits | "Start a list; visit when you travel" |
| Junior, fall–winter | List, Actions, test dates | the balance line, visits, SAT/ACT dates |
| Junior, spring | Rounds (first pass), recommenders, visits | "Ask two teachers before summer" |
| Summer before senior year | Essay, Rounds (final), Applications open (Aug 1) | the essay window, the rounds proposal |
| Senior, fall | Applications, aid forms, early deadlines | This week, by college |
| Senior, winter | ED II, regular deadlines, decisions start | decisions expected |
| Senior, spring | Offers, reply date, deposit | [offers.md](offers.md) |
| Summer after | the summer list | orientation, housing, final transcript |

A student can see every task at any time; the grade only decides the fold and what the weekly email mentions.

## Display
- **Month view** (default on the Plan tab under the stage panel): tasks grouped by month, overdue ones at the top in
  the warning color, done ones collapsed under a count, each with its tick, the college's crest or "shared", the
  date with its ⓘ, the assignee chip ("Mom", "You"), the reason line, snooze (a week), and for a guardian the nudge
  ([parents.md](parents.md#nudges)). Windows show as a bar across their months.
- **College view**, one toggle away and the one printed: a card per college with its tasks in order and a progress
  count. Shared tasks appear in a "For every college" card first.
- **This week** lives at the top of the Plan tab ([model.md](model.md#where-it-lives)): due in seven days or
  overdue, at most eight, "and 4 more".
- **On the list** each row shows its next task and date in place of the plain deadline.
- **Calendar feed**: "Subscribe in your calendar" gives a per-list `webcal://` URL (`/api/plan/{token}.ics`, token
  hashed, revocable from the same menu) with every dated task and visit, titles only ("Michigan: apply (ED I)"), no
  notes, no personal numbers; works in Apple, Google, and Outlook calendars. A one-time `.ics` download covers people
  who don't want a subscription.
- **Print**: the college view with the household name, the date, and a sources line; the family dossier
  ([offers.md](offers.md#display)) reuses it.
- **Phones**: one column; the month heading is sticky; the toggle is a segmented control; the nudge and snooze are in
  a row's bottom sheet.

## Reminders
- **In the digest** ([follow-colleges.md](../product/follow-colleges.md#the-digest)): a task due within seven days
  adds a line to the next digest; during the season (August to May) a weekly digest goes out even when no college's
  data changed, only to people with a task due. The line is the task, the college, and the date; never a note or a
  number.
- **"Your week"** (new): one email on Sunday evening to the student with This week's tasks and the first overdue
  one, one line each, and a link; nothing else. Off by default for juniors before spring; on by default for seniors
  in season; a switch on the account page beside the updates switch.
- **Parents** get the summary email in [parents.md](parents.md#the-weekly-summary), not a copy of the student's.
- **Texts**, below.

### Texts
The owner's decision (2026-10-07): reminders reach the phone. The research behind it is Castleman and Page's
trials, where texts about one concrete, dated task moved enrollment ([README.md](README.md#research-2026-10-07)).
- **Consent first.** A phone number already sits on the household record for students and guardians
  ([household-hub.md](../product/household-hub.md#adding-a-person)). Texts start only after an explicit opt-in on
  the account page: the person's own for an adult, a guardian's for a student under 18 (the guardian ticks it on the
  student's page, and the student sees that it's on and who turned it on). The first text is a confirmation with the
  STOP wording; a STOP reply sets the opt-out through the provider's webhook and nothing more is sent
  (`sms_consents`, [model.md](model.md#tables)).
- **What's sent.** Two kinds, both plain text, no links to anything but the plan: the **week** on Sunday evening
  (the same content as Your week, trimmed to the first three tasks: "Quad · This week: Michigan essay (Nov 1),
  FAFSA (Mom), Tufts visit Sat") and a **day-before** text for a dated task with a hard deadline (application,
  reply, deposit). A guardian's nudge can go by text when the student has texts on ([parents.md](parents.md#nudges)).
  Never a personal number, never a note, never a decision outcome.
- **Limits.** At most one text a day per person, none between 9 pm and 8 am in the household's time zone (from the
  home address when there is one, else the phone's area code), and the week's text is skipped when nothing is due.
- **Provider: Twilio** Programmable Messaging (owner decision 2026-10-07): a toll-free number verified for this
  use, or a registered 10DLC number; about a cent per segment; registration takes weeks, so it starts before the
  timeline unit is built. The sending code sits behind one small interface (`lib/sms.ts`: `send`, `handleInbound`)
  so the provider could still change. Cost at a thousand opted-in people texting twice a week is tens of dollars a
  month. Owner setup, when built: a Twilio account, the number and its registration, the inbound webhook pointed at
  the site, and the three env values below in Vercel.
- **Email stays the default.** Texts are an addition for people who turn them on; everything a text says is also in
  the plan and the email.

## Rules
- Every date names its source and edition; a typed date says "your date"; a last-cycle date says so.
- A task is never deleted by a regeneration; a generated task whose source disappeared (the college dropped ED II)
  is marked and shown once ("Tufts no longer offers ED II in its 2027–28 data"), then hidden if untouched.
- A guardian's tick is attributed like any edit; a student can untick.
- Tasks for a college removed from the list go with it (cascade); done tasks stay in the export.
- No task says "required" unless the college's data says so; aid-form tasks name the form the college listed.

## Files (planned)
`data/application-cycle.json` (+ `scripts/check-cycle.mts` in verify), `lib/planner/cycle.ts`, the `college` and
`cycle` generators in `lib/planner/tasks.ts`, `lib/ics.ts`, `app/api/plan/[token]/route.ts`,
`components/planner/MonthView.tsx`, `CollegeView.tsx`, `ThisWeek.tsx`, `TaskRow.tsx`, the digest's task lines and
the Your week email (`emails/your-week.tsx`), `lib/sms.ts` with `app/api/sms/inbound/route.ts` (the STOP webhook)
and the consent controls on the account and person pages, `tests/planner-timeline.test.mts` (every generator
against a college with full data and one with none; a round change that moves a date and keeps a tick; a last-cycle
edition's wording; the feed's `.ics` has titles only; the fold by grade at four dates; a text is never composed for
a person without an active consent, never at night, never twice a day, and never with a number from the profile).
Env: `SMS_PROVIDER_SID`, `SMS_PROVIDER_TOKEN`, `SMS_FROM_NUMBER`.

## Open questions
1. Should a task the family adds be free text only, or pick from the site's kinds? Recommendation: free text with a
   date and an assignee.
2. When a deadline moves after the student marked "applied", say nothing or note it? Recommendation: nothing; the
   digest line is for people still ahead of the date.
3. The calendar feed shows the household's plan to any calendar the URL is pasted into; the token is the only
   secret. Recommendation: titles only, revocable, and shown with that sentence.

## Built (2026-10-08, unit U5 on `feature/planner-timeline`)
What exists:
- **Generators.** `lib/planner/generators/college.ts`: the six college tasks, one key per college and kind
  (`{item}:{kind}:-`, so a round change moves the apply and decision dates and keeps the tick). Apply by round (C21
  ED I/II, C22 EA/REA, C14 regular closing, C14 priority date for rolling) with the fee (federal) and the C13 waiver
  in the detail and an ⓘ for the fee in the views; decision expected (the round's notification); aid forms (H8 forms
  by name, the earliest of the priority date and the deadline, else the application date); reply by (C17, once
  admitted); housing deposit (C17 date, amount, refund rule, once enrolling); for an ED II college beside an ED I one,
  `ed2_conditional` ("Apply ED II, only if Michigan isn't a yes (expected Dec 15)") in place of a plain apply. Nothing
  without data. Every task carries `source_field` and `source_edition` (the citation's CDS edition, else the block's);
  an edition older than the student's cycle sets `date_note: "last_cycle"`. `lib/planner/generators/cycle.ts`: the
  cycle file's entries that `applies()`, once per student, assignee from the file; a test date with a registration
  deadline becomes "Register for the SAT (test day Nov 7)" due on the deadline.
- **The cycle file** `data/application-cycle.json`: 2026–27, 2027–28, 2028–29 with the fixed dates, five windows (ask
  recommenders, personal essay, supplements, portal checks, thank recommenders), SAT and ACT dates with registration
  deadlines from College Board and ACT as published on 2026-10-08 (dates the publishers list as projected or
  anticipated are labeled so, with no deadline; dates not yet published are left out), and the summer list
  (`applies: "committed"`: final transcript, orientation, health forms, accepting aid).
- **Views.** `components/planner/stages/TimelineStage.tsx` (server): `MonthView` (overdue first in the warning color,
  done folded under a count per month, windows as bars via `WindowBar`, the month heading sticky on phones, "Later"
  for tasks past the grade's horizon) and `CollegeView` ("For every college" first, a card per college with a
  progress count, colleges without dates listed with "add your own"), a By month | By college toggle
  (`TimelineViews`), print styles (the college view prints, with a printed line and a sources line), a "Changed" line
  for orphaned tasks with "Got it" (`OrphanNotice`), "Add a step" and Edit/Delete for own tasks (`OwnTaskControls`),
  and the Plan menu (`PlanMenu`: calendar link, one-time .ics, print, texts). Rows are U1's `TaskRow` through
  `TimelineTaskRow`.
- **Pure rules** in `lib/planner/timeline.ts`: `FOLD_DAYS`/`isFolded`/`splitFold`, `windowBar`, `orphansToShow`,
  `scrubNumbers`, `outsideTitle`, `feedEvents`, `dueSoon`, `dueTomorrow`, `HARD_DEADLINE_KINDS`, `yourWeekDefault`.
- **Calendar feed** `app/api/plan/[token]/route.ts` (`/api/plan/{token}.ics`, sha256 hash looked up with
  `plan_for_calendar_token` and the secret-key client): open dated tasks and visits, titles only.
  `lib/planner/store-timeline.ts`: `createCalendarToken` (one live link per person and list; shown once),
  `revokeCalendarToken`, `planIcsOnce`, `editOwnTask`, `deleteOwnTask`, `setYourWeek`, `myYourWeek`, `consentView`,
  `setSmsConsent`, `revokeSmsConsent`.
- **Reminders.** `lib/digest.ts` `buildDigest(..., { tasks })` adds "Coming up on your plan" (at most five lines);
  the digests cron gathers them per user (`lib/planner/reminders-server.ts digestTaskLines`). `lib/emails/your-week.ts`
  and `app/api/cron/weekly/route.ts` (Sunday 23:00 UTC; Bearer `CRON_SECRET`; returns early when neither email nor
  texts are configured; a marked extension point for U8's parent summary). One-click unsubscribe:
  `/unsubscribe/{token}/week`. The account page's "Plan reminders" section (`components/account/RemindersSection.tsx`)
  has the Your week switch (null = default by grade) and the texts switch.
- **Texts.** `lib/sms.ts` (`send`, `handleInbound`, `composeWeekText`, `composeDayBeforeText`, `composeConfirmText`,
  `quietHours`, `canText`, `timeZonesFor`, `consentBy`, Twilio signature check) over Twilio's REST API with fetch;
  dormant without the env. `lib/planner/reminders-server.ts deliverText` applies every rule and claims the day in
  `sms_sends` before sending. `app/api/sms/inbound/route.ts`: STOP sets `provider_opt_out_at`. The week's text goes
  from the weekly job; the day-before text from `app/api/cron/day-before/route.ts` (Monday to Saturday, 23:00 UTC).
- **Migration** `supabase/migrations/20261008131000_planner_timeline.sql`: `notification_prefs.your_week`,
  `unsubscribe_your_week_by_token()`, and `sms_sends` (the unique (consent, day) index is the one-a-day rule).
- **Glossary** `calendar-feed`, `your-week`. **Tests** `tests/planner-timeline.test.mts`, `tests/sms.test.mts`,
  `tests/planner-timeline-policies.test.mts`.

Decisions the build made:
- The apply task's key has no round suffix (`{item}:apply:-`), so changing the round keeps the tick (the brief's test).
- Summer-list entries (`applies: "committed"`) aren't generated by the cycle generator: they are U7's `summer` tasks.
- A cycle entry whose date passed more than 30 days ago isn't generated, so a senior who joins in October doesn't
  start with last spring's steps overdue; an orphan whose date has passed is hidden without a "Changed" line.
- Generated tasks aren't ticked by the generator: marking a college applied (U6) or recording a decision (U7) doesn't
  tick the apply or decision task; those units can tick them.
- Day-before texts need an evening run every day, so a second cron (`/api/cron/day-before`, Monday to Saturday) sits
  beside the Sunday one. At 23:00 UTC it's 6–7 pm Eastern and 3–4 pm Pacific: inside the allowed hours everywhere in
  the continental US.
- Texts for a student always use a `student_id` consent (the student's phone from the household record); an adult's
  own consent (a guardian) is a `user_id` row, for U8's parent texts. A student is treated as under 18 unless their
  birth year says otherwise (a guardian's view reads it with the secret key when that's configured).
- The digest still goes only when a college changed; the weekly "tasks only" mail is Your week.
- Your week goes to students only; parents get U8's summary.

Owner setup for texts:
1. A Twilio account; buy a toll-free number and submit its toll-free verification for this use (or register a 10DLC
   brand and campaign); verification takes weeks.
2. Turn on Advanced Opt-Out on the Messaging Service or number (Twilio answers STOP/HELP with the required wording).
3. Point the number's "A message comes in" webhook (HTTP POST) at `https://{site}/api/sms/inbound`.
4. In Vercel (Production): `SMS_PROVIDER_SID` (the Account SID), `SMS_PROVIDER_TOKEN` (the Auth Token; also used to
   check the webhook signature), `SMS_FROM_NUMBER` (E.164), plus `SUPABASE_SECRET_KEY` and `CRON_SECRET` if not set.
5. Apply `20261008131000_planner_timeline.sql` to the database; redeploy so the new crons register.
