# Parents: Visibility and a Way to Help Without Nagging

> Status: **planned** 2026-10-07. After [model.md](model.md) and [timeline.md](timeline.md); the summary line ships
> with the model. Builds on the household's grants ([accounts.md](../product/accounts.md#privacy-model),
> [household-hub.md](../product/household-hub.md)). Part of the [planner](README.md).

## Goal
The owner's brief: *all along the way, give parents visibility and tools to see how the kids are tracking and help
push them along.* Parents are a quarter of the people stressed about applications (Princeton Review 2025) and the
ones paying, filing the FAFSA, and driving to visits. What a parent needs is not another dashboard but three things:
to see where things stand without asking, a way to help that doesn't turn into nagging, and their own part of the
work in one place. Everything here is a view over the stages with the household's existing rules; nothing is a
second copy of the plan.

## What a parent sees
Under the built grants a guardian reads a student's list, numbers, and now the plan; edits when `can_edit`; every
read of a student's data is logged and visible to the student ([accounts.md](../product/accounts.md#privacy-model)).
The planner adds nothing to those grants and keeps the lines:

| A parent sees | A parent never sees |
|---|---|
| The list, Dream, categories and suggestions, the rounds plan, tasks and ticks, visits and their notes, applications' statuses, decisions, offers | Private list notes; the student's hooks; another guardian's finances or unshared estimate; the content of a nudge another guardian sent |
| The summary line and the weekly summary email | Anything about another household's student |
| Their own tasks and the nudges they sent | A grade, score, or "behind" label the site would have made up |

## The summary line
On the household page, under each student's chip and at the top of their page, one line, computed by
`summaryLine()` (pure, tested):
> **Alex** · Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan

Stage, the stage's count, the next dated task, and the Dream if set. Never a score, a standing, or a count of
overdue tasks presented as a failing ("2 overdue" appears only inside the plan, in the same style as for the
student). For a junior: "Building the list · 6 colleges · 1 visit planned".

## The same plan
The Plan tab on the student's page, as the guardian's own session renders it: the guardian banner ("Viewing as a
guardian"), read-only without `can_edit`, with the additions a guardian gets anywhere:
- A **nudge** button on any open task (below).
- **"Your part"** chips on the tasks assigned to a guardian, with a link to their own page.
- **Suggest a college** on the list stage ([list-building.md](list-building.md#finding-colleges-to-add)).
- **Log a visit** on the actions stage (a parent usually books and drives).
- The **money column** in the rounds stage shows that guardian's own estimate and whether it's shared with the
  student, with "Share" right there ([net-price-estimator.md](../product/net-price-estimator.md)).

Two guardians in a household see the same plan; their own tasks and nudges are theirs.

## Nudges
A nudge is the parent's "hey" delivered by the site instead of across the kitchen table, so the student gets it
when they open the plan or their email, attached to the task it's about.
- One line, optional ("Dad: the Michigan essay is the one I'd do first"), on one task. Sent by email to the
  student's account address, by text when the student has texts on ([timeline.md](timeline.md#texts)), and shown
  on the task in the student's plan as "Nudged by Dad, Tue".
- **Rate-limited by design**: one nudge per task per three days, and at most three a week per student from one
  guardian; the button says "Nudged Tuesday" and greys out. The limit is the feature: a parent can't flood, and the
  student knows a nudge means something.
- The student can **answer** with a tick (which the parent sees as done), a snooze with a date ("Saturday"), or a
  one-line reply shown to the parent on the task. No thread; a reply closes the nudge.
- Nudges are logged (`plan_nudges`) and exportable with the account; they never carry a personal number, and a
  managed student without an account ([household-hub.md](../product/household-hub.md)) can't be nudged (there's
  nobody to deliver to; the button says so).

The research the limit rests on: Castleman and Page's texts worked because they were few, concrete, and dated, and
adding parents as a second channel for the same messages added nothing measurable
([README.md](README.md#research-2026-10-07)). The site reminds; the parent nudges; they are different things and
the student can tell them apart.

## The parent's tasks
A guardian's own page gains a **Your part** section (above their own list): every task assigned `guardian` or
`either` across the students they can see, grouped by student, with the same ticks, dates, and ⓘ: the FAFSA and CSS
Profile and their college priority dates, fees they've said they'll pay, the enrollment and housing deposits once a
choice is made, visits they're booking, and anything the family added with a parent assignee. The weekly summary
email leads with these. A guardian can reassign a task to the student or to "either", and the student can reassign
back; the change is attributed.

## Stuck signals
Shown to the guardian inside the plan (and to the student, in the same words), each a fact with a link, never a
judgment, and each only when true:
- A task overdue by 7+ days ("Michigan's supplement was due Nov 1").
- No activity on the plan for 14 days during the season (August to May).
- No Likely on the list as of September of senior year.
- An ED choice with no estimate shared ("ED is binding; share an estimate or run the calculator").
- A wait list with no deposit elsewhere by April 20.
- A decision expected date that has passed with no outcome recorded.
Signals stay off for juniors except the Likely one in spring.

## The weekly summary
One email on Sunday evening to each guardian who turns it on (off by default; suggested once when the season
starts), per student they can see: the summary line, Your part (at most five), the stuck signals, and what the
student ticked this week (titles only), with one link to the plan. No notes, no numbers, no other household member's
content. Renders with the digest's components; one-click unsubscribe; sent by the same daily job as the digest. A
guardian with texts on ([timeline.md](timeline.md#texts)) can also get the week's Your part as one text.

## Several students, and the dossier
Everything here covers every student the guardian can see, in one view: the household page lists each student's
summary line, Your part merges across them, and the weekly email covers all. The family dossier
([offers.md](offers.md#display)) is the printed version for a family meeting or a counselor.

## Display
- **Household page**: the summary line under each student's chip; **Your part** on the guardian's own page.
- **Student's Plan tab, as a guardian**: the banner, nudge buttons, Your part chips, stuck signals in a quiet panel
  above This week.
- **Student's view**: nudges appear on tasks with the sender's first name; a "Dad nudged you" line in This week.
- **Phones**: the nudge composer is a bottom sheet with the task's title and one field; Your part is a list.
- **Glossary**: `nudge`, `your-part`.

## Rules
- A guardian's visibility is exactly the household grant; the planner never widens it.
- No comparison between students in a household ("Jordan is ahead of Alex") anywhere, including the email.
- Nudges are between one guardian and one student; another guardian sees that a nudge was sent, not its text.
- A student can turn off nudges by email (not in-app ones) on the account page; the guardian sees "Alex reads nudges
  in the plan" on the button.
- Everything here is readable by the student about themselves: the nudges they got, the signals, the email their
  parent receives (a "What your parents see" link on their Plan tab renders it).

## Files (planned)
`lib/planner/summary.ts` (pure: `summaryLine`, `stuckSignals`, `yourPart`), `components/planner/NudgeButton.tsx`,
`YourPart.tsx`, `StuckSignals.tsx`, `WhatParentsSee.tsx`, `emails/parent-summary.tsx`, the nudge Server Actions with
the rate limit in SQL (a check against `plan_nudges`), `tests/planner-parents.test.mts` (the summary line per
stage; each signal on and off; the rate limit; the email has titles only; a managed student can't be nudged).

## Open questions
1. Should a student be able to hide the Dream from parents? The list is visible under the grant and the Dream is a
   list field; recommendation: no special case; the student can simply not set it.
2. Should nudges exist for counselors ([counselor-portal.md](../product/counselor-portal.md))? Same mechanism, the
   portal's grant; recommendation: yes when the portal is built, with the same limits.

## Built (2026-10-08, unit U8 on `feature/planner-parents-2`)
What exists:
- **Pure** `lib/planner/summary.ts`: `summaryLine(input)` (the stage caption, then the next dated task's college,
  date, and round when one exists, else the count of future visits, then the Dream when set; never a score, a
  standing, or an overdue count), `stuckSignals(input)` (the six checks, gated by grade: off for
  junior_fall/earlier/unknown, only the no-Likely one in junior_spring, all six from the summer before senior year
  on), `yourPart(students, today)` (open `guardian`/`either` tasks grouped by student, students with none left
  out). Reuses `rounds.ts`'s `Estimate`/`MoneyInput`/`NO_MONEY` for the ED-with-no-estimate signal, so the
  net-price estimator fills the same seam later.
- **Server**: `lib/planner/store-parents.ts` (`"use server"`): `sendNudge` (calls `send_nudge()`, maps its error
  codes to the button's copy, then best-effort email — unless the student turned nudge emails off
  — and text delivery through `reminders-server.ts`'s `deliverText`), `replyToNudge`, `reassignTask`,
  `setParentSummaryEmail`, `setNudgeEmails`, `myParentSummary`, `myNudgeEmails`, `myYourPart`. `lib/planner/hub.ts`
  gained `summaryLines(students)` beside `stageCaptions`.
- **Migration** `supabase/migrations/20261008142000_planner_parents.sql` (additive; a schema addition was needed):
  `notification_prefs.parent_summary` (the weekly email switch, off by default) and `.nudge_emails` (on by
  default), `unsubscribe_parent_summary_by_token()`, and `student_nudge_emails_off(student)` (security definer, so
  a guardian learns the one bit they need — "Alex reads nudges in the plan" — without reading the student's own
  preferences row).
- **UI**: the summary line under each student's chip on the household page and at the top of their Plan tab
  (`WhatParentsSee` beside it for the student's own view); `components/planner/parents/{NudgeButton,YourPart,
  StuckSignals,WhatParentsSee,AccountSwitches}.tsx`. `NudgeButton` sits in `TaskRow`'s `children` slot (wired into
  `ThisWeek.tsx` and `TimelineTaskRow.tsx`): a guardian sees a bottom-sheet composer (one field) that greys out to
  "Nudged {weekday}" for three days after sending and says up front when the student has no account; the student
  sees every nudge on the task ("Nudged by a parent, {weekday}") with a one-line reply that closes it. `YourPart`
  renders above a guardian's own list (`app/household/[person]/page.tsx`) with the same ticks as the plan.
  `AccountSwitches` on `/account`: the weekly-summary switch for a guardian, the nudge-emails switch for a student.
- **Email** `lib/emails/parent-summary.ts` (pure, like `your-week.ts`): per student, the summary line, Your part
  (at most five), the stuck signals, and what was ticked this week, titles only; one link (to the household, since
  one email can cover several students); one-click unsubscribe. Its branch in
  `app/api/cron/weekly/route.ts`'s marked extension point: every guardian with `parent_summary` on, for every
  student visible through their active guardian memberships (read with the secret-key client, so no RLS session is
  needed); a guardian with texts on also gets the week's Your part as one text (`composeWeekText`, the existing
  `sms_sends` kind `'parent'`).
- **Account export**: `lib/account-export.ts` gained the `planner` exporter — tasks, visits, offers, letter
  metadata (the storage path, not the file), nudges sent and received, and text consents, additively.
- **Glossary** `nudge`, `your-part`. **Telemetry**: `plan_nudge_sent {channel}` was already registered by U1; the
  client fires it after a successful `sendNudge()` (channel is whichever delivery actually went: email, sms, or
  `app` when neither did).
- **Tests** `tests/planner-parents.test.mts`: the summary line per stage situation (building the list with a visit
  planned, applying with the next task's round and the Dream, never a score or an overdue count), each signal on
  and off, `yourPart`'s grouping, the parent-summary email (titles only, one link's worth of URLs, one-click
  unsubscribe, null when nothing to say), and, against real Postgres (PGlite, every migration): the per-task and
  per-week nudge limits, a managed student's `nudge_no_account`, and the nudge-emails-off lookup (a guardian reads
  it, the student themself can't through this function).

Decisions the brief didn't cover:
- `sendNudge` always records the nudge with channel `'app'` as far as `send_nudge()` itself knows (a nudge is
  always visible in the plan); the email/text delivery attempts are best-effort and separate from that stored
  value. The client learns which channel actually delivered from `sendNudge`'s return and fires
  `plan_nudge_sent {channel}` with that value, since `track()` only works in the browser (there is no
  `plan_nudge_sent` entry in `ServerAnalyticsEvent`, and shouldn't be one just for this).
- "No activity for 14 days" has no dedicated activity log, so it's read from what the tables already carry: a
  task's `done_at`, an own task's `created_at`, and a visit's `created_at`/`updated_at`. The most recent of those,
  compared against 14 days back; nothing recorded at all reads as stale.
- `reassignTask` has no separate "changed by" column (the model doesn't have one); the edit is attributed the way
  every other plan edit is, through the list's edit policy and the session that made it.
- The timeline's full month/college view (`TimelineTaskRow`) doesn't look up the student's nudge-emails-off bit
  (that would be an extra query per page render beyond the one already made for This week); its `NudgeButton` is
  passed `studentNudgeEmailsOff={false}`, so the "{name} reads nudges in the plan" line only shows in This week.
  The button and the rate limit work either way.
- The household page's summary line renders in a line under the people strip (one per visible student), not
  squeezed into the chip's own caption span: the chip caption (`chipCaption`) stays the short stage phrase U1
  built, since the full summary line ("… · next: …, … · Dream: …") would overflow that fixed-width, single-line
  slot.
- "What your parents see" shows the summary line, the stuck signals, and what the student ticked this week — not
  a literal per-guardian inbox (Your part differs by guardian, and the student has no one guardian in view to
  render it for); a note says their own Your part is additionally included in what each guardian actually
  receives.
- Account-export's `planner` key is additive per the brief; it does not touch the `lists` exporter U1 already
  shipped (which doesn't carry the planner columns on `list_items` — out of scope for this unit to extend).
