# Application Plan: Steps and Dates for Every College on the List

> Status: **planned** 2026-10-06, after [household-hub.md](household-hub.md). Turns a student's list into a plan: for
> each college, the steps worth taking and the dates that matter, in order, with the next one always visible; a
> parent sees how it's going without asking. Builds on [saved-lists.md](saved-lists.md),
> [cds-application-logistics.md](../data-expansion/cds-application-logistics.md),
> [cds-admissions.md](../data-expansion/cds-admissions.md), [cds-financial-aid.md](../data-expansion/cds-financial-aid.md),
> and [social-accounts.md](../school-identity/social-accounts.md). Part of [product](README.md).

## Goal
A list of ten colleges is a hundred small things to do over eighteen months, and most families keep them in their
heads, a spreadsheet, or nowhere. The plan is that spreadsheet, filled in from what the site already knows about each
college: when its applications close, when it answers, when a deposit is due, what aid forms it wants, where its
admissions office posts. The student ticks things off; the parent checks in. Nothing here is advice about *where* to
apply ([chances-and-fit.md](chances-and-fit.md) is that); it is about not missing a step at the places already chosen.

## Research (2026-10-06)
- **What the site already has per college.** Regular-round closing and priority dates, notification and reply
  rules, the housing deposit's date and refund rule, and the gap-year policy
  ([cds-application-logistics.md](../data-expansion/cds-application-logistics.md)); early decision and early action
  closing and notification dates ([cds-admissions.md](../data-expansion/cds-admissions.md)); the aid forms required
  (FAFSA, CSS Profile, the college's own form, noncustodial profile) and whether international applicants need more
  ([cds-financial-aid.md](../data-expansion/cds-financial-aid.md)); the visit link and admissions page
  ([links.md](../school-identity/links.md)); up to six social accounts per college
  ([social-accounts.md](../school-identity/social-accounts.md)). All of it is cited with its edition, so a date on the
  plan carries the same ⓘ as a date on the profile.
- **Dates that apply to everyone** are few and public: the FAFSA opens October 1 (the Department of Education's
  target since the 2024 reset); the CSS Profile opens October 1; the national reply date is May 1 for colleges that
  use it; most early rounds close November 1 or 15 and answer by mid-December; most regular rounds close in the first
  week of January. These go in a small versioned file, `data/application-cycle.json`, with the cycle year and a
  source URL each, so a change is a data PR, not a code change.
- **Comparable tools.** Scoir and Naviance list deadlines per college and let a student mark "applied"; Common App
  shows each college's own requirement grid and deadlines once the student has added it. None of them suggests steps
  before the application (visit, follow, request information), and none gives a parent a view. The plan's shape is
  closer to a project checklist: steps grouped by college and by month, with the next due date on top.
- **Demonstrated interest** is tracked by a minority of colleges and disclosed in CDS C7 ("level of applicant's
  interest": considered / important / very important), already stored by
  [cds-admissions.md](../data-expansion/cds-admissions.md). Where a college says interest matters, the plan says so
  beside the visit and social steps; where it says "not considered", the plan shows those steps as optional and says
  why. That is the only place the plan interprets a step rather than listing it.

## Model
```
plan_steps  (id, item_id → list_items, kind, title, due_on date null, done_at timestamptz null, done_by uuid null,
             source: 'college' | 'cycle' | 'suggested' | 'own', note text null, position)
```
- One row per step per list item. Steps come from three generators and the person's own additions (`own`).
- **`college`**: dates from the college's reported data for the round the item has chosen (`list_items.round`): the
  application deadline, notification date, reply date, housing deposit. Regenerated when the item's round changes or
  the college's data changes at a publish (the change record from [follow-colleges.md](follow-colleges.md) says which
  colleges to recompute). A step the person already marked done keeps its `done_at`; only `due_on` moves, and the
  change shows in the digest ("Stanford's regular decision deadline moved to Jan 5").
- **`cycle`**: the everyone dates from `data/application-cycle.json` that apply to this item (FAFSA opens, the
  college's aid forms, May 1 if the college uses it), once per student rather than once per college where they
  repeat (the FAFSA is one step, shown on every college's card as "shared").
- **`suggested`**: steps with no date, generated once when the item is added: visit (if the college has a visit link),
  follow on social media (listing the accounts the site knows), request information, check whether interest is
  considered, decide the round. Ticking the social step sets `list_items.follows_social`; ticking the visit step sets
  `visited_on` to that day; marking "applied" on the deadline step sets the item's status, so the tracking row from
  [household-hub.md](household-hub.md#display) and the plan are two views of the same facts.
- Steps are the list owner's; whoever can read the list reads them, whoever can edit it edits them, and `done_by`
  records a guardian's tick like any other edit ([saved-lists.md](saved-lists.md#rules)).

## Suggested steps
Generated per college in this order, each with a one-line reason and the college's own data where it exists:
1. **Decide the round** when the college offers early rounds: shows ED/EA/REA closing and notification dates side
   by side with the regular round, and the early-round share of admits once
   [early-decision-strategy.md](early-decision-strategy.md) is built. Due: six weeks before the earliest early deadline.
2. **Visit, or take the virtual tour** (the visit link). Says whether the college considers interest.
3. **Follow the admissions office**: the college's accounts, each a link, with "Instagram and TikTok are where
   admissions offices post deadline reminders" as the reason. One tick covers them all.
4. **Request information** from the admissions page link; also counts as interest where that is considered.
5. **Aid forms**: FAFSA (shared), CSS Profile if required, the college's own form if required, the noncustodial profile
   if required and the family said it applies (a question asked once, kept on the student's profile).
6. **Apply** by the chosen round's deadline; the fee and whether a waiver exists are shown beside it.
7. **Decision** on the notification date; marking it writes the outcome.
8. **Reply and deposit** by the reply date, with the housing deposit's amount and refund rule.
Nothing is generated for a college without the data (no invented dates), and the step says "the college hasn't
published this; add your own date" with a field.

## Display
- **The plan tab** on a person's page ([household-hub.md](household-hub.md#a-persons-page-householdperson)), beside
  List and Numbers: steps grouped **by month** with the college's crest on each, done steps collapsed, overdue ones at
  the top in the warning color, and a "This week" strip. A second grouping, **by college**, is one toggle away and is
  the one printed. Each step has its tick, its date with a ⓘ citing the edition, and the reason line.
- **On the list** each row shows its next step and date ("Apply by Jan 5", "Decision Mar 28") in place of the plain
  deadline line, so the list page needs no second look.
- **The parent's view** is the same tab, read-only unless they have edit access, with a summary line per student at
  the top of the household page: "Alex: 4 of 11 steps done, next Nov 1 (Michigan EA)". No scores, no grades, no
  judgment: counts and dates.
- **Nudges** go through the existing digest ([follow-colleges.md](follow-colleges.md#the-digest)) rather than a new
  email: a step due within seven days adds a line to the next digest, and a weekly digest goes out during the
  application season (October to May) even when no college's data changed, only to people with a step due. Text
  reminders to the phone collected in [household-hub.md](household-hub.md#adding-a-person) are a later addition
  behind explicit consent and a provider decision (Twilio is the likely one; cost is per message, so reminders
  would be weekly at most).
- Phones: the month grouping is a single column; the college grouping is a stack of cards.

## Rules
- Every date names its source and edition; a date the person typed says "your date".
- The plan never says a step is required when the college's data says otherwise, and never suggests a step as a way
  to improve chances where the college says interest isn't considered.
- Steps for a college the student removed from the list go with it (cascade); done steps stay in the export.
- A guardian's own list ([household-hub.md](household-hub.md#one-list-per-person)) gets steps too, but only the
  `college` and `suggested` kinds; the shared aid-form steps belong to a student.

## Files (planned)
- `lib/plan-rules.ts` (pure: generators from a school record, a round, and the cycle file; month grouping; next-step
  selection), `lib/plans.ts` (server: read, tick, add own, regenerate), `data/application-cycle.json` with a schema
  check in `npm run verify`, migration `…_plan_steps.sql` with policies mirroring `list_items`,
  `components/plan/PlanBoard.tsx`, the Plan tab, the digest's step lines, `tests/plan-rules.test.mts` (every
  generator against a college with full data, one with none, a round change that moves a date but keeps a tick).

## Open questions
1. Should a step the person adds themselves be free text only, or pick from the suggested kinds? Recommendation:
   free text with a date; kinds are the site's vocabulary, not the family's.
2. When a college's deadline changes after the student marked "applied", say nothing (they're done) or note it?
   Recommendation: nothing; the digest line is for people still ahead of the date.
3. Counselors ([counselor-portal.md](counselor-portal.md)) will want the same plan across a caseload; the model above
   doesn't prevent it, and nothing here should be built in a way that does.
