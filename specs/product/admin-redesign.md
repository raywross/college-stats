# Admin Console Redesign: The Steward in Charge, Three Doors, Plain Words, a Phone That Works

> Status: **planned**. Written 2026-11-08 from the owner's review of the console ("hard to use and see what I'm looking
> at") and a read of every admin screen. The console as built is in [admin.md](admin.md), [admin-console-ui.md](admin-console-ui.md),
> [admin-jobs.md](admin-jobs.md), [admin-health-views.md](admin-health-views.md), and the Data section's specs
> ([data-steward.md](data-steward.md), [data-platform/change-sets.md](../data-platform/change-sets.md)). This spec
> keeps every function of those and changes how they are arranged, named, explained, and laid out on a phone. Part of
> [product](README.md).

## Goal

The owner's words (2026-11-08): the Data Steward "should really be the primary feature. The idea of the steward is that
it's an agentic manager of all the data on the site. It should be used to review the output of all of our jobs, flag
issues, repair things that it can, and make recommendations for the human in the loop. For the other functions, there
are important management features around users and households and organizations. And finally there are some things
just to review the data, some of which is hidden on the site." And: "everything should be simple and self-explanatory.
Where there are areas of complexity, there should be info icons to get more detailed information. Also, make sure there
is a good phone version of all the functionality."

So the console becomes three doors and a home:

| Door | For | Today's screens that move here |
|---|---|---|
| **Steward** (the home) | What needs a person, what the Steward did, how every job went | Issues, Proposals, To do, Decisions, Audits, Jobs, Operations, Holds (folded in) |
| **People** | Accounts, families, counselors | People, Households, Organizations, a student record, a person, an organization |
| **Data** | Looking at what the site holds, including what it hides | Colleges (a college, Edit, Review), Health, Selectivity, Essays, Reference, Change sets, Snapshots, a high school |
| **Settings** (behind More) | Who is an admin, switches, the log | Who is an admin, Settings, Log |

## What is wrong today

Found by reading every screen (2026-11-08):

1. **Fourteen entries in the rail, no order to them.** People, Households, Organizations, Colleges, Health, Operations,
   Essays, Jobs, Log, then Data, Who is an admin, Settings below a line. Data, the largest section with nine screens
   of its own, is a footnote link. The Steward, the owner's primary feature, is five screens deep inside it.
2. **The same decision on three screens.** Accept, Reject, and Leave on a review item exist on Holds (flat), Issues (by
   cause), and a college's Review page (by college). A proposal's rows can be ticked on the proposal and on the Review
   page. Health and Health/Files are one table split by a legacy bookmark. Change sets' Revert and Snapshots' Point back
   here are two undo mechanisms explained in two places.
3. **The console speaks the code's language.** "Change set", "snapshot", "manifest", "cluster", a cause key shown raw as
   `unit|edition|code`, field codes like `C7` with no name, `school_course_counts` as a label, raw JSON key dumps for a
   student's numbers and offers, a run's report in a `<pre>`, "hysteresis" and "evidence factor" on the college page.
   Nothing explains itself: the only help text is a subtitle sentence per page and native `title` tooltips on a few
   cells.
4. **The home page is counts and a log.** Eight tiles (People, Households, Paused, Admins, Visit events hosts read) and
   eight log rows. It does not say what needs the admin today.
5. **Jobs and the Steward do not know each other.** Jobs lists eighteen jobs and their last outcome. The Steward reads
   one of them (the college-reported pipeline, through its review queue). A failed digest run, a visit-events reader that
   read nothing, an identity refresh that changed 300 colors: each is a red chip in a table nobody opens.
6. **Phones get a swipe strip and sideways tables.** The rail becomes one scrolling row of fourteen labels with the hints
   hidden. Eleven tables carry `min-w-[48rem]` to `min-w-[64rem]` and scroll sideways: the Review page at 64rem is the
   widest. The reference editor is a 34rem-tall raw JSON textarea. Actions on a person or household sit below nine
   panels, reached by a "Jump to actions" link.
7. **Dangerous actions are gated unevenly.** Delete account, Remove from household, Delete a record, Revert, and Point
   back here require a typed word; Grant admin, Revoke admin, Close household, Deactivate, Publish now, and Approve a
   systemic proposal do not.
8. **Duplicate anchors and dead ends.** Two panels with `id="views"` on a person's page; `/admin/mfa` reachable only by
   bookmark and saying "you are past this".

## Principles

- **One question per screen.** A screen answers one question an admin asks; the answer leads with the thing to do.
- **Words, not keys.** Every internal identifier gets a name beside it or is hidden behind Details. Codes read "C7, class
  rank". Collections read "college-reported values". A change set is "a change" and a snapshot is "a published version".
- **Every panel explains itself.** Each panel title carries an info icon whose pop-over says what the panel shows, where
  the data comes from, and what the admin can do here, in two or three sentences, with a link to a longer note on the
  console's Help page. Every chip or status word that is not plain English has one too.
- **The Steward goes first, a person decides.** Anything the Steward can check, it checks before the admin sees it; the
  console shows its reading and its recommendation beside every item. Nothing changes the site without an admin's act or
  an approved rule.
- **One decision, one place.** A review item is decided on the college's Review page or on its proposal, and the two
  are the same rows. Holds as a screen goes away.
- **A phone is a first-class console.** The 44 px rule, a bottom tab bar, card lists instead of tables below `md`, actions
  at the top of a record, and no element wider than the screen ([mobile.md](../mobile.md)). Checked at 390 px.
- **Dangerous things are typed.** One rule: an action that removes access, deletes, reverts, publishes, or changes who is
  an admin requires the typed word. The same `ConfirmTyped` everywhere.

## The shell

### Navigation

From `lg`, a left rail with four groups and their screens, every screen visible (no second-level navigation to
discover):

```
Steward            People              Data                 More
  Inbox              People              Colleges             Who is an admin
  Findings           Households          Health               Settings
  Proposals          Organizations       Selectivity          Log
  To do                                  Essays               Help
  Decisions                              Reference
  Audits                                 Changes
  Jobs                                   Published versions
  Runs
```

Below `lg`, a **bottom tab bar** with four tabs, Steward · People · Data · More, the pattern the site already uses
(`BottomNav`), replacing the swipe strip. Each tab opens its door's landing page, which lists its screens as a card
list with one line each. The site's own tab bar is hidden under `/admin`, since its five tabs are for visitors. The
header stays (logo, avatar menu).

The global search stays at the top of the rail and in the People tab's header; it also reaches the People door's search
from the Steward home. It still takes anything (a name, an email, a college, a unit id, a UUID).

### The home: Steward › Inbox

`/admin` is the Steward's Inbox: **what needs you**, in order of consequence, then **what the Steward did**, then **how
things are**. It replaces the counts page.

| Block | Shows | Each row |
|---|---|---|
| **Needs you** | Decisions waiting; proposals open, systemic first; To do rows by reach; jobs whose last run failed or was flagged; accounts being deleted inside the 30 days; invitations waiting past 7 days | one line, what it is and why it matters, one primary action ("Decide", "Review", "Open") |
| **The Steward did** | The last run of each mode (run, audit, job review) with spend, what it wrote, and what it fixed itself | links to Runs |
| **How things are** | Six tiles: published version (when, how many colleges), review queue open and its trend over 7 days, data health (fresh / stale / failing colleges), jobs (ok / failed in 7 days), people (accounts, households, organizations), spend this week against the $40 budget | each a link into its door |

An empty Needs you reads "Nothing needs you. The Steward last looked at {time}." The page is the same on a phone with
the tiles two across.

### Info icons and the Help page

A new `components/admin/HelpTip.tsx`, built like `InfoTip` on the base-ui Popover (hover, focus, and tap), reading an
admin glossary `lib/admin/help.ts`: `{ key, title, short, long?, do?, see? }`. `short` is the two or three sentences in
the pop-over; `do` is what the admin can do here; `see` links to the spec section on GitHub for the curious. Every
`Panel` gains an optional `help` key that puts the icon after the title; every `StatusChip` with a non-obvious word
gains one. `/admin/help` lists every entry by door (the `long` text), searchable, and is the target of the pop-over's
"More". The public glossary stays separate: these are the console's own words.

The first entries, one per word the survey found unexplained: published version, change, held, review item, finding,
cause, proposal (value, systemic), decision, audit, reach, edition, field code, hidden value, selectivity pool,
percentile and reading, evidence, data health (fresh, watch, stale, failing), core and supporting input, job, run,
trigger, housekeeping run, hand read, cycle, seat, managed record, role hint, join code, ask, second factor.

### Words that change

| Today | Becomes | Why |
|---|---|---|
| Change sets | **Changes** | "a change to the data, from a run or a person" |
| Snapshots | **Published versions** | what a visitor sees is one of these |
| Holds (screen) | gone; **held** stays as a word on a change | one decision, one place |
| Issues | **Findings** | the Steward found it; an "issue" sounds like a ticket |
| Cause key `unit|edition|code` | the college's name, the edition, "C7, class rank"; the key under Details | words, not keys |
| `C7` | **C7, class rank** everywhere a code shows (`lib/cds-sections.ts` has the names) | |
| Point back here | **Make this the live version** | says what it does |
| Revert | **Undo this change** | |
| Who is an admin | **Admins** | |
| Operations | gone; Start a run becomes **Run now** on each job's page | |
| Approvals (open pull requests) | gone from the console; the Jobs door links to GitHub's pull requests | code changes are reviewed on GitHub |
| Data health › Files view | **Sources** tab on the same Health page | |
| "Visit events, hosts read" tile | a job like any other, under Jobs, flagged by the Steward | |
| Pretend today | **Test date** with its note | |

## Steward

### What the Steward reviews, after this spec

Today the Steward clusters the review queue, verifies against documents, proposes, audits published grids, and answers
questions ([data-steward.md](data-steward.md) "What a run does"). This spec adds a fourth standing duty, **job review**,
so that the Steward is the one reader of every job's outcome:

- **After every job run**, a cheap pass (Haiku 4.5, no documents, capped at $0.10 a run and $3 a week in all, inside the
  weekly $40) reads the run's record: for a Vercel job the `job_runs` row (status, duration, the handler's summary),
  for an Actions job the workflow run's conclusion, step outcomes, and the change sets it wrote. It compares them with
  the job's **expectations**, a new field on the registry (`lib/jobs/registry.ts`): the usual duration range, which
  summary counts should be above zero on a scheduled run, whether the run should have written a change, and the
  conditions under which "nothing" is right (a collect firing with no open batches; a digest day with nothing changed).
- **It writes a finding** when a run failed, ran outside its range, wrote nothing it should have, or wrote far more than
  usual (an identity refresh that changed 300 brand colors), with the evidence quoted from the record, in
  `steward.issues` with `kind: "job"` and `family: <job id>`. The Jobs list shows the Steward's reading beside each run
  ("Looked fine", "Flagged: …"), and the Inbox lists the flagged ones under Needs you.
- **It repairs what the fixed tools allow**, and only those: start a failed idempotent job again, once, when its
  expectation says it is safe (every Vercel job with `withJobRun`, the publisher, identity refresh, visit events; never
  the college-reported pipeline, which spends money); ask the publisher for a version when a change was applied and no
  publish followed within its window; leave a finding on a change set when its report lists a check failure, so the
  held change reaches the Inbox. Each repair is logged as `steward.repair` and shown in The Steward did. Anything
  beyond these is a **proposal**, as today.
- **It summarizes the week** in the Sunday audit run: jobs that ran, failed, were repaired, were flagged, spend by
  mode, and the queue's trend, written to `steward.audits` with `family: "jobs"` and shown in Audits.

The Steward's run itself does not change: the same script, the same fixed tools, the same budget guard. The job-review
pass is a fifth mode, `review`, dispatched by the `steward.yml` workflow's existing `workflow_run` trigger widened to
every workflow, and by a new `after` hook in `withJobRun` that enqueues a dispatch (through the same GitHub App the
console uses) when a Vercel job finishes. Dispatches are collapsed: a run review for a job already reviewed in the last
10 minutes is skipped.

### The screens

| Screen | Question it answers | Shows | Do |
|---|---|---|---|
| **Inbox** `/admin` | What needs me? | above | the row's one action |
| **Findings** `/admin/steward/findings` | What has the Steward found? | the clusters of the review queue joined with their issue documents, plus job findings; by kind (value, systemic, acquisition, policy, job); each with its name in words, the count, the colleges, the Steward's hypothesis and status, and what it proposes | Leave with a reason; Ask the Steward to look (a run on this cause, with the budget shown) |
| **Proposals** `/admin/steward/proposals`, `/[key]` | What does the Steward want to change? | as today, systemic first; a proposal page with Summary, Evidence, Rows, Decide; the rows table becomes a card list on a phone with the tick, the field name, now → proposed, the quote | Approve (typed, every kind), Decline, Ask |
| **To do** `/admin/steward/todo` | What can only a person do? | as today, with the "why" in words and the page to open first | Found, No document, Done |
| **Decisions** `/admin/steward/decisions` | What policy is waiting on me? | as today; the clearest page in the console stays as it is | Decide |
| **Audits** `/admin/steward/audits` | Is what we publish right? | per family, the rate and the wrong values, plus the weekly jobs summary | open the college's Review page |
| **Jobs** `/admin/steward/jobs`, `/[job]`, `/[job]/runs/[run]` | Did everything run? | the Jobs pages as built, with a **Steward** column (its reading of the last run), **Run now** on the job's page (the Operations form, with the dispatch guard), and the job's expectations shown in words | Run now |
| **Runs** `/admin/steward/runs` | What did the Steward do, and what did it cost? | every `steward.runs` row: mode, cause, spend against budget, what it wrote and repaired; the week's total against $40 | Run the Steward (mode, budget, cause or college) |

A **college's Review page** stays at `/admin/colleges/[unit]/review` and is the one place a review item is decided
(Accept, Reject, Leave) beside a proposal's rows; Holds' filter by college and code becomes this page's filter. The
held change sets Holds also listed show under Changes with the **held** word and on the Inbox.

## People

One door, three lists, one search. People, Households, and Organizations keep their pages. What changes:

- **Records lead with actions.** On a person, a household, a student record, and an organization the actions move to
  the top of the page as a row of buttons (wrapping on a phone), each with its one-line consequence under it in the
  confirm sheet, not in the page. The nine panels follow, collapsed to their first line on a phone with "Show" per
  panel. The "Jump to actions" link goes.
- **Plain fields.** `KeyValues` dumps (a student's numbers, offers, snapshots, notification preferences) are rendered by
  a per-record formatter with the site's own labels (`lib/metrics.ts`, the profile's field names); unknown keys fall
  back to the words they are now, under Details.
- **One rule for danger.** Grant and Revoke admin, Close household, and Deactivate join the typed-word list.
- **Organizations get a search** like the other two lists.
- **The duplicate anchor** on a person's page is fixed (`#views` and `#viewed`).
- `/admin/mfa` becomes the **Second factor** panel on the admin's own entry on Admins (replace the authenticator from
  here, with the Supabase step spelled out) and the route redirects there.

## Data

Looking at what the site holds, including what it hides. Each screen is as built, with these changes:

- **Colleges** `/admin/data/colleges` is the search, Most viewed, and a **Health** summary strip. A college's page keeps
  its panels; the **Selectivity** panel leads with the tier and the one-line reason in words ("Ultra selective: admit
  rate 4%, SAT middle 1510–1570, yield 83%"), with the scoring table and the formula under Details, and each statistical
  word carries a help icon. **Edit** and **Review** stay as tabs. Edit's per-field rows become one card each on a
  phone, groups collapsed, as built.
- **Health** is one page with two tabs, **Colleges** and **Sources**, replacing `/admin/health` and `/admin/health/files`
  (both addresses keep working). The visit-events card leaves this page for Jobs.
- **Selectivity** keeps its five panels, each collapsed to its headline on a phone, with the Movers table as a card list.
- **Essays** stays as built: it is already phone-first.
- **Reference** gets a **form per document** where a validator exists (aid policies, state laws, guaranteed admission,
  the release calendar): one field per key, with the validator's message beside the field it names; the raw text stays
  under "Edit as text" for the rest. Versions and Undo as built.
- **Changes** `/admin/data/changes` (today's change sets) and **Published versions** `/admin/data/versions` (today's
  snapshots): the same tables as card lists on a phone; a change's page shows its report as a list of the counts and
  checks it contains, with the raw text under Details; the two undo actions are explained once, on the Help page, and
  each links to the other ("To undo a publish rather than one change, make an earlier version live").
- **A high school** `/admin/data/high-schools/[id]` shows the course table as "Courses the plan lists" and "Below the
  line" as two lists with the threshold stated in a sentence; the function names go.

## Settings (More)

Admins (with the Second factor panel), Settings (the two switches, each with its help icon, "Test date" instead of
"Pretend today"), Log (Target kind as words; the raw action code under Details), Help.

## Phones

- **Bottom tab bar** under `/admin` below `md`: Steward · People · Data · More, with a count badge on Steward for Needs
  you. The site's own tab bar is not shown there.
- **Tables become card lists** below `md`, one card per row, the row's primary fact as the title, two or three facts as
  a line, the actions as 44 px buttons. The ops components already do this (`EstimateInputsTable`, `HealthTable`,
  `SourceFilesTable`); the rule becomes every table in the console, through one `ResponsiveTable` component that takes
  the columns once and renders both. No `min-w-*` on a table under `/admin`.
- **Records**: actions first, panels collapsed to a first line with Show.
- **Forms**: full-width fields, one column, the confirm as a bottom sheet (`SheetDialog`).
- **Charts** (views, selectivity history): the mobile rule from [mobile.md](../mobile.md), bigger type, fewer labels.
- **Checked** at 390 × 844 on every screen in the QA pass, with the test from the mobile audit (no element wider than the
  viewport, no page scrolling sideways) run against each `/admin` route with a fixture.

## Model and files

- `lib/admin/console.ts`: `ADMIN_DOORS` (four doors, their screens, hints, help keys) replaces `ADMIN_SECTIONS`;
  `activeDoor()`, `activeScreen()`. Old routes redirect: `/admin/data/{issues,proposals,todo,decisions,audits}` →
  `/admin/steward/*`; `/admin/jobs/*` → `/admin/steward/jobs/*`; `/admin/operations` → `/admin/steward/jobs`;
  `/admin/data/holds` → `/admin/steward/findings`; `/admin/data/change-sets` → `/admin/data/changes`;
  `/admin/data/snapshots` → `/admin/data/versions`; `/admin/health/files` → `/admin/data/health?tab=sources`;
  `/admin/colleges/*` → `/admin/data/colleges/*`; `/admin/high-schools/*` → `/admin/data/high-schools/*`.
- `lib/admin/help.ts`: the console glossary; `components/admin/HelpTip.tsx`; `app/admin/help/page.tsx`.
- `components/admin/ResponsiveTable.tsx`; `components/admin/AdminTabBar.tsx`; `components/admin/RecordActions.tsx`.
- `lib/admin/inbox.ts`: the Needs you reads, pure over injected readers, tested.
- `lib/jobs/registry.ts`: `expects` per job; `lib/steward/job-review.ts`: the pure comparison of a run record with its
  expectations (tested on recorded runs); `scripts/lib/steward/review.mts`: the `review` mode; `steward.yml`: the
  widened `workflow_run` trigger and the mode; `lib/jobs/record.ts`: the after hook.
- No migration: findings and audits are `steward.*` documents as today; `steward.repair` is an `admin_log` action
  written through `steward.write` notes as the other Steward actions are.

## Build order

1. **Shell and words** (one unit, Opus): doors, rail, tab bar, redirects, the renames, the Help glossary with its first
   entries, HelpTip on every Panel, the Inbox with Needs you over today's data. Everything else still works at its new
   address.
2. **Phone pass** (one unit, Sonnet): `ResponsiveTable` and every table through it; records with actions first; the
   390 px check in tests.
3. **People** (one unit, Sonnet): plain fields, the typed rule, organization search, the anchor fix, the Second factor
   panel.
4. **Data** (one unit, Opus): Health as one page, the college page's Selectivity in words, Reference forms, Changes and
   Versions pages, the high school page.
5. **Steward job review** (one unit, Opus): expectations, the pure review, the `review` mode, the hooks, Jobs' Steward
   column, Runs, the weekly jobs summary.
6. **QA** (Sonnet): every screen at desktop and 390 px against a fixture; the owner's hand check of signed-in flows.

Units 2 to 5 run in parallel after 1. Each unit's spec section above is its brief.

## Tests

- `tests/admin-console.test.mts`: `ADMIN_DOORS` covers every `/admin` route; every old route redirects; every Panel in
  `app/admin/**` passes a `help` key that exists in the glossary (a grep test, as the telemetry registry test does).
- `tests/admin-inbox.test.mts`: Needs you over fixtures (a decision, a flagged job, a deletion inside 30 days, nothing).
- `tests/admin-phone.test.mts`: every `/admin` page rendered at 390 px against the mini fixture has no element wider
  than the viewport and no `min-w-*` table.
- `tests/steward-job-review.test.mts`: recorded run records against expectations: a failed run, a slow run, a run that
  wrote nothing on a day it should have, a collect firing that correctly did nothing, a repairable failure (one restart,
  then a finding), a non-repairable one (a finding only).
- The existing Steward, Jobs, People, and Data tests keep passing at the new routes.

## Owner decisions

Recommended defaults; the build proceeds on them unless the owner says otherwise.

1. **Four doors, the Steward's Inbox as the home.** Alternative: keep counts on the home and put the Inbox one click in.
2. **Holds and Operations disappear as screens.** Their actions live on the college's Review page and on each job's page.
   Alternative: keep Holds as a flat list for admins who like it.
3. **Open pull requests leave the console.** Code is reviewed on GitHub; the Jobs door links there.
4. **The renames** in the table above, in particular Changes and Published versions.
5. **The Steward's job review**: Haiku, $0.10 a run, $3 a week; repairs limited to one restart of an idempotent job, a
   publish request, and a finding on a held change. Alternative: findings only, no repairs, for the first month.
6. **The typed-word rule** extends to Grant and Revoke admin, Close household, Deactivate, Publish now, and Approve of a
   systemic proposal.
7. **The site's bottom tab bar is hidden under `/admin`** in favor of the console's own.

## Open questions

- Should the Inbox send a daily email to admins when Needs you is not empty, through the existing digest job? (Not in
  this build; a one-line addition to the weekly job once the Inbox exists.)
- Should the Steward's job review also read Vercel's own function logs for a failed cron, or only the `job_runs` row?
  (Only the row for now; the row carries the handler's error.)
- Which reference documents deserve a form first? (Those with validators; the release calendar is the one the owner
  edits most.)

## As built

### Unit 1: shell and words (2026-11-08, `feature/admin-redesign-shell`)

- **Doors.** `lib/admin/console.ts` exports `ADMIN_DOORS` (Steward, People, Data, More), `activeDoor()`,
  `activeScreen()`, and `doorByKey()`; `ADMIN_SECTIONS` is gone. A screen's `under` lists extra prefixes only
  (`/admin/students` under People, `/admin/data/high-schools` under Colleges); the Inbox (`/admin`) matches its own path
  only, and the longest matching href wins. An unknown `/admin/...` path falls to the Steward door with no screen.
  Each screen carries a `help` key.
- **Rail and tab bar.** `components/admin/AdminRail.tsx` shows from `md`: from `lg` every door with every screen and its
  hint, the search on top; from `md` to `lg` the doors with icons and the current door's screens. Below `md` it is
  hidden and `components/admin/AdminTabBar.tsx` (fixed, `h-(--tabbar-h)`, lucide ShieldCheck, Users, Database,
  Ellipsis) takes over; `components/layout/BottomNav.tsx` returns null under `/admin` after its hooks. The icons live
  in `components/admin/doorIcons.ts`. The count on the Steward tab and the Inbox entry is `needsYouCount()`
  (`lib/admin/inbox-reads.ts`), read by the layout on every console page, so it reads only the cheap sources
  (decisions, proposals, held changes, deletions, invitations); the jobs (a GitHub call per workflow) and To do are
  on the Inbox itself, so the badge can be lower than the Inbox's count.
- **Landings.** The Steward's is the Inbox. Data's (`/admin/data`) lists its screens as cards (`DoorScreens`) above
  the panels it had (Live on, The last publish with Publish now, Changes since the last publish, Held changes). More's
  is `/admin/more`. People's landing is the People list itself, with the door's screens as cards below `lg` (the rail
  lists them from `lg`); no separate `/admin/people` landing was added.
- **Moves and redirects.** Pages moved with `git mv`; Server Action files moved beside the screens that use them
  (`app/admin/steward/actions.ts`, `app/admin/steward/jobs/actions.ts`, `app/admin/admins/mfa-actions.ts`).
  `lib/admin/redirects.ts` `ADMIN_REDIRECTS: { from, to, query? }[]` (the optional `query` is the brief's shape plus a
  key a row must carry: `/admin/operations?unit=` and `/admin/data/holds?unit=` go to that college's Review page, the
  plain rows to Jobs and Findings), `nextAdminRedirects()` for `next.config.ts` (`permanent: false`), and
  `resolveAdminRedirect()` for the tests. `/admin/steward` redirects to `/admin`. The Health page's Sources tab is
  `app/admin/data/health/sources.tsx` (`SourcesView`), rendered by the page for `?tab=sources`; an old `?group=` or
  `?reason=` link to the Colleges tab goes to Sources, as it went to Files.
- **Operations** folded into each job's page: a **Run now** panel (`#run-now`) lists every `DISPATCHABLE_RUNS` row
  for the job's workflow that isn't `hidden` (college-reported shows its four), each with today's `RunForm` and the
  same dispatch guard (`blockingRun` over the workflow's last 30 runs, read by `loadRunNow()` in `lib/admin/ops.ts`);
  `?unit=` opens and fills the college run. The college page's Rerun link opens it. Operations' all-workflows Runs
  table went: each job's History has its runs. Approvals went: the Jobs list ends with "Open pull requests on
  GitHub"; the pull-request Server Actions stay in `app/admin/steward/jobs/actions.ts` (tested, unused by any screen).
  `verify` (which re-runs a pull request's CI) has no job, so no Run now.
- **Holds** folded in: the college Review page has a College filter (a name or id; it opens that college's Review
  page with the same field) and a Field filter (`?code=`, the options named with `codeLabel`); its item rows gained
  Holds' **Re-run discovery**. The essay reader's held records moved to the Essays page ("Held questions"). Held
  changes show on the Data landing, on Changes (the Held chip with its help icon), and first on the Inbox. Holds' flat
  cross-college list of review items went (one decision, one place); Findings groups them by cause.
- **Second factor** is the `#second-factor` panel on Admins with the Supabase steps written out; replacing the
  authenticator from the console itself was not built (it would be a new action).
- **Inbox.** `lib/admin/inbox.ts` (pure): `needsYou()`, `tiles()`, `nothingNeedsYou()`, `lastRunsByMode()`,
  `runWrote()`, `weeklySpend()`, `decisionAnchor()`. Severity 1: held changes, failed jobs; 2: decisions, systemic
  proposals, flagged jobs (for U5's review), deletions inside the 30 days; 3: value proposals, invitations waiting 7
  days or more, the 5 highest-reach open To do rows. Within a severity the oldest first; To do rows after the rest in
  reach order. Six tiles: Live version, Review queue (open and new in 7 days), Data health (fresh, watch, stale,
  failing), Jobs in the last 7 days (ok, failed), People (accounts, households, organizations), Steward spend in 7 days
  against $40. A read that fails is null: its rows are left out and its tile says "Couldn't read". The old home's
  Recent actions and counts (paused, managed students, admins, visit-events hosts) went; the log is under More.
- **Steward runs** (`/admin/steward/runs`) is a first version: the week's spend and every run's mode, spend, and what
  it wrote. Unit 5 extends it.
- **Help.** `lib/admin/help.ts` `HELP` (as const, satisfies `Record<string, HelpEntry>`), `HelpKey`, `isHelpKey()`,
  `helpEntry()`, `helpByDoor()`, `seeHref()`. `HelpEntry` gained an optional `door` for /admin/help's grouping (entries
  without one list under "Everywhere"). `components/admin/HelpTip.tsx`; `Panel`, `PageHeader`, and `StatusChip` take
  `help?: HelpKey`; every Panel and PageHeader under `app/admin` passes one. `/admin/help` lists every entry by door,
  searchable (`components/admin/HelpList.tsx`).
- **Words.** `lib/admin/words.ts`: `WORDS`, `codeLabel()`, `codeName()`, `cdsItem()`, `itemKeyLabel()`,
  `editionLabel()`, `collectionLabel()` (`COLLECTION_WORDS`), `changeKindLabel()`, `targetKindLabel()`. The item names
  are `CDS_ITEM_NAMES` and `CDS_SECTION_NAMES` in `lib/cds-sections.ts`, the template's headings shortened: C7 is
  "admission factors" and C10 "class rank" (the spec's "C7, class rank" example names the C7 row, not the item).
  Applied: Changes, Change #N, In published version N, Undone by, Undo this change, Published versions, Version N,
  Make this the live version, Restore version N, Findings, Admins, Test date, a change's collections in words, log
  target kinds in words with the raw action under Details, the Review page's field headings, a proposal's field
  codes, a rejection's message. A proposal's key and cause moved under Details. The typed words did not change
  (`revert` still undoes a change), since this unit changes no action.

#### Left for the next units

- Health keeps two code paths in one route: the Colleges tab (`page.tsx`) and the Sources tab (`sources.tsx`); Unit 4
  merges them properly.
- Tables keep their sideways scroll until Unit 2's `ResponsiveTable`; record pages keep their action layout for Unit 2
  and Unit 3; the typed-word rule's new words are Units 3 and 4's.
