# Admin Console: People, Hidden Values, Data Health, and Operations

> Status: **built** 2026-10-13 (planned 2026-10-12; People, Health, Operations, Log, Admins built 2026-10-12; the
> Colleges and high-school pages and the student standing panel 2026-10-13, after PR #136; see
> [As built](#as-built-2026-10-12)). Planned from the owner's request: see and search users and households; deactivate or delete
> accounts; reset passwords; change account details such as email; link and unlink students and parents; see the
> values the site hides for a college and for a student's standing; see each college's data "health" by when its data
> was received; and, longer term, trigger reruns and approve data changes from the same place. Builds on
> [accounts.md](accounts.md) and [household-hub.md](household-hub.md), reads the admission-chances specs
> ([../chances/README.md](../chances/README.md)), and extends the one-admin-function rule in
> [../supabase.md](../supabase.md#edge-functions). Part of [product](README.md).

## Goal
One signed-in place, `/admin`, where the owner (and later a support person) can answer "what is going on with this
family's account", fix it, and leave a record; can see what the site computes but never shows (a college's
selectivity index, a student's hidden odds); can see which colleges have fresh data, which are going stale, and which
the pipeline keeps failing on; and can start a rerun or approve a data change without opening GitHub.

Three rules carry through every part:
1. **No new admin power on Vercel.** The secret key stays out of the site ([supabase.md](../supabase.md#keys)); an
   admin acts through policies and functions that check `is_admin()`, and through one small Edge Function for the
   Auth calls that need the secret key, like `invite-user` today.
2. **Every admin action is logged**, and a student whose data an admin looks at sees it in "Who viewed your
   information", the same as when a guardian looks ([accounts.md](accounts.md#privacy-model)).
3. **Reversible by default.** Deactivate before delete; delete is the same 30-day soft delete a person gets; "delete
   now" and unlink are the only actions that need a typed confirmation.

## Research and decisions (2026-10-12)

### Who is an admin
- `profiles.role_hint` is set by the person on their own profile form, so it cannot carry admin rights. A new table,
  `admins (user_id, granted_by, granted_at, revoked_at, note)`, holds the list. The first row is inserted in the SQL
  Editor (dev first, then prod); later rows come from the console's **Admins** page, which an existing admin uses.
- `is_admin()` is a security-definer function (`stable`, `search_path = ''`) that returns true when `auth.uid()` has
  an unrevoked row **and** the session's authenticator assurance level is `aal2` (`auth.jwt() ->> 'aal'`). Supabase
  Auth's TOTP MFA is free on every plan; the console's sign-in asks for the second factor
  (`supabase.auth.mfa.challengeAndVerify`) when the session is `aal1`, and the owner enrolls once from `/admin`.
  Recommended because an admin session can read every family's data; a leaked password alone must not be enough.
- The console itself (`app/admin/**`) calls `requireAdmin()` (`lib/admin/auth.ts`), which checks the same two things
  in the app, so a non-admin gets a 404 (not a 403: the route's existence is not advertised). Every policy and
  function checks `is_admin()` again on the database side, so the app check is a convenience, never the guard.

### How admin power reaches the site without the secret key
| Need | How | Why |
|---|---|---|
| Read every profile, household, student, list, plan, snapshot | Add an `is_admin()` select policy to each people table (one migration, listed in [Model](#model)) | Reads go through the admin's own session; RLS stays the guard, as everywhere |
| Change profile and student details, link and unlink, soft delete, restore | Security-definer `admin_*()` functions that check `is_admin()`, write, and log | Ownership columns "never change through the API" ([accounts.md](accounts.md#built-foundation-2026-10-05)); a function is the one sanctioned path, and it writes the log row in the same transaction |
| Change an email, ban or unban, mint a recovery link, sign out everywhere, hard delete a user | A second Edge Function, **`admin-auth`**, with the project's secret key injected as `invite-user` has it | These are Supabase Auth admin API calls; nothing else can do them. The function verifies the caller's JWT (gateway `verify_jwt = true` this time, since the caller is a signed-in user), checks `is_admin()` through the database with the caller's token, and does exactly the five operations listed, nothing else |
| Run a workflow, read run status, merge a PR, commit an override | A GitHub App installed on the repository, its private key in Vercel as a sensitive variable | See [Operations](#operations-reruns-and-approvals) |

This amends the rule in [supabase.md](../supabase.md#edge-functions) ("no other function gets admin power") to:
**two** functions hold the secret key, `invite-user` and `admin-auth`, each with an enumerated list of operations and
its own tests; a third needs an owner decision.

### What "deactivate" means
Supabase Auth has a ban (`ban_duration`), which refuses new sign-ins but leaves issued tokens valid until they expire
(up to an hour). So deactivation is three things done together by `admin-auth`: ban the user (100 years), delete
their rows from `auth.sessions` (ends refresh), and set `profiles.suspended_at`, which `getUser()` in `lib/auth.ts`
treats as signed out (a request with a still-valid token gets the sign-in page with "This account is paused"). The
person's data is untouched: a deactivated student's guardians still see everything ([AP scores decision,
2026-10-11](../chances/rigor-in-context.md): never hide a student's data from guardians). Reactivate reverses all three.

### Password reset and email change
- Email sending still waits for the new domain ([backlog.md](../backlog.md#platform)), so the console always offers
  **Copy reset link** (`auth.admin.generateLink({ type: "recovery" })`, landing on `/auth/confirm` then
  `/account/password`, exactly the invitation's path), and **Send reset email** only once an email provider is
  configured (`resetPasswordForEmail`). A copied link is shown once and never logged, like invitation links.
- **Change email** uses `auth.admin.updateUserById(id, { email, email_confirm: true })`: the admin is vouching for the
  address, so no confirmation round trip. The console shows pending invitations addressed to the old email and offers
  to re-point them (`invitations.email`), since acceptance matches on the signed-in user's address.

### Hidden values: what the owner means by "school" and "ranking"
The site hides three kinds of computed values, and the console shows all three ([Colleges and hidden values](#colleges-and-hidden-values)):
- **A college's selectivity index** (0–100) and each input's percentile, behind the public tier
  ([selectivity-index.md](../chances/selectivity-index.md)): "never the weights, the index, or the cutoffs".
- **A student's standing**: the hidden odds behind each level, which inputs were used, the method's notes and
  ablations, and the model version ([levels.md](../chances/levels.md), [estimate.md](../chances/estimate.md)).
- **A high school's pooled course counts**, which the site never shows below three students
  ([course-plan.md](../chances/course-plan.md)), and the GPA estimates for colleges without a reported GPA
  ([gpa.md](../planner/redesign/gpa.md)).

Showing them to an admin changes nothing about the trade-secret rule: the console is server-rendered behind
`requireAdmin()`, no method code or hidden value is sent to any other browser, and the estimate still comes from the
server-only endpoint ([estimate.md](../chances/estimate.md#architecture)).

### Health: "when we received data"
Every stored value already carries a lineage record with its source, year, and retrieval date
([data-lineage.md](../data-lineage.md)), each college-reported document its `retrieved` and `extracted` dates
(`data/college-docs.json`, `data/cds-records/<unit>.json`), each pipeline failure its stage, reason, and `last_run`
(`college_data_failures`), and each publish the fields it changed (`dataset_changes`). Health is read from those;
nothing new is collected. The thresholds live in one file so they can be tuned.

## The console
`/admin`, signed in, admin only, `robots: noindex`, and no PostHog events: the provider is not mounted under
`/admin` ([telemetry.md](telemetry.md)). Five sections in a left rail (a top strip on phones, which the console
supports but does not favor):

| Section | Route | What |
|---|---|---|
| **People** | `/admin/people`, `/admin/people/[user]`, `/admin/households/[id]`, `/admin/students/[id]` | Search, a person, a household, a student record |
| **Colleges** | `/admin/colleges`, `/admin/colleges/[unit]` | A college's hidden values and its health; a student's standing from the student page |
| **Health** | `/admin/health` | Every college by data health, with filters |
| **Operations** | `/admin/operations` | Workflow runs, open data PRs, the review queue |
| **Log** | `/admin/log`, `/admin/admins` | Every admin action; who is an admin |

A global search box in the rail's header takes anything: a name, an email, a household name, a college name or unit
id, a high school name, a user or student id (UUID). It routes to the matching page when there is one hit and to a
results list otherwise.

## People

### Search
`admin_search_people(q, limit = 50)`, security definer, `is_admin()` checked first. Matches, case-insensitively and by
trigram (pg_trgm is already installed for high schools): `auth.users.email`, `profiles.display_name`,
`students.display_name`, `households.name`, `invitations.email` and `invitations.display_name`, and exact match on a
UUID. Returns rows of `{ kind: user | student | household | invitation, id, name, email, household, role, status,
created, last_sign_in }`, deleted and suspended rows included and marked. Results list shows kind, name, email (the
only place on the site that shows one), household, status chips (**Paused**, **Deleting in 12 days**, **Invited**,
**No account yet**), and the date created.

### A person: `/admin/people/[user]`
Top to bottom:
- **Account**: display name, email, email confirmed, provider(s), created, last sign-in, MFA enrolled, birth year,
  role hint, phone, `suspended_at`, `deleted_at` with the purge date. Each editable field has an inline edit.
- **Households**: every membership (role, can_edit, status, since), with the household's other members by name, each
  a link. **Leave** removes the membership (`admin_unlink`).
- **Student records**: their own (`students.user_id`) and the ones they manage (`managed_by`), each a link to the
  student page.
- **Lists and plan**: list names with item counts and the plan's stage caption; a link to open the student page.
  Never the list itself here; the student page shows it and logs the view.
- **Notifications**: `notification_prefs`, the digests sent, SMS consent.
- **Who viewed their data**: `access_log` for their student record, admins included.
- **Actions** (right column):

| Action | Does | Confirmation | Log |
|---|---|---|---|
| Edit details | `admin_update_profile(user, { display_name, birth_year, role_hint, phone })` | none | `profile.update` with before and after |
| Change email | `admin-auth` `set_email`; re-point pending invitations if ticked | the new address typed twice | `auth.email` (old and new) |
| Copy reset link / Send reset email | `admin-auth` `recovery_link` / `recovery_email` | none | `auth.recovery` (no link) |
| Sign out everywhere | `admin-auth` `sign_out` (deletes `auth.sessions` rows) | none | `auth.sign_out` |
| Deactivate / Reactivate | `admin-auth` `suspend` / `unsuspend` (ban, sessions, `suspended_at`) | a reason, free text, required | `account.suspend` with the reason |
| Delete account | `admin_delete_account(user)`: the same path as `delete_my_account()`, so managed students, households, and memberships follow the built rules ([accounts.md](accounts.md#built-one-household-six-seats-2026-10-05)); 30-day soft delete; signs them out | type **delete** | `account.delete` |
| Restore | `admin_restore_account(user)` within the 30 days (the person's own `restore_my_account()` rules) | none | `account.restore` |
| Delete now | `admin-auth` `purge`: the one-account version of `npm run purge-accounts` (student records, households left empty, then the auth user) | type the email | `account.purge` |
| Export their data | The built exporter (`lib/account-export.ts`) run as this user by the security-definer `admin_export(user)` | none | `account.export`, and an `access_log` row for each student record it includes |

A deleted account shows a banner with the purge date and the Restore and Delete now actions only.

### A household: `/admin/households/[id]`
Name, created by, created, home address (city and state only; the street is the family's), the roster as the family
sees it (students, then guardians, with status), pending invitations with expiry (never the token), and the seat
count. Actions:

| Action | Does | Rules kept | Log |
|---|---|---|---|
| Rename | `admin_update_household(id, { name })` | | `household.update` |
| Add a student | Pick a student record (search); `admin_link(household, student)` adds an active student membership | Six seats; a student is in one household at a time, so a student already in another household is **moved**, with that household named in the confirmation; the student's data is untouched | `household.link` |
| Add a parent | Pick a user; `admin_link(household, user, can_edit)` adds an active guardian membership; `can_edit` defaults on (parents edit by default, 2026-10-08) | Six seats; a user is in one household at a time, same move rule | `household.link` |
| Remove a person | `admin_unlink(member)` removes the membership. Refused for a managed student whose only guardian this is, with the two ways out named (link them to another guardian first, or delete the record) | A student record is never deleted by an unlink | `household.unlink` |
| Cancel an invitation | Sets `invitations.revoked_at`, as the family's Cancel does | | `invitation.revoke` |
| Close the household | Allowed only when empty; soft delete | | `household.close` |

`admin_link()` is the one path besides `accept_invitation()` that creates a membership, and the accounts spec's rule
("nobody joins a household silently") is kept by telling the household: the next time any member opens `/household`,
a one-line notice says "Quad support added Jordan to this household on Oct 12", read from the log. An email goes
too once email sending exists.

### A student record: `/admin/students/[id]`
The record (name, grad year, phone, own account or managed by whom, household), then the student's data **as the
family sees it**, read-only, with the chances values the family does not see:
- **Numbers**: the profile form's values (`student_profiles.data`), including AP and IB courses and scores.
- **List**: each list with its items, category, round, status, outcome, notes, and for each college the
  **standing panel** described under [a student's standing](#a-students-standing).
- **Plan**: tasks by month, offers, visits, letters (metadata only, not the file).
- **Snapshots**: `application_snapshots` rows, binned inputs and hidden odds, consent state.

Opening this page writes an `access_log` row (`viewer_id` = the admin, `table_name = 'admin'`), and the student's
"Who viewed your information" shows it as **"Quad support viewed your information on Oct 12"** (name rule: the
admin's name is not shown to families). Actions: edit the record's name, grad year, phone (`admin_update_student`);
**Attach to an account** for a managed record (pick a user with no own student record; runs the built
`merge_managed_student` path and logs `student.claim`; refused with the reason when the user already has a record);
**Delete the record** (soft delete, typed, `student.delete`), used when a family asks to remove a child they added by
mistake.

## Colleges and hidden values

### A college: `/admin/colleges/[unit]`
Three panels over the public profile's header (name, tier chip, admit rate as cited on the site):
1. **Selectivity**: the index, the previous published tier and whether hysteresis held it, and a table of the inputs
   from [selectivity-index.md](../chances/selectivity-index.md): each input's raw value with its citation, its
   percentile among reporting colleges, its weight, and whether it was present; the trend adjustment; per pool when
   the college has residency rates. The one place the weights are visible. Below it, the score and tier history per
   pool, and a site-wide movers page at `/admin/selectivity`
   ([selectivity-history.md](../chances/selectivity-history.md), planned 2026-10-13).
2. **GPA**: what the standing model uses for this college ([gpa.md](../planner/redesign/gpa.md)): source kind
   (reported, bands, estimated, bounded, none), the point and range, and for an estimate the model's fit size and
   typical miss, plus the p25 and p75 curve the same way.
3. **Derived, not shown**: every `derived.*` field in `lib/fields.ts` whose registry entry is marked hidden, with
   value and lineage. The registry gains a `hidden: true` flag for fields computed for the method and never cited on
   a page, so this panel never needs its own list.

Below them, the college's [health card](#health), the open failures and review-queue items, and a **Rerun** button
that opens Operations with this college filled in.

### A high school: on `/admin/high-schools/[id]`
The pooled course counts in full (`school_course_counts`: course, count), with the three-student line drawn, so the
owner can see why a course is or is not suggested; the school's profile extraction status (the hs-profile pilot's
files) and its graduation-rate vintage. Read through an `is_admin()` select policy on the counts table, the only
read of it that is not `school_course_list()`.

### A student's standing
On the student page, each list college has a **standing panel** (collapsed by default), showing what the estimate
returned for this student at this college, on the server, with the method's private output
([estimate.md](../chances/estimate.md)): the level and label; the hidden odds; `inputsUsed` with the student's values
beside the college's (GPA against its curve, the test against its range, rigor against the school's offering, rank,
major); the note catalog entries that fired; the ablations (what the level would be without each input); the model
version; and the baseline's three-group answer for comparison. The panel is rendered only inside `requireAdmin()`
and reads the same `estimate()` function the endpoint calls, with an `admin: true` option that includes the private
fields, which the endpoint never sets. A test checks that the public endpoint's response shape rejects those fields.
*As built:* no `admin` option; the panel reads the server-only `estimateWithDetail()` that `estimate()` itself wraps
([as built](#as-built-colleges-high-schools-hidden-values-the-standing-panel-2026-10-13)).

## Health

The Health page has two views since 2026-10-19: **Estimate inputs** (health as a function of the facts the
admission estimate reads) and **Files** (every file we read, its year, publish date, and health, then the per-college
table below). See [admin-health-views.md](admin-health-views.md).

### Per college
A card with one row per **data group**, each with its newest retrieval date, its status, and what decided it:

| Group | Read from | Fresh when | Watch when | Stale when | Failing when |
|---|---|---|---|---|---|
| Federal (Scorecard, IPEDS) | `data/meta.json` vintages; which core fields this college has | the core fields (admit rate, test ranges, cost, outcomes) are present | one or two core fields missing | — | — |
| College-reported (CDS, class profile) | `data/college-docs.json`, `data/cds-records/<unit>.json`: newest edition, `retrieved`, `extracted`, reads per section | newest edition is the current cycle and every section was read | one edition old, or a section archived but not read | two or more editions old, or no document | an open `college_data_failures` row at stage `fetch` or `read`, or `failed_checks` with a review-queue item |
| Identity (links, social, brand) | lineage `retrieved` for `links.*`, `social.*`, `brand.*`; `data/link-issues.json` | probed within 28 days (the refresh cadence) and no link issue | 28–90 days, or a dead link | over 90 days | — |
| Campus life (directories, campus pages) | lineage `retrieved` for `directories`, `campus.*`, `religion`, `lgbtq` | within 180 days | 180–365 days | over a year, or never collected | — |
| What changed | `dataset_changes` newest `published_at` for the unit | informational: "last changed Oct 4 (3 fields)" | | | |

Overall status is the worst row's, in the order Failing > Stale > Watch > Fresh. Each row names the date it is
judged by and links to the document or the failure. Thresholds and the current-cycle edition are constants in
`lib/admin/health-rules.ts`, computed by the pure `collegeHealth(unit, inputs)` so the tests pin them.

### The overview: `/admin/health`
Counts by overall status and by group status (a small stat row, [charts.md](../charts.md) rules), then the table of
every college: name, tier, overall, one cell per group with its date, open failures by reason code, queue items.
Sort by worst first; filters by status, group, reason code, state, tier, and "on a family's list" (colleges that
appear on any list, so the owner can fix what families are looking at first, the order
[gpa.md](../planner/redesign/gpa.md#6-closing-the-gaps-data-not-code) recommends for spending). CSV download. The
page is computed once per server instance from the deployed files and the two tables, like the dataset itself, and
revalidated by each deploy.

### Built: the Health page
`app/admin/health/page.tsx` (stat row, filter form, table), `csv/route.ts`; the logic is pure and tested in
`lib/admin/health-view.ts`, joined to the dataset in `lib/admin/health-load.ts`.
- **Filters are the URL**: `status`, `group`, `reason`, `state`, `tier` (0 to 4, the site's selectivity tiers), `family=1`,
  `sort` (`worst` default, `name`, `failures`, `queue`), `page` (100 rows). `status` alone judges the overall status; with
  `group` it judges that group (`unjudged` = its files aren't in this deploy); `group` alone lists colleges where that
  group isn't Fresh. Bad values are dropped, never an error.
- **"On a family's list"** is offered only when `familyListUnits()` could be read; otherwise the control is hidden and the
  parameter ignored.
- Each row: name (links to `/admin/colleges/[unit]`), tier and admit rate (cited once under the table with the admit
  rate's source note), overall, one cell per group with the date it is judged by (the reason is the cell's tooltip), open
  failures by reason code, queue items (link to that college's queue). The page header shows the inputs' date
  (`generated`) and the day measured. On phones the table becomes cards.
- **CSV** at `/admin/health/csv` takes the page's query string and downloads the same rows in the same order; admin only,
  a 404 otherwise.

### Files the deploy must carry
`data/college-docs.json`, `data/cds-records/**/*.json`, `data/college-failures.json`, `data/review-queue.json`, and
`data/link-issues.json` are not traced into the deploy today (`next.config.ts` `outputFileTracingIncludes`).
*As built:* measured 2026-10-12 they are 41.7 MB together (the CDS records 28.5 MB, the review queue 11.9 MB), well past
the 16 MB-per-function guidance in [serving-architecture.md](../serving-architecture.md), so the compact route was
built from the start: `npm run college-health` writes `data/college-health.json` (about 0.7 MB, one line per college),
the only file traced for `/admin/**`; `npm run verify` (`check:college-health`) fails when it is stale, and the
college-reported, identity-refresh, and campus-pilot workflows rebuild it in their data PRs. Operations reads the
review queue and the run reports from GitHub at `main`, never from the deploy.

## Operations: reruns and approvals
> The Review queue and Approvals parts are replaced by [data-steward.md](data-steward.md) (planned 2026-10-13): an
> agent groups the queue into causes and proposes fixes with evidence; Operations shows Issues, Proposals, and Audits.
> Runs and Start a run stay as built.

The owner wants to trigger reruns and approve data changes from the console, in the first build if the GitHub side
is right. It is: every pipeline is already a workflow with `workflow_dispatch` inputs, every data change is already a
PR with CI and a readable diff, and the review queue is resolved by editing one file. The console needs a way to call
GitHub as itself.

### The GitHub App (recommended over a PAT)
A GitHub App, **"Quad console"**, installed on this repository only, with these permissions and no others:

| Permission | Level | For |
|---|---|---|
| Actions | Read and write | dispatch a workflow; list runs and their status |
| Contents | Read and write | commit an override or a recipe change to a branch |
| Pull requests | Read and write | list data PRs, read the body, merge, close, comment |
| Metadata | Read | required |

The app's id, installation id, and private key go to Vercel as sensitive variables (`GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_REPO = raywross/college-stats`). `lib/github-app.ts`
signs a short JWT with the key, exchanges it for an installation token (valid one hour, cached in memory), and calls
the REST API. Nothing else on Vercel holds GitHub credentials. Unset variables show Operations with a notice and no
buttons, the way `inviteFunctionConfigured()` degrades.

Why an App and not the existing PAT: an installation token expires in an hour and is minted per request, so there is
no long-lived token in Vercel to leak and nothing to renew every 90 days; permissions are exactly the four above;
actions show as **quad-console[bot]** in the PR, which separates what a person did from what the console did; and a
PR opened with an App token does trigger `pull_request` workflows, so it could later replace `COLLEGE_REPORTED_TOKEN`
in the workflows too (an owner choice, not part of this spec). A fine-grained PAT with the same four permissions
works for a first go (`GITHUB_TOKEN` in Vercel) and the client accepts either.

### Reruns
A form per workflow, with the inputs the workflow already declares, read from the console's own table (not from
GitHub, so the form stays typed):

| Run | Workflow | Inputs shown | Guard |
|---|---|---|---|
| Re-read one college's documents | `college-reported.yml` `mode: college` | unit id (prefilled from a college page), rediscover, auto_merge | one run at a time (the workflow's concurrency group); a run already in progress is shown instead of the button |
| Run the pilot set / all colleges | `college-reported.yml` `mode: pilot \| all` | auto_merge | **all** shows the last full run's cost from `data/reports/` and asks for the word **all** |
| Finish open batches | `college-reported.yml` `mode: collect` | | |
| Refresh links, social, brand | `identity-refresh.yml` | force, auto_merge | |
| Publish | `publish-changes.yml` | what | |
| Re-run CI | `verify.yml` | | for a PR whose check never started |

Each dispatch (`POST /repos/{repo}/actions/workflows/{file}/dispatches`, `ref: main`) passes one extra input,
`request_id`, which the workflows add to their `run-name` (one line each: `run-name: ${{ github.workflow }} ·
${{ inputs.request_id }}`), so the console can find its run: GitHub's dispatch call returns no run id, so the page
polls `GET …/actions/runs?event=workflow_dispatch` and matches the display title. Every dispatch is logged
(`ops.dispatch` with the workflow, inputs, and `request_id`) before it is sent.

**Runs** lists the last 30 runs of these workflows with status, who or what started them (schedule, the console and
which admin, GitHub by hand), duration, and for a pipeline run the PR it opened; each links to GitHub. A failed run
shows its conclusion and the failed step's name.

### Approvals
**Open data PRs**: pull requests on `main` whose head branch starts with `data/` (the pipelines' prefix:
`data/college-reported-<run>`, `data/identity-refresh-<date>`), with the body the workflow wrote (counts, cost, circuit-breaker status, the review-queue
table) rendered as the PR shows it, the CI status, and whether auto-merge is on. Buttons: **Approve and merge**
(`PUT …/pulls/{n}/merge`, squash, refused while checks are pending or failed), **Hold** (disables auto-merge with a
comment saying who held it), **Close** (with a comment). The PRs that wait for a person today, a tripped circuit
breaker or a run stopped early ([college-reported-setup.md](../college-reported-setup.md#8-auto-merge-is-on-by-default)),
are flagged at the top.

**Review queue**: `data/review-queue.json` as a table (college, template code, edition, the value read, each failed
check and its detail, the document), with the fixes [section 6 of the setup](../college-reported-setup.md#6-resolving-a-review-queue-item)
describes made into buttons:
- **Accept the value**: writes an override to `data/overrides.json` with `source: cds` and the document's citation,
  the mechanism [sources-and-citations.md](../sources-and-citations.md) already defines.
- **Reject**: records the item as rejected (`data/review-queue.json` `resolved: rejected`, kept so the next run
  doesn't queue it again).
- **Re-run discovery**: clears the college's recipe in `data/college-sources.json` and dispatches a `college` run.

The first two are file changes, so the console makes them the way a person would: a branch
`review/<unit>-<code>-<date>` from `main`, one commit through the Contents API with a message naming the admin and
the item, a PR with a generated body and a release note of kind `data`, and auto-merge on. CI's checks (`verify`,
lineage, the release-note job) run as on any PR. The console never pushes to `main`, never touches
`.github/workflows/`, and the App has no Workflows permission, so it could not.

### Built: the Operations page
`app/admin/operations/page.tsx` and `actions.ts`; the logic is in `lib/admin/ops-actions.ts` (over injected dependencies,
so every path is tested with fakes) and wired in `lib/admin/ops.ts`.
- **No credentials**: a setup notice and no buttons or forms.
- **Start a run**: one `<details>` per row of `DISPATCHABLE_RUNS`, with typed inputs; `?unit=` opens and prefills the
  college run and narrows the review queue to that college. A workflow with a one-at-a-time guard that is queued or running
  shows that run instead of its form (the action checks again). **All** shows the last full run's actual cost and the
  newest projection (`fetchRunCost`) and asks for the word. After sending, the action looks the run up by its request id.
- **Runs**: the last 30, with status (a failed run names its failed step, for the six newest failures), who started it
  (schedule; the console and the admin's display name, from the log by request id; GitHub by hand), duration, and the open
  PR it opened.
- **Open data PRs**: flagged ones first; the body is rendered as untrusted markdown (`lib/admin/pr-markdown.ts`: raw HTML
  shown as text, images as links, only http(s) links); CI state, auto-merge; Approve and merge (disabled with the reason
  while checks are pending, not started, or failed), Hold (when auto-merge is on), Re-run CI (when no check started), Close
  (asks first).
- **Review queue** (from `main`, 25 per page, open by default, filterable by college, code, status): Accept (when
  `acceptPlan` allows it, else the refusal reason), Reject, and Re-run discovery (just dispatches a `college` run with
  `rediscover: true`), each asking first.
- **Logging**: every action calls `admin_note_ops` *before* it sends (`ops.dispatch`, `ops.merge`, `ops.hold`,
  `ops.close`, `review.accept`, `review.reject`, `review.rediscover`) and does not send when the log write fails; a send that
  then fails adds `ops.failed` or `review.failed`. Comments, commit messages, and PR bodies name the admin by display name,
  never an email (`publicName` falls back to "an admin").

### What stays on GitHub
Reading a diff, editing anything other than the two files above, changing a workflow, and the archive repository's
token ([setup section 9](../college-reported-setup.md#9-archive-repo-and-token)) stay where they are. The console
links to GitHub everywhere a thing has a page there.

## Settings
`/admin/settings` (built 2026-10-21; linked under "Who is an admin" in the rail): switches for the whole site. Each is a
row of `public.app_settings` (key, jsonb value, who and when; migration `20261021120000_app_settings.sql`). Anyone may
read a setting, since none is a secret; the only write is `admin_set_setting(key, value)`, which checks `is_admin()`,
refuses a key it doesn't know (`unknown_setting`) or a value of the wrong type (`invalid_value`), and logs
`setting.set` with the old and new value. A missing row means the setting's default.

| Key | Value | What it does |
|---|---|---|
| `planner.all_moves` | boolean, default off | The planner's all-moves preview ([all-moves-preview.md](../planner/v3/all-moves-preview.md)) |

A new setting adds its key to `admin_set_setting`'s list in a migration, and a panel to the page.

## Model
One migration, `supabase/migrations/2026…_admin.sql`, additive, applied to dev before prod:

```
admins     (user_id pk references auth.users, granted_by uuid, granted_at timestamptz, revoked_at timestamptz, note text)
admin_log  (id bigint identity, admin_id uuid, at timestamptz, action text, target_kind text, target_id text,
            details jsonb, request_id text)
profiles   + suspended_at timestamptz, suspended_reason text
```

- `is_admin()`: security definer, stable; true when `auth.uid()` is in `admins` unrevoked and `auth.jwt() ->> 'aal'
  is `aal2`. `is_admin_any_aal()` for the MFA enrollment page only.
- **Read policies** named "Admins read" on: `profiles`, `households`, `household_members`, `students`, `invitations`
  (every column but `token` and `token_hash`, through a view `invitations_admin`), `access_log`, `student_profiles`,
  `lists`, `list_items`, `list_notes`, `follows`, `notification_prefs`, `digests`, `sms_consents`, `sms_sends`,
  `plan_tasks`, `plan_offers`, `plan_visits`, `plan_letters` (metadata; the file's storage policy is unchanged),
  `plan_nudges`, `application_snapshots`, `school_course_counts`, `college_data_failures`, `dataset_publishes`. No
  admin write policy on any of them: writes go through the functions.
- **Functions**, all security definer, `search_path = ''`, first line `if not public.is_admin() then raise
  exception 'admin only'`, each writing its `admin_log` row in the same transaction: `admin_search_people`,
  `admin_update_profile`, `admin_update_student`, `admin_update_household`, `admin_link`, `admin_unlink`,
  `admin_claim_student`, `admin_delete_account`, `admin_restore_account`, `admin_delete_student`,
  `admin_close_household`, `admin_export`, `admin_log_access` (the `access_log` write for a student page view),
  `admin_grant`, `admin_revoke` (an admin cannot revoke themselves; the last admin cannot be revoked),
  `admin_note_auth_action` (the log row for `admin-auth` operations, written by the function with the service role
  after the Auth call succeeds, carrying the same `request_id`).
- `admin_log` is readable by admins, written only by the functions and the service role. Nothing in it is a secret:
  no tokens, links, or passwords; emails appear only in `auth.email` rows (old and new).
- `getUser()` (`lib/auth.ts`) reads `suspended_at` with the profile and returns null when set; `requireUser` sends
  a suspended person to `/login?paused=1`, which explains and gives the support address.

### The `admin-auth` Edge Function
`supabase/functions/admin-auth/` with the `invite-user` layout (`index.ts` wiring, `handler.ts` pure, Node tests).
`verify_jwt = true`; the handler also calls `is_admin()` with the caller's token (a second client built with the
publishable key and the caller's `Authorization` header), so a valid JWT from a non-admin, or an admin at `aal1`,
gets 403.

```
POST {SUPABASE_URL}/functions/v1/admin-auth
Authorization: Bearer <the admin's session JWT>
{ "op": "set_email" | "recovery_link" | "recovery_email" | "sign_out" | "suspend" | "unsuspend" | "purge",
  "user": "<uuid>", "request_id": "<uuid>", "email"?: "...", "reason"?: "..." }

200 { "ok": true, "link"?: "..." }      -- link only for recovery_link; shown once, never logged
400 bad_request · 401 unauthorized · 403 not_admin · 404 user_not_found · 409 email_taken · 500 internal_error
```
`purge` runs the purge plan for one user (`scripts/lib/purge-accounts-plan.mts`, shared, not copied) and refuses a
user who is not soft-deleted. Every success writes `admin_note_auth_action`. The site's caller is
`lib/admin/auth-function.ts`, mapping statuses as `lib/invite-function.ts` does; nothing throws into a page.

## Files (planned)
| File | What |
|---|---|
| `app/admin/layout.tsx`, `page.tsx` | `requireAdmin()`, the rail, the MFA step when the session is `aal1`, the global search |
| `app/admin/people/**`, `households/[id]`, `students/[id]` | The pages above; Server Actions in `actions.ts` call the `admin_*` functions and `admin-auth` |
| `app/admin/colleges/[unit]`, `high-schools/[id]` | Hidden values and the health card |
| `app/admin/health/page.tsx` | The overview, filters in the URL, CSV route |
| `app/admin/operations/**` | Runs, approvals, the queue; Server Actions over `lib/github-app.ts` |
| `app/admin/log`, `admins` | The log with filters; grant and revoke |
| `lib/admin/auth.ts` | `requireAdmin()`, `isAdmin()`, the aal check |
| `lib/admin/people.ts` | Typed reads over the admin policies; `logAccess(student)` |
| `lib/admin/health-rules.ts`, `health.ts` | Thresholds; `collegeHealth()` pure; the overview's computation and cache |
| `lib/admin/hidden.ts` | The selectivity breakdown, GPA sources, hidden derived fields, the standing panel (as built: from `estimateWithDetail()`, loaded by `lib/admin/standing.ts`) |
| `lib/github-app.ts` | App JWT, installation token, `dispatch`, `runs`, `pulls`, `mergePull`, `commitFile`, `openPull`; a PAT fallback |
| `lib/admin/review-queue.ts` | Accept, reject, re-run: the file edits and the PR body |
| `supabase/migrations/2026…_admin.sql` | [Model](#model) |
| `supabase/functions/admin-auth/` | The function; `supabase/config.toml` entry |
| `lib/fields.ts` | `hidden: true` on method-only derived fields |
| `.github/workflows/*.yml` | `request_id` input and `run-name` on the five dispatchable workflows |
| `next.config.ts` | Trace the health files |
| `specs/supabase.md` | The two-functions rule; the new tables in the schema table; the GitHub App under Keys |

## Tests
- `tests/admin-policies.test.mts` (PGlite, like the other policy tests): a non-admin reads nothing through the new
  policies and gets "admin only" from every function; an admin at `aal1` is refused; an admin at `aal2` reads and
  each function writes its log row; `admin_link` keeps the six-seat and one-household rules and moves rather than
  duplicates; `admin_unlink` refuses the last guardian of a managed student; `admin_revoke` keeps the last admin; the
  invitations view never exposes a token. A guard test drops the `is_admin()` line from one function and shows the
  test catching it.
- `tests/admin-auth-function.test.mts`: every op and status with fake dependencies; a non-admin JWT; no link, email,
  or reason in any log call except where the spec says.
- `tests/admin-health.test.mts`: `collegeHealth()` on fixtures for each cell of the table, the overall-status order,
  and the current-cycle edition constant; a guard that moving one threshold changes the expected status.
- `tests/admin-hidden.test.mts`: the standing panel's private fields appear with `admin: true` and the public
  endpoint's response schema rejects them; the selectivity breakdown's percentiles sum to the index as the spec's
  formula says. *As built:* the panel's detail comes from `estimateWithDetail()`; `publicResult` drops every detail
  field; no API route or client component imports the detail; and since the index's second version standardizes
  instead of percentiling, each college's weighted readings add up to its committed index (percentiles are shown too).
- `tests/github-app.test.mts`: JWT shape, token caching, each call's URL and body, the `request_id` input on every
  dispatch, the merge refusal on pending checks, the review-queue commit's branch name and file contents.
- `tests/require-admin.test.mts`: `/admin/**` returns 404 signed out and for a non-admin; `getUser()` returns null
  for a suspended profile.

## Build order
Three units, one PR each or one PR with three sub-branches as the `build-roadmap-section` skill does:
1. **People** (the migration, `admin-auth`, `/admin` with People, Log, Admins, the MFA step). The owner can use it
   the day it merges.
2. **Colleges and Health** (hidden values, the health rules, the overview, the traced files).
3. **Operations** (the GitHub App, runs, approvals, the queue). Needs the owner's App installation first.

## Owner steps
1. Insert the first `admins` row in the SQL Editor (dev, then prod) and enroll MFA from `/admin`.
2. Deploy `admin-auth` with `npx supabase functions deploy admin-auth --project-ref <ref>` (dev, then prod), as
   `invite-user` is deployed; it needs no new secret.
3. Create the GitHub App under the repository owner's account with the four permissions, install it on this
   repository, and put its id, installation id, and private key in Vercel (Production and Preview, sensitive).
4. Apply the migration before deploying unit 1; the console shows a setup notice until it is.

## Owner decisions
Recommendations stand unless changed:
1. **MFA required for admin sessions.** Recommended: yes, TOTP, enrolled once. The alternative (password only) is
   one leaked password away from every family's data.
2. **What the student sees when an admin views their data.** Recommended: "Quad support viewed your information", in
   the same list as guardians' views. The alternative, not logging admin views, breaks the promise the list makes.
3. **A second Edge Function with the secret key.** Recommended: yes, `admin-auth`, enumerated ops, tested like
   `invite-user`. The alternative puts the secret key in Vercel, which the owner has twice decided against.
4. **GitHub App or PAT for Operations.** Recommended: the App. A PAT works for the first go and the code accepts
   either; the App removes the 90-day renewal and the personal attribution.
5. **Operations in the first build.** Recommended: yes, as unit 3, since the integrations above are known and small;
   it can slip to a second PR without changing units 1 and 2.
6. **Admin tiers.** Not in this version: every admin can do everything. A `support` role that cannot delete, purge,
   grant, or dispatch is a one-column change (`admins.level`) when a second person joins.

## Open questions
- Should the console show the dollar cost of a run before dispatching `mode: all`, read from the newest report in
  `data/reports/`? Recommended: yes, it is one number and it is the one that matters.
- Should "Accept the value" on a review-queue item write the override to `data/overrides.json` or to the CDS
  record's own file? Recommended: `overrides.json`, the mechanism the lineage check already understands; the
  importer's override format is reused as is.
- Where does the suspended person's support address point before the new domain exists? Recommended: the owner's
  address for now, in one constant.

## As built (2026-10-12)
Built on `feature/admin` in units on sub-branches (`feature/admin-foundation`, `-auth-fn`, `-health`, `-github`,
`-people-ui`, `-ops-ui`); the console's page-level decisions are in [admin-console-ui.md](admin-console-ui.md).
- **Owner decisions:** MFA required (TOTP, `aal2`); Operations through a GitHub App (a fine-grained PAT also works);
  no support address yet (a paused account reads "Contact Quad support"); the hidden-values panels build on PR #136.
- **Migrations:** `20261012200000_admin.sql` (tables, `is_admin()`, the read policies, every `admin_*` function, plus
  `admin_user_auth`, `household_homes_admin`, `admin_note_ops`) and `20261012210000_admin_auth_sessions.sql`
  (`auth_end_sessions()`, service role only, for admin-auth's sign-out and suspend).
- **The console header:** the "Admins read" policies answer only requests carrying `x-quad-console: 1`
  (`admin_reads()`), sent only by `adminSupabase()`, so an admin using the ordinary site sees only their own family.
- **Paused accounts:** `getUser()` stays claims-only (no per-request database read); `getAccount()` and
  `requireUser()` treat a paused profile as signed out and send it to `/login?paused=1`; admin-auth's suspend bans the
  user and ends their sessions, so the token dies within its hour.
- **Standing panel:** reads the existing server-only `estimateWithDetail()` rather than adding an `admin` option to
  `estimate()` (built 2026-10-13, below).
- **Review queue:** Accept writes an override only for fields an override can set (the C1 totals together, the SAT/ACT
  submission shares, older whole-college C1 readings); every other item shows why. Reject marks it `resolved:
  rejected`, which the failures list and the health counts skip. Re-run discovery dispatches a `college` run with
  `rediscover: true` (no recipe PR).
- **GitHub App permissions:** the four in the table plus **Checks: read** and **Commit statuses: read** (to read CI
  before merging). Only this repository's `data/` and `review/` PRs are listed or merged (a fork's same-named branch is
  refused).

### As built: colleges, high schools, hidden values, the standing panel (2026-10-13)
Built on `feature/admin-hidden` after PR #136 (the five levels and the selectivity index) reached `main`. Every page
calls `requireAdmin()` before it reads anything and is `noindex`; everything below is rendered by server components, so
none of it reaches a client bundle, an API route, or a public page. The assembly is pure and tested
(`lib/admin/hidden.ts`); the loaders are `lib/admin/college.ts`, `lib/admin/high-school.ts`, and `lib/admin/standing.ts`.
- **Colleges** `/admin/colleges?q=`: colleges by name, alias, or unit id (the dataset's own search) and high schools by
  name (three letters or more); an exact unit id or high-school id opens its page. The People search's "use Colleges" link
  lands here.
- **A college** `/admin/colleges/[unit]`: the public header (name, tier, admit rate with its source note, a link to the
  public profile), then three panels and the health card:
  - *Selectivity*, recomputed from the dataset with `lib/selectivity.ts` (the index file stays readable only by the build
    and its check): per pool (all, and in-state and out-of-state at a public with both residency rates), each input's
    value with its citation, its percentile among reporting colleges, its standardized reading, its weight, and its
    contribution; the small-class pull and the score; the tier the plain cutoffs give beside the stored tier, and a
    sentence saying whether hysteresis held it and at what scores it would move; the top band of Ultra selective. The
    method's constants are listed once under the panel. The method's second version has no trend adjustment, and the
    panel says so. A test holds every college's breakdown to the committed index.
  - *GPA*: what the standing model reads (`collegeGpa`): the source kind (reported, bands, estimated, bounded by a
    weighted average, none), the point and range, the middle 50%, and for an estimate the fitted models' size and misses
    and the predictors it read, with the field the plan cites.
  - *Derived, not shown*: every registry field marked `hidden: true` (below) with its value and lineage (`citeField`).
  - *Data health*: the college's card from `healthOverview()` (each group's status, date, and reason), the open failures
    by reason and stage, the review-queue count linking to Operations' queue, and **Rerun in Operations**
    (`/admin/operations?unit=`, which opens and prefills the college run).
- **The `hidden: true` registry flag** (`lib/fields.ts`, `HIDDEN_FIELDS`): `selectivity.band` and three new computed fields,
  `derived.selectivity_score`, `_in_state`, `_out_of_state` (the score behind each stored tier, never stored). Each has a
  value function in `HIDDEN_VALUES`; a test fails when a hidden field has none, or when any public page, component, or
  library outside the console names one. The Data page leaves hidden fields out.
- **A high school** `/admin/high-schools/[id]`: the pooled course counts in full (`school_course_counts` through the
  console client), most students first, with the three-student line drawn (`COURSE_LIST_MIN_STUDENTS`, held to
  `school_course_list()`'s own threshold by a test that reads the migration); what the course plan reads for the school
  (`offeringFor`); its profile extraction status (the profile file's link and read date); and its graduation rate with
  the class it describes, from lineage.
- **The standing panel** (`components/admin/StandingPanelSlot.tsx`, collapsed under every list college on the student
  page): the estimate's private detail for that student at that college, from the server-only `estimateWithDetail()`,
  with the open baseline's answer beside it. No `admin` option was added to `estimate()`. It mirrors the planner's own
  estimate (the saved profile, no round, the grade and core-subject answers, each list's hooks from its own rows and
  visits), reads through the console client, and computes once per page render for every slot (React `cache()`). The
  student page's single access row covers it; it writes none of its own. Tests check that the public endpoint's
  response carries no detail field (`publicResult`), and that no file under `app/api/` and no client component imports
  `estimateWithDetail`, `SnapshotDetail`, or the console's hidden modules, directly or through a chain of imports.
- **Not shown on the high-school page:** whether the school is in the hs-profile pilot's sample (the pilot file is a
  pipeline input, not a runtime one); the profile's presence answers "was it extracted".

## As built after the first merge (2026-10-13)
PR #140 merged 2026-10-13 with these additions from the owner's testing, each in its own spec:
- **People and Households are separate rail sections.** People lists every account and managed student record, 50 a
  page, with no search needed (`admin_list_people`); Households lists every household with its members, counts, and
  waiting invitations, and searches names, member emails, and invitation emails (`admin_list_households`).
  [admin-console-ui.md](admin-console-ui.md#people).
- **Email confirmation.** People rows carry an "Email not confirmed" chip; a person's actions offer Confirm email or
  Mark email unconfirmed (`admin_set_email_confirmed`; unconfirming signs them out and is refused for yourself).
- **Sign-in activity** on a person (PR #150): sessions with device and assurance level, the account's own dates, the
  auth audit log (once its dashboard switch is on, [supabase.md](../supabase.md#supabase-auth-authentication-settings)),
  and support's actions; never an IP address. The privacy page says the record is kept.
- **College views** ([college-views.md](college-views.md)): who opens each college page and when; "Colleges viewed" on
  a person, "Who's looking" on a college, and "Most viewed" on `/admin/colleges` (PR #151), each drilling down to
  individual times.
- **Health "Covers".** Each row of a college's health card says the period the data describes (the federal year by
  source, the CDS edition) above when it was collected.
- **Selectivity history** ([selectivity-history.md](../chances/selectivity-history.md)): every score and tier change
  per pool on the college page and at `/admin/selectivity`, with follower emails when a public tier changes.

Things learned in testing:
- **Revoking admin leaves the authenticator.** The TOTP factor an admin enrolled stays on the account, so its password
  reset asks for the code (PR #149 added the code step to `/account/password`). To drop it, delete the factor; the
  site has no self-service control for it yet.
- **Copy reset link** works from any origin in `INVITE_ALLOWED_ORIGINS`; on a preview URL it is refused until that
  origin is added.

Owner steps done on dev (2026-10-13): the admin migrations and every console migration through
`20261013170000_admin_top_viewed_colleges.sql`, the first admin row (now `rayuno+quadadmin@gmail.com`, MFA enrolled),
`admin-auth` deployed, `INVITE_ALLOWED_ORIGINS` and `ADMIN_AUTH_SEND_EMAIL` set, the selectivity backfill run, and the
"Quad console" GitHub App for Operations (its three variables and `GITHUB_REPO` in Vercel Production since
2026-10-13, repository auto-merge on). Prod repeats all of it at launch
([supabase.md](../supabase.md#setup-at-the-formal-release)).
