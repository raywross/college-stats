# Admin Console Redesign: The Steward in Charge, Three Doors, Plain Words, a Phone That Works

> Status: **built** 2026-11-08 (#226; see [As built](#as-built)). Written 2026-11-08 from the owner's review of the console ("hard to use and see what I'm looking
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

### Unit 4: Data (2026-11-08, `feature/admin-redesign-data`)

- **Health, one code path.** `app/admin/data/health/page.tsx` checks the admin, reads the tab, and renders the one
  header and tab bar; `collegesTab()` and `sourcesTab()` in the same file fill the body (`sources.tsx` is gone), with
  one `Showing` line and one `Pager` between them. `lib/admin/health-tabs.ts` (pure): `healthTab()`, `healthTabHref()`,
  `HEALTH_TABS`, `HEALTH_BASE`, `SHARED_HEALTH_FILTERS`. A tab's link keeps the filters both tabs read (status, state,
  tier, family, sort, each only when the other tab understands its value) and drops the ones only one tab has (the
  Colleges tab's `input`; the Sources tab's `group`, `reason`, `unjudged`, and the queue sort) and the page.
  `HealthTabs` takes the two links. The old addresses keep their query strings through the redirects (tested). The
  visit-events card stays on the Sources tab: moving it to Jobs is Unit 5's ground (`app/admin/steward/**`).
- **Selectivity in words.** `lib/admin/selectivity-words.ts` (pure): `tierSentence()`, `reasonInputs()`,
  `inputWords()`, `poolTier()`, `REASON_INPUTS`, `THIN_EVIDENCE`. The sentence is the stored tier (or the plain
  cutoffs' when none is stored), then the admit rate and the two other reported inputs that weigh most in the score,
  in the method's order ("Ultra selective: admit rate 4%, SAT, 75th percentile 1570, yield 83%."); a filled input is
  never a reason. Clauses follow when they apply: a tier the band kept ("kept from the last publish; the score alone
  reads …"), an evidence factor under 0.9 ("pulled toward the middle by a small admitted class"), and a pool in
  another tier ("in-state applicants: Highly selective"). The admit rate is always named: the first fixture run showed
  a college whose rate weighed least, and the sentence read wrong without it. The pools' tables, the top band, and the
  formula are under one `<details>Details</details>`; the citations stay outside it. Help icons on pool, percentile,
  reading, evidence, hysteresis, and top band; the panel's own key is `selectivity-tier`.
- **Reference forms.** `lib/admin/reference-form.ts` (pure, client-safe): `FORM_REFERENCES` (aid-policies, state-laws,
  guaranteed-admission, calendar), `hasForm()`, `referenceFields()`, `fieldList()`, `parseFieldList()`,
  `formToBody()`, `problemsByField()`, `keyLabel()`, `fieldName()`. One field per top-level key: a line for a short
  string, a box for a long one, a number, yes/no, and the key's JSON in a smaller box for a list or object. The form
  posts `kind=form` with the field list; `saveReference` puts the body together with `formToBody` and then runs the
  same validator and the same `admin_data_set_reference` call as the textarea; a refusal now also carries the
  messages one by one (`ReferenceActionState.problems`), and the editor places each beside the key it names (a quoted
  key, the key after the document's name, an entry of the document's one list, or the key named as a word; anything
  else above the form). "Edit as text" switches to today's textarea (unsaved form edits don't carry over). The
  release calendar has no validator in `lib/reference-validators.ts`; it gets the form (the owner edits it most) with
  only the generic check. Writing a calendar validator was left out: the publisher's reference gate runs the same
  dispatch, so a new validator would also gate publishes.
- **Changes and Versions.** `lib/admin/report-words.ts` (pure): `reportLines()`, `reportTally()`, `plainText()`,
  `REPORT_MAX_ROWS`, `ReportLine`. A change's report reads as headings, counts (two-column tables with no header
  words, labelled bullets), checks (a blockquote, "Tripped"/"Not tripped", ticked boxes, the lines under a heading
  that names checks; ok, failed, or noted), rows of the wider tables (20 per table, then one "more" line), and notes.
  A check's detail is its first sentence, so the breaker's constant and file names stay in the raw text.
  `components/admin/ChangeReport.tsx` renders the list (each check's outcome as a word and an icon) with the raw text
  under Details, in its own **Report** panel. Undo this change carries "To undo a whole publish rather than this one
  change, make an earlier published version live" (a link to Published versions); the Versions page carries "To undo
  one change rather than a whole publish, open it on Changes and use Undo this change". The actions' messages say
  change, published version, and undo (no "change set", "snapshot", "revert" on screen).
- **A high school.** "Courses students list" holds two lists, **Courses the plan lists** and **Below the line**, each a
  course's name and its students, with the threshold in one sentence; the course keys and the function and table
  names left the screen.
- **Typed words.** `CONFIRM_PUBLISH` ("publish") and `CONFIRM_APPROVE` ("approve") in `lib/admin/console.ts`;
  `lib/admin/steward-actions.ts` re-exports the latter and `TYPED_KINDS` gains `systemic`. `publishNow(deps, form)`
  refuses without the word before anything is logged or sent; `approveProposal` refuses a systemic Approve without it
  before anything is written. The Data landing's Publish now and the systemic proposal's Approve open the typed sheet.
- **Help.** New Data entries: `selectivity-tier`, `hysteresis`, `top-band`, `selectivity-movers`, `tier-counts`,
  `method-log`, `change-report`, `change-actions`, `documents-touched`, `reference-versions`, `reference-form`,
  `course-counts`, `course-offering`, `health-sources`; the panels that shared a generic key now use them.
- **Tables touched** (for Unit 2): the Selectivity pool table on a college page (moved under Details, help icons in two
  headers; markup otherwise as it was); the high school's course table (replaced by two lists, so there is no table
  left to convert). The Health tables, Changes, Versions (`SnapshotsTable`), and the Selectivity screen's tables are
  unchanged.
- Tests: `tests/admin-redesign-data.test.mts` (the four pure modules, the form's save, Health's one path and tabs, the
  old addresses, the pages' words); the typed words' refusals in `tests/admin-data.test.mts` and
  `tests/admin-steward.test.mts`; the Sources tab's render test in `tests/admin-ops.test.mts` now renders the page.

### Unit 3: People (2026-11-08, `feature/admin-redesign-people`)

- **Plain fields.** `lib/admin/record-words.ts` (pure, tested): `studentNumbers()`, `offers()`, `snapshot()`, and
  `notificationPrefs()`, each returning `{ fields: {label, value}[]; details: Record<string, unknown> }` — the labels
  come from the site's own words (`/me`'s groups for a profile, `lib/planner/offers.ts`'s `COA_LABELS`/`GIFT_LABELS`/
  `LOAN_LABELS`/`usd()` for an offer, `lib/chances/levels.ts`'s `STANDING_LEVEL_LABELS` for a snapshot's estimate, and
  the names `/account` and the unsubscribe pages use for a notification switch). Long lists (courses, activities,
  awards, connections, recommenders) show as a count, not a dump. `components/admin/RecordFields.tsx` renders the
  result: `<Fields>` for what it knows, `<details>Details</details>` (still `KeyValues`) for what's left over. Wired
  into the student record's Numbers and Snapshots, the plan's Offers, and a person's Notifications; `KeyValues` on
  these pages now appears only inside a `<details>`.
- **The typed-word rule.** `lib/admin/console.ts` gained `CONFIRM_GRANT` ("grant"), `CONFIRM_REVOKE` ("revoke"),
  `CONFIRM_CLOSE_HOUSEHOLD` ("close"), and `CONFIRM_DEACTIVATE` ("pause"), beside `CONFIRM_DELETE`. Grant admin and
  Revoke admin (`app/admin/admins/page.tsx`) and Close household (`app/admin/households/[id]/page.tsx`) now use
  `ConfirmTyped`; Deactivate (`app/admin/people/[user]/page.tsx`) keeps its required typed reason and gains the typed
  word on top. Each Server Action (`app/admin/admins/actions.ts`, `app/admin/households/[id]/actions.ts`,
  `app/admin/people/actions.ts`) checks `typedMatches(form.get("confirm"), ...)` again before calling its database
  function, exactly as the delete actions do; `tests/admin-console-ui.test.mts` shows each one refused with no
  database call when the word is missing or wrong.
- **Organizations search.** `lib/admin/organizations.ts`'s `listOrganizations(q, page)` takes a search term (the
  organization's name, its join code, its high school id, or a member's name), matched in code since there's still no
  `admin_list_organizations()` and the count stays small; `app/admin/organizations/page.tsx` gained the same
  `AdminSearch` box Households uses, and one match redirects straight to the organization's page.
- **The duplicate anchor.** A person's page had two `id="views"` panels (Colleges viewed, and Who viewed their data).
  Colleges viewed keeps `#views` (every existing link points there); Who viewed their data is now `#viewed`.
- **Help.** Every People word the brief listed (seat, managed record, role hint, join code, ask, second factor,
  paused, deleting) already had an entry in `lib/admin/help.ts` from Unit 1's shell pass, each already wired to the
  panel that uses it (Households' "Who is in it" carries `help="seat"`, "Add a student" carries `help="managed-
  record"`, Admins' second-factor panel carries `help="second-factor"`, and so on); no new People entries were
  needed. `StatusChip`'s own rule (its help icon is for a word that isn't plain English, like Held or Stale) is why
  Paused and Deleting, whose chips read as plain English, don't carry an inline tip even though their glossary
  entries exist for `/admin/help` and anything that links to them.

#### Left for the next units

- Panel and table markup on the People pages is unchanged (U2's `ResponsiveTable` and `RecordActions` land on top of
  this); the new `RecordFieldsView` sits inside the existing panel shape so U2 can fold it into the phone layout
  without re-deriving the fields.
- Offers, snapshots, and notification preferences are formatted from whatever shape the row actually has (defensive
  `typeof` checks, not the strict `StudentProfileData`/`PlanOffer` types), since the admin console reads these tables
  directly rather than through the sanitizers the family-facing forms use; a key the formatter doesn't recognize is
  never hidden, only pushed into Details.

### Unit 5: Steward job review (2026-11-08, `feature/admin-redesign-jobs2`)

- **Expectations.** Every job in `lib/jobs/registry.ts` has `expects: JobExpectations` (tested, with each GitHub
  job's `nonzero` names checked against its workflow's step names). Restartable: the four Vercel jobs that can't send
  twice (digests, visit alerts, interest confirmations, day-before texts), identity refresh, visit events, and the
  publisher. Not restartable: Weekly emails and texts (no sent-this-week record, so a rerun emails every student again),
  college-reported (spends money), the Steward, and every hand-run workflow. The job's page shows them in sentences
  under "What the Steward expects" (`expectationLines`).
- **The review** (`lib/steward/job-review.ts`, pure). Rules in order: failed → `failed`; cancelled or still running →
  flagged; past the longest usual duration → flagged; a scheduled run with no `nonzero` work → flagged unless nothing
  is right for that firing (a housekeeping firing, a firing out of its season, or the job's `nothingOkWhen` when it has
  no shaped firings); a run that worked and should have written a change but wrote none → flagged; a held change →
  flagged. A run started by hand or by another workflow isn't held to `nonzero`. Repairs, the first that applies:
  `hold-finding`, then `restart` (restartable and no carried-out restart of the job in 24 hours, read from the job's
  reviews), then `publish` (an applied change with a failed "Ask for a snapshot" step, or two hours with no publish;
  never for the publisher itself; a publish that can't be read isn't assumed missing).
- **The script.** `scripts/steward.mts --mode review --job <id> --run <ref>` (plus `--run-file` for a recorded run, the
  dry runs' way in). It skips a run already reviewed before opening anything; a housekeeping firing that looked fine is
  not written (the half-hourly collect would fill the collection); a fine review writes only `steward.reviews` and
  leaves no `steward.runs` row (it spent nothing), so the Runs page lists flagged and failed reviews only. The note is one
  Haiku 4.5 call with a $0.10 budget cut by the week's $3 for reviews and the week's $40 (`reviewBudget`); without the
  API key or past the cap the review is written with no note. The finding is one `steward.issues` document per job
  (`job|<job id>`, kind `job`, `family` the job id) whose findings keep the last 20 flagged or failed runs' lines; a held
  change gets its own (`change|<id>`). The repair tools are `dispatch_workflow` (an allowlist: the restartable GitHub
  jobs' own workflows and `publish-snapshot.yml`; `dispatchRefusal` refuses anything else) and a POST to a restartable
  Vercel job's own route with `CRON_SECRET` and `SITE_URL` (both optional in the workflow; without them the restart is
  recorded as wanted and not done). Each repair is a `steward.repair: …` line in the writer's notes, kept on the review's
  change set summary. The Sunday audit run also writes `jobs-<run>` (`AuditDoc.family: "jobs"`, `jobs: JobsWeek`), shown
  on Audits as its own panel.
- **The workflow.** `steward.yml`'s `workflow_run` lists the six scheduled workflows by name (the Steward's own is left
  out so it never triggers itself); a new `review` job maps the completed workflow's file to its job id and runs
  `--mode review`; college-reported keeps the `steward` job's run path too, and its idle half-hourly collect is skipped
  before checkout. `workflow_dispatch` gained `review` and the `job` and `run` inputs. The `steward` concurrency group
  moved from the workflow onto the `steward` job, so a review never waits behind a 90-minute run. The review job has
  `actions: write` (for its two dispatches) and reads `CRON_SECRET`; tests/steward-workflow.test.mts keeps the list and
  the case map in step with the registry.
- **The after hook.** `withJobRun` takes `deps.afterFinish`; the default (only with the real recorder) is
  `lib/jobs/review-dispatch.ts` `requestReview`: a `workflow_dispatch` of `steward.yml` through `lib/github-app.ts`,
  nothing without credentials, collapsed when another run of the same job finished in the last 10 minutes, never
  throwing into the job's answer.
- **Console.** The Jobs list's Steward column (`StewardCell`: the verdict chip with its help, the note or first reason,
  the repair, and a line when the review is of an earlier run); a run's page opens with "The Steward's reading";
  `/admin/steward/runs` lists every Steward run with its kind, spend against budget, repairs, and the week's total by
  kind, with the reviews' own $3; Findings lists job findings in their own panel (kind Job); the Inbox's job rows read
  the review's verdict when the last run has one (`inboxJob`, now in the pure `lib/admin/inbox.ts`): flagged stays
  flagged, a fine review never hides a failed run, a review of an earlier run doesn't decide. Help entries: `review`,
  `verdict`, `repair`, `expectation`.
- **Tests.** `tests/steward-job-review.test.mts` runs the six recorded cases in `tests/fixtures/steward/review/` (plus
  the second half of the repairable failure), the review mode as dry runs over a file store with the notes in
  `tests/fixtures/steward/answers/` (written for the fixtures, marked so in each answer's `note`), the repairs, the
  budget, the weekly summary, the dispatch, the after hook, and the Inbox mapping; `tests/jobs-pages.test.mts` renders
  the Steward column and a run's review.

#### Left for later

- No migration: `steward.reviews` is a new collection of `data_documents`. The workflow change needs no new secret;
  `CRON_SECRET` (already a secret) and a `SITE_URL` repository variable are optional for restarting a Vercel job.
- Reviews of the Steward's own runs: by hand only (`--job data-steward`), never from `workflow_run`.
### Phone pass (U2)

- **`ResponsiveTable`** (`components/admin/ResponsiveTable.tsx`, a Server Component): a `<table>` from `md`, one card per
  row below it (`title` column as the heading, `fact` columns as one wrapped "Header: value" line, `actions` as a row of
  44 px buttons, `detail` columns inside `<details>Details</details>`). A column's `help` puts the (i) icon beside its
  header. Every table in `app/admin/**` and `components/admin/**` goes through it, including the ones U3 and U4 added
  (both Health tabs, Selectivity movers and counts, Changes, Versions, history, the high school course lists, the views
  pages, Jobs and runs, Review, Proposals, To do, Findings clusters); the ops tables' hand-rolled table-plus-card pairs
  are gone. The one `<table>` left outside it is the visually hidden copy of a chart's numbers in `ViewCharts.tsx`
  (`sr-only`), which a screen reader needs and a sighted phone user never sees.
- **`RecordActions`** (`components/admin/RecordActions.tsx`): a wrapping row of 44 px buttons at the top of a person,
  household, student record, organization and college page. Each child is an `AdminForm` or `ConfirmTyped` passed `sheet`,
  so below `md` its form opens in a `SheetDialog`. The side "Actions" columns are gone. An organization has no write
  action yet, so its row holds two links (the owner's account, All organizations).
- **`Collapsible`** and `Panel`'s `collapse` prop: `collapse="First line"` folds the panel's body to that line with
  Show/Hide below `md` and leaves it open from `md` (matchMedia, as `FieldEditor`'s `usePhone`). Used on the secondary
  panels of the person, student, organization and college pages; the primary panels stay open.
- **One column below `md`**: form grids (log filters, Review filters, person picker, essay prompts form) open at `md`,
  not `sm`.
- **No minimum widths**: no `min-w-<size>` class under `app/admin/**` or `components/admin/**` (the count badges and
  health counts that carried one now size by padding). `min-w-0`, which lets a flex child shrink and sets no width, is
  allowed. `tests/admin-phone.test.mts` guards this, the `<table>` rule, the five RecordActions pages and the form
  breakpoints; the render tests use `tests/fixtures/responsive-table-fake.mjs` for the table.
- The high school page shows a course by name only; the course key no longer appears on screen.

### Polish (QA follow-ups) (2026-11-08, `feature/admin-redesign-polish`)

- **Typed words follow the renames.** Make this the live version now asks for `live` (`CONFIRM_MAKE_LIVE`), Undo
  this change for `undo` (`CONFIRM_UNDO`), and a reference document's Restore version N for `restore`
  (`CONFIRM_RESTORE`), all in `lib/admin/console.ts`; `CONFIRM_POINT_BACK` and `CONFIRM_REVERT` are gone. The
  Server Actions re-check the new words and refuse the old ones (`tests/admin-data.test.mts`,
  `tests/admin-reference.test.mts`). This replaces Unit 1's "the typed words did not change".
