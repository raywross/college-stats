# Counselor Portal: Quad for Counselors, Free, as the Way Families Find the Advisor

> Status: **built** 2026-11-01 (phase 1, the caseload; see [As built](#as-built-2026-11-01)); **rewritten 2026-11-01** from the owner's review of the business model ("counselors get the system
> for free as a way of organizing and collecting information from their students; the idea is to use them to get us
> clients; the students will then pay; the advisor can then have a useful set of tools to help manage their student
> load and work with their students"). The 2026-10-02 plan was written when counselors were going to pay a premium;
> its 2026-10-26 revision made it free but kept the shape of a premium product (co-branded reports, seats, a data
> agreement before anything works). This version is built around the channel: the fastest possible way for a
> counselor to bring their students onto Quad, the tools that make the caseload worth running here, and nothing in
> the way. Phase 1 (the caseload) builds on `feature/counselor-portal`; [scattergrams](#phases) stay the
> last phase, with their rules in [scattergrams.md](scattergrams.md). Builds on accounts and households with roles
> ([accounts.md](accounts.md), [household-hub.md](household-hub.md)), the advisor as the student's plan
> ([advisor.md](advisor.md), [../planner/README.md](../planner/README.md)), the student's record
> ([../planner/record/README.md](../planner/record/README.md)), Quad's estimate and its levels
> ([../chances/README.md](../chances/README.md)), the essays workspace, whose comments already carry a counselor role
> ([essays/workspace.md](essays/workspace.md)), the parent's view, which is the model for the counselor's
> ([../planner/parents.md](../planner/parents.md)), and the admin console's people pages ([admin.md](admin.md)). After
> nothing: the advisor is built, and the caseload needs no billing to be useful. Part of [product](README.md).

## Goal
A counselor (an independent educational consultant, or someone in a school counseling office) keeps their caseload on
Quad **for free**: each student has their own Quad account, record, and advisor; the counselor sees them all in one
place, asks a student for what's missing, leaves notes, and reads the same plan and essays the family reads. The
counselor pays nothing, ever, and buys nothing for students. The students' families buy the advisor
([commercialization.md](commercialization.md#prices)) when billing ships, and the counselor's office is how they hear of it.

Three things follow from "the counselor is the channel, not the customer":
1. **Joining must be the easiest thing on the site.** A counselor starts an organization in one form, and a student
   joins it from a link or a short code, signing up on the way if they have no account. No agreement to sign first, no
   seats, no approval queue.
2. **The tools are for running a caseload**, not for impressing a parent: who has filled in their record, whose list has
   no Likely, whose deadline is this week, who hasn't opened their advisor in a month; one tap to ask a student for the
   missing piece; notes the office keeps; an export for the tools the office already uses.
3. **The family's data stays the family's.** A counselor sees a student's record, list, plan, and essays because the
   student (or their parent) granted it, with the same banner, the same access log, and the same off switch a parent
   has. Nothing a counselor enters changes Quad's estimate, and nothing the counselor sees is the parents' finances.

## What changed on 2026-11-01, and why
| Before (2026-10-02, revised 10-26) | Now | Why |
|---|---|---|
| An "organization account" with `plan` and `seats` columns, free since 10-26 but still shaped for billing | Organizations have no plan, no seats, no limits; nothing on the pages mentions money except the line that says counselors use Quad free | Free is the product, not a discount |
| School organizations need a signed data processing agreement before activation | **No agreement for the caseload.** A student or parent grants access to their own account, as they grant it to a parent; the school's records are never involved. The agreement moves to the [scattergram phase](#phases), the one place a counselor uploads the school's own data | FERPA governs a school's education records; a family consenting to share its own account with its counselor is not that. The old rule put the hardest paperwork in front of the easiest sign-up |
| Students join by accepting an emailed invitation only | **Two doors:** an invitation by email with a link, and a **join code** the counselor can put on a slide, a handout, or a Naviance message, so a whole class can join in a period | A school counselor has 300 students and no time for 300 emails |
| Co-branded PDF reports per student and a caseload PDF were the second phase | Reports are **not a phase**. The advisor's print page ([../planner/redesign/README.md](../planner/redesign/README.md)) already prints a student's plan for a meeting, and the caseload exports to CSV for the office's own tools. A branded PDF returns if offices ask | A co-branded report was a premium feature's reason to pay; nobody pays |
| The caseload shows "which students have the advisor" so the office knows who can open the guides | The caseload still shows each student's advisor status, and that is the whole of the channel's mechanics on the counselor's side: **no sales tools, no referral links in the counselor's hands, no commission** ([commercialization.md](commercialization.md#what-stays-free): no advisor commissions) | A counselor recommends Quad because the caseload works, and the family decides; the site must never look like the counselor is selling for it |
| A "dashboard" with alerts | A **caseload** with the same facts the parent's view uses (the summary line, the list's shape, the stuck signals), plus what a counselor uniquely needs: record completeness and "ask for it" | One set of rules for what the site says about a student, whoever is looking |

## Research (2026-10-02, still standing)
- Scoir's institutional plans start in the thousands per month; Naviance is district-licensed. Neither sells to
  individual IECs at a small price. IECs (roughly 10,000 in the US, many solo) have direct family consent and no district
  procurement, so they are the first users. School counselors can use a consent-based tool the same way; district
  procurement starts when the school's own data (scattergrams) comes in.
- FERPA applies to a school's education records and to vendors acting as school officials. A student or parent sharing
  their own Quad account with their counselor is the family's choice about the family's data, which is why the caseload
  needs no agreement and the scattergram upload does.

## Model
```
organizations      (id, name, kind: iec | school, ncessch nullable, website nullable, join_code unique,
                    created_by, created, deleted_at)
org_members        (id, org_id, user_id, role: owner | counselor, created)
org_invitations    (id, org_id, side: counselor | student, email, display_name, grad_year nullable, token_hash,
                    token (pending only), invited_by, created, expires_at (30 days), accepted_at, accepted_by,
                    revoked_at)
org_students       (id, org_id, student_id, can_edit default true, source: invite | code, granted_by, granted_at,
                    ended_at, ended_by)                       -- the grant; one live row per (org, student)
org_notes          (id, org_id, student_id, author_id, body, created, updated)   -- the office's notes, never the family's
org_requests       (id, org_id, student_id, kind: record_section | list | custom, section nullable, note,
                    created_by, created, done_at, seen_at)    -- "Ms. Rivera asked you to add your SAT score"
```
- **An organization** is one counselor's practice or one school's office. A person is in at most one organization
  (like the one-household rule; a consultant who also works at a school picks one). The **owner** is whoever created
  it; owners invite counselors and can remove them; every member sees the whole caseload (an office shares its
  students; per-counselor caseloads within an office are a later refinement if offices ask).
- **The grant** (`org_students`) is given by the student, or by a guardian for a student they can see, never created
  by the organization. It is what every read runs through: `can_read_student()` and `can_edit_student()`
  ([accounts.md](accounts.md#built-foundation-2026-10-05)) gain a third clause, an active grant to an organization the
  viewer is a member of, so the lists, the plan's tables, the record, the offers, and the essays open to the counselor
  with no change to their policies. `can_edit` is on by default, as parents' edit access is (owner, 2026-10-08), and the
  student can switch it to view only or end the grant at any time from `/account`.
- **What a counselor never sees**, by the same policies as a parent and a test for each: a guardian's finances and
  unshared estimates (owned by the guardian's user, not reachable through any student grant), a student's private list
  notes, the text of a parent's nudge, another organization's students. And one thing a parent sees that a counselor
  doesn't: the household itself (its members, its home address). A counselor sees students, not families.
- **The access log** records a counselor's reads as it records a parent's ("Ms. Rivera viewed your list on Oct 2"),
  visible to the student in `/account`, through the same `log_access()`.
- **Edits are attributed** as a parent's are ("Added by Ms. Rivera"). Nothing a counselor enters changes Quad's
  estimate: the estimate reads the record, and a counselor with edit access can fix the record like a parent can, but
  the "who set this" line says so.
- **School organizations** set their high school (`ncessch`, from the built picker), which is what the scattergram
  phase will use; today it shows on the organization page and nowhere else.

## How a student joins
Two doors, both ending in the same grant, both working for a student with no Quad account yet.

| Door | For | How |
|---|---|---|
| **Invitation** | A consultant adding the families they work with; a counselor adding one student | On `/org/students/new`: first name, last name (optional), email, graduation year (optional); several at once by pasting lines. Each makes an `org_invitations` row and a link the counselor copies or the site emails (`sendEmail`, when configured). 30-day expiry (students are slower than parents). The counselor sees invited students in the caseload, by name, marked **Invited**, with Copy link · Send again · Cancel, as the household roster shows them |
| **Join code** | A school counselor's whole class; anyone the counselor talks to | Every organization has a short code (`QUAD-RIVERA` style: 4 to 6 letters the owner can change, unique), shown on `/org` with the link `/join/<code>`. The student opens the link or types the code at `/join`; the counselor can regenerate it, which ends the old one |

**The student's side (`/join/[code-or-token]`):**
1. Signed out: the page shows who is asking (the organization's name, the counselor's name for an invitation) and the
   one-paragraph truth: what they'll be able to see (your record, your list and advisor, your essays), what they never
   see (your parents' finances), that you can see each time they look and can end it any time. Then **Sign in** or
   **Create an account** (the existing form, with `next` back here; the role defaults to student, the birth year rule
   holds).
2. Signed in as a student: **Join** creates the grant for their own record (made on the spot if they have none, as
   `/me` does).
3. Signed in as a guardian: the page lists the students they can see and asks which one; **Join** grants for that
   student (a managed student without an account can be on a caseload this way, as they can be in a household).
4. Signed in as a counselor or someone with no student: a plain message that the link is for students and their
   parents, with the organization's name.
5. A used, expired, or cancelled invitation says so in plain words; a code that no longer exists says so.

A student is on one caseload at a time? **No**: a student may have a school counselor and an independent consultant;
each is its own grant, listed separately in `/account`.

## The counselor's pages: `/org`
Signed-in people with no organization see **Start your organization** (name, "I'm an independent consultant" /
"I work at a school", the high school picker for schools, website optional) and one sentence: *Quad is free for
counselors and consultants. Your students' families decide whether to buy the advisor; you never pay, and you never sell.*
Creating it makes the caller the owner and lands on the caseload.

### The caseload (`/org`)
One row per student with a live grant (and invited students below, by name), in this order: the soonest open deadline
first, then by name. Each row:
- **Name**, class of, and the student's advisor status (**Preview** for everyone until billing ships; then Advisor ·
  Trial ends {date} · Not yet · Lapsed, from `lib/entitlements.ts`), as a quiet chip. Never a price.
- **Record**: sections filled of the record's sections (`profileProgress`, the same count the record page shows:
  "5 of 8"), with the missing ones on hover or tap.
- **List**: the count and shape against the season's target, the same line the plan shows (`countLine`, `shapeGaps`
  from [../planner/next-steps/list-shape.md](../planner/next-steps/list-shape.md): "7 colleges · no Likely yet"),
  levels read from the list items' stored category, never recomputed here, never a hidden number.
- **Applications**: "3 of 8 in" from the stage counts, once the student is applying.
- **Next deadline**: the next dated open task ("Michigan, Nov 1 (ED I)").
- **Last activity**: when the student last changed anything in the plan ("2 weeks ago"; "never opened" when the list
  is empty), from the plan's own timestamps.
- **Signals**: the parent's stuck signals ([../planner/parents.md](../planner/parents.md#stuck-signals)), the same six
  facts in the same words, as small chips; never a judgment.
Above the rows: the counts that matter for the office ("24 students · 6 juniors · 3 with no Likely · 5 deadlines this
week"), filters (class year, "needs something": any signal or an empty record), a name search, **Add students**, and
**Export CSV**. Phones: the row collapses to name, class, next deadline, and one chip; details open on the student's page.

The page reads with the counselor's own session (row-level security decides), in a handful of queries for the whole
caseload (students, profiles, default lists and their items, open tasks, applications), then computes every row with
the planner's pure functions. No estimate runs here.

### A student (`/org/students/[id]`)
The counselor's view of one student: the banner (**Viewing as a counselor** · you can (edit | look but not change) ·
Jordan can see when you view it), the summary line, the signals, then four things side by side on desktop and stacked
on phones:
- **Record**: the sections with filled / missing, each missing one with **Ask Jordan** (below), and **Open record**.
- **Advisor**: the list's shape, the next three moves, **Open advisor** (`/advisor?for=<id>`, which now opens for a
  counselor as it does for a parent, with the same read-only or editing rules and a "Back to caseload" link instead of
  the family's child switcher), **Print**, and **Essays** (every draft and comment the student has, read and comment,
  as [essays/workspace.md](essays/workspace.md) decided; comments by a counselor carry `author_role: counselor`).
- **Notes**: the organization's notes on this student, newest first, with the author's name and date; every member
  reads and writes; the family never sees them and they aren't in the student's export (they're the office's).
- **Asks**: what the office has asked for and whether it's done.

### Asking a student for something
The owner's phrase was "collecting information from their students". A counselor can't fill a student's record for
them (the record is the student's, and the estimate reads it), so the tool is an **ask**: *Ms. Rivera asked you to add
your SAT score.*
- From the student's page: **Ask** on any missing record section, on an empty list ("add your first colleges"), or a
  custom one-line ask (200 characters). Creates an `org_requests` row; emails the student once (the invitation email's
  plain style; nothing if the student has no account yet) and shows it in the student's advisor as a notice at the top
  of Next steps with the link to the step ("Ms. Rivera asked you to add your test scores · Add them"); a parent sees it
  on the student's plan too.
- **Done** when the thing exists: a record-section ask closes itself when the section is filled (checked when the
  notice renders); a custom ask has **Done** on the notice. The counselor sees "Asked Tue · Done Thu".
- **Rate-limited like nudges**: one open ask per section per student, and at most three asks a week per student from one
  organization; the button says "Asked Tuesday". The limit is the feature, as it is for parents.
- An ask never carries a number or a grade; "add your SAT score" is the whole of it.

### Members and settings (`/org/members`)
The organization's name, kind, high school, and website (owner edits); the **join code** with its link, Copy, and
Regenerate; the members with roles and Remove (owners); **Invite a counselor** (email; a 30-day link, emailed when
configured, otherwise copied). A counselor can leave; the last owner can't leave without naming another, and deleting
the organization (owner, typed confirmation) ends every grant and deletes its notes and asks; the students' own data is
untouched, since none of it was ever the organization's.

### Export (`/org/export`)
A CSV of the caseload for Naviance, Scoir, or a spreadsheet: student, class of, record sections filled, college, level,
status, round, deadline, outcome; one row per college per student, students with empty lists as one row. The same
columns the list's own CSV export uses where they overlap ([saved-lists.md](saved-lists.md)), so a counselor who used
both gets the same words. Never a GPA or score: the office collects those from the student, and the file may travel.

## The student's side
- **`/account` → Your counselors**: each organization with a live grant: its name, the counselors' names, **Can edit /
  View only**, **End access**, and when it was granted. The access log already there shows counselor reads with the
  counselor's name. A student with no grants sees nothing here (no upsell for a feature they didn't ask for).
- **The banner** on every page a counselor opens, in the counselor's own session; the student sees the log, not the
  banner.
- **A parent** sees their child's counselors in the same section on the child's page in the household, and can end a
  grant they made.
- **The advisor** shows asks as notices; nothing else changes for the student.

## The channel
What the site does to turn a caseload into families who buy the advisor, and what it refuses to do:
- **The free line, everywhere a counselor looks:** on `/org` before the organization exists, on the pricing page
  ([commercialization.md](commercialization.md#pricing-page-pricing)), and on the advisor's splash page
  ([advisor.md](advisor.md#3-the-page-advisor-signed-out), whose Counselors section now links to `/org`).
- **The student's path is the normal one.** A student who joins through a counselor gets the same account and the same
  splash page as anyone; when the trial ships, the same trial. Nothing is cheaper or dearer for coming through an office.
  The "counselor recommended" first-year code ([commercialization.md](commercialization.md#open-questions), question 4)
  stays an owner question; nothing here assumes it.
- **The counselor sees the advisor status**, nothing more: no "3 of your students haven't subscribed", no prompt to
  remind them, no referral link, no commission. The caseload is the pitch.
- **Measured** by telemetry that counts and never identifies: `org_created {kind}`, `org_student_invited {method}`,
  `org_student_joined {source, new_account}`, `org_ask_sent {kind}`, `org_caseload_viewed {size}` (a bucket), plus the
  existing sign-up events' `role_hint`; registered in [telemetry.md](telemetry.md#event-registry). The admin console
  lists organizations (`/admin/organizations`: name, kind, members, students, invited, created) so the owner can watch
  the channel.

## Rules
- Counselor access is a grant from the student or their guardian, visible in the student's `/account` with the access
  log, revocable at once, and never created by the organization.
- A counselor's visibility is exactly the grant; no page of the portal widens it, and the portal's own reads run with
  the counselor's session under row-level security. The caseload computes from data the counselor could open one
  student at a time; it never calls a function that sees more.
- Nothing about money reaches a counselor except the advisor-status chip and the free line. Nothing about one student is
  compared with another ("Jordan is behind Alex") anywhere, as the parent's rules say.
- The organization's notes and asks are the organization's; the student's record, list, plan, and essays are the
  student's. Ending a grant leaves the notes with the office (they wrote them) and removes every other trace of the
  office from the student's pages.
- The estimate never reads anything a counselor enters or anything about the organization
  ([../chances/README.md](../chances/README.md#quads-estimate-is-proprietary)).
- Design rules hold ([../design-system.md](../design-system.md), [../mobile.md](../mobile.md)): the caseload is a list of
  rows on a phone, every term has a glossary entry (`counselor-organization`, `join-code`, `counselor-access`, `ask`),
  and the less-text rule applies.

## Phases
1. **The caseload** (this build): the model and policies, joining by invitation and code, `/org` and its pages, asks,
   notes, the export, the student's `/account` section, the admin list, telemetry, the glossary.
2. **Rep visits at the school** (small, after visit events learn a venue's school): the caseload's calendar of colleges
   visiting the organization's high school. Not started.
3. **Scattergrams**: [scattergrams.md](scattergrams.md) as written: the upload from a Scoir or Naviance export, scrubbed
   in the browser, matched and binned on the server, stored under the organization and its `ncessch`, shown to the
   school's students beside Quad's estimate. This is the phase with the data processing agreement, because it is the
   phase where a school's own records arrive. Its own roadmap entry again, since the caseload no longer waits on it.

## Files
- Migration `supabase/migrations/20261102120000_organizations.sql`: the five tables, policies, `is_counselor_of()`, the
  replaced bodies of `can_read_student()`, `can_edit_student()`, and `log_access()`, the functions
  (`create_organization`, `org_invite`, `accept_org_invitation`, `join_organization`, `end_org_access`,
  `set_org_student_can_edit`, `regenerate_join_code`, `org_roster`, `my_organization`, `my_counselor_grants`,
  `org_ask`, `org_ask_done`), the admin read policies, and `viewer_bundle()` extended with the viewer's grants.
- `lib/org-rules.ts` (pure: types, `ORG_ERRORS`, join-code format, `caseloadRows()`, CSV columns), `lib/orgs.ts`
  (server reads), `app/org/actions.ts` (Server Actions), `app/org/**`, `app/join/**`, `components/org/**`,
  `components/account/ViewerBanner.tsx` (the guardian banner with a relation), the `relation: "counselor"` value on
  `StudentAccess` and every place that branched on "guardian" meaning "not the student".
- Tests: `tests/orgs-policies.test.mts` (PGlite: a counselor reads a student's list, record, plan, and essays; never
  finances, private notes, or a nudge's text; an ended grant stops at once; another organization sees nothing; view-only
  blocks writes; a code joins; an invitation's lifecycle; the access log records the read; guard tests that break each
  rule), `tests/org-rules.test.mts` (the rows, the shape line, the CSV, the code format), `tests/org-pages.test.mts`
  (the join page's states render; the banner's words).

## As built (2026-11-01)
Phase 1 was built in six units on sub-branches from the brief in `~/Projects/college-stats/counselor-portal-build/`
(U1 model and U2 viewer relation, then U3 pages, U4 joining, U5 admin and glossary, then a terms pass and QA), merged
on `feature/counselor-portal`. Where this section and the plan above disagree, this section is what runs. The two
subsections after it are the viewer and joining units' own notes.

**The model** (`supabase/migrations/20261102120000_organizations.sql`; `lib/org-rules.ts`, `lib/orgs.ts`). The six
tables of the plan (`organizations`, `org_members`, `org_invitations`, `org_students`, `org_notes`, `org_requests`),
all under row-level security. `can_read_student()` and `can_edit_student()` were replaced with the same signatures and
one more clause, `is_counselor_of(student, need_edit)`, so every policy that already asked them (the record, lists and
items, the plan's tables, offers and letters, application snapshots, the essays) opened to a counselor with a live
grant without a change of its own. `log_access()` accepts a counselor's read through the same path; `my_access_log()`
gained `viewer_role`; `viewer_bundle()` carries the caller's grants so `studentsICanSee()` stays one round trip; the
essay comment and suggestion triggers write `author_role = 'counselor'`; `merge_managed_student()` carries grants,
notes, and asks to a claimed record. The family (`is_family_of`: the student, a managing or household guardian) alone
grants, changes, and ends a grant; `can_read_student` can't be the gate there, since it now includes counselors. Join
codes are six random letters (consonant and vowel), stored without the `QUAD-` prefix the pages show; invitation tokens
are readable by no API role (the Copy link comes through `org_roster()`); repeats return the existing row rather than
failing; deleting an organization keeps its memberships as a record. `tests/orgs-policies.test.mts` (39 tests, 14
guards) proves a counselor reads the granted student's record, profile, lists, plan, and essays and zero rows of
finances (a stand-in table until that spec is built), households and homes, private notes, a parent's nudges, or
another organization's students, and that an ended grant reads nothing at once.

What a counselor with edit access can do that the plan didn't spell out, because an editing guardian can: turn on a
list's public share link, see award offers, see the student's phone. Owner questions, not changed in this build.

**The pages** (`app/org/**`, `components/org/**`, `lib/org-caseload.ts`). `/org` is the start form (name, consultant or
school, the high school picker, website) with the free line, or the caseload. The caseload's rows come from
`caseloadRows()` in `lib/org-caseload.ts` (its own module so the join page's client code doesn't carry the planner):
the name and class, the advisor-status chip (`advisorStatusFor()` in `lib/entitlements.ts`, "Preview" for everyone
today), the record's filled count with the missing sections on hover, the list's count and shape line, applications
in, the next deadline, last activity, and the parent's stuck signals as short chips with the sentence on hover (the
student page shows the sentences), minus the ED-estimate signal, which is about money a counselor never sees. Reads
are a handful of `.in()` queries with the counselor's session over the roster's ids; levels come from the items'
stored category; no estimate runs; the caseload view doesn't write the access log (the student page does, through
`openStudentAs()`). `/org/students/new` takes one or several students (pasted lines) and shows each link to copy,
emailing it when email is configured (`lib/emails/org-invitation.ts`). `/org/students/[id]` has the banner, the summary
line, the signals, and the four panels; asks go through `org_ask` with the limits in SQL, email the student once
(`lib/emails/org-ask.ts`; the address is the portal's one service-role read, pinned by a test, as nudges already do),
and show at the top of the student's Next steps (`components/org/AskNotice.tsx`, rendered by `PlanTabs` for the student
and parents, not for a counselor), where a filled section or a non-empty list closes its own ask after the response.
`/org/members` holds the settings, the join code with Copy and Regenerate, members, roles, Invite a counselor (whose
link is also a `/join/<token>` page), Leave, and Delete with a typed confirmation. `/org/export` writes the CSV with no
GPA or score. Every `/org` page is `noindex`. Server Actions live in `app/org/actions.ts`. `tests/org-caseload-db.test.mts`
runs the caseload's reads on PGlite in the shape the pages ask for; `tests/org-pages.test.mts` renders every page and
guards noindex, no service-role or estimate reads, the notice's position, and the CSV's columns.

**Admin, telemetry, glossary.** `/admin/organizations` and `/admin/organizations/[id]` (`lib/admin/organizations.ts`,
reading the tables directly through the "Admins read" policies, since `my_organization()` and `org_roster()` are scoped to
members; never a token), the rail entry after Households, one line on a person's and a student's admin pages. The five
events are registered (`org_created` and `org_ask_sent` from the server, `org_student_joined` from the join action,
`org_student_invited` from both sides, `org_caseload_viewed` from the page) and in [telemetry.md](telemetry.md#event-registry).
Glossary: `counselor-organization`, `join-code`, `counselor-access`, `ask`, linked from the banner, the join page, the
account section, and the portal's pages.

**Owner steps.**
1. Apply `supabase/migrations/20261102120000_organizations.sql` to the dev project (SQL Editor, or
   `psql "$SUPABASE_DB_URL" -1 -f …`); it was not applied during the build. Until then `/org` shows the start form and
   creating an organization fails with a plain message; `/join/<code>` says the code doesn't exist.
2. Nothing in Vercel: no new environment variables. Emails go out only where `RESEND_API_KEY` and `EMAIL_FROM` are set.

**Left for later, knowingly.** `viewer_bundle()` sends a counselor every caseload student and profile on every request
(fine at tens of students; a paged read at hundreds). "Added by Ms. Rivera" shows to the counselor's office; the family
still sees "Added by a guardian" for a counselor's edit until `my_counselor_grants()` returns the counselors' ids. Ask
buttons appear on every missing record section, including Story and Recommenders, which aren't due until the summer
before senior year. The award-letter storage bucket's policies weren't reviewed for the counselor relation. Per-counselor
caseloads inside an office, rep visits at the school (phase 2), and the scattergram upload (phase 3, its own roadmap
entry) are not built.

### Built: the counselor as a viewer (2026-11-01)
`lib/viewer-relation.ts` keeps two questions apart: **is this someone other than the student** (`isViewer`,
`relation !== "self"`: a parent or a counselor) and **is this a parent** (`isParent`). Covered for a counselor like a
parent: the banner (`components/account/ViewerBanner.tsx`; `GuardianBanner` wraps it), read-only or editing by
`canEdit`, logging the read (record, plan, essays), redacting the story (`profileForViewer`, the intake's draft, the
profile save), the AP privacy switch staying the student's, the list page's banner, the person header, the record
page. Parent-only, so never a counselor: Your part, nudges, the money lane's "your part", outcome-sharing consent for
a managed student, "hasn't joined your household yet", the family's calendar feed, the header's new-move dot, the
child switcher. Student-only stays so: the ED decision, the story's field, drafting essays. A counselor never lands in
the first-run intake (the record's Edit still opens it with edit access). `PlanContext.viewer` carries `isCounselor`;
`plan_opened.viewer`, `record_overview_opened.viewer`, and `plan_move_done.by` / `plan_move_restored.by` gain
`counselor`. `/advisor`, its guides, its print page, and the essays pages resolve a counselor's `?for=` first
(`counselorAccessFor` in `lib/planner/load.ts`) and show the banner; the advisor adds "Back to caseload"
(`orgStudentHref`, `lib/org-hrefs.ts`) and a people line of just that student. The household hub shows a counselor
without a household no family frame, and `app/household/[person]/layout.tsx` puts the caseload strip
(`components/account/CaseloadStrip.tsx`: "Caseload" and the one student) above a caseload student's pages.
`tests/viewer-relation.test.mts` sweeps for `relation === "guardian"` with an allowlist of the parent-only sites.

### Built: joining, the account, and the way in (2026-11-01)
`/join` is a plain GET form (`?code=` takes "QUAD-RIVERA", "rivera", or a pasted link and opens `/join/<CODE>`).
`/join/[code]` tells a 64-hex invitation token from a code and decides its state in `lib/join-rules.ts` (`joinState`):
not found, closed (used, expired, cancelled), signed out (Create an account with `?mode=signup&role=student`, or
`role=counselor` for a counselor's invitation, and Sign in, both with `next` back to the page), a student (Join for
their own record, made first by `currentStudent()`), a guardian (choose one of the students they see as a parent),
a counselor's invitation (Join as a counselor, landing on `/org`), and anyone else (the plain message). `JoinView`
renders it; `app/join/[code]/actions.ts` calls `join_organization` / `accept_org_invitation`, sends
`org_student_joined {source, new_account}` (new: email confirmed, or profile made, in the last two minutes), and lands
on the student's advisor with `?joined=<grant id>`, which shows one line (`components/account/JoinedNotice.tsx`).
**Your counselors** (`components/account/CounselorsSection.tsx`, from `my_counselor_grants()`) is on `/account` for
the student's own record and on a child's household page for a parent: name, counselors, since when, Can edit / View
only, End access (with a confirm); nothing when there are no grants. The access log reads "Ms. Rivera (counselor)
viewed your list". `/api/me` carries `org` (from `my_organization()`), so the avatar menu and the phone's More sheet
show **Caseload** for members. A new account whose role hint is counselor and that has no `next` of its own lands on
`/org` after confirming (`firstLanding` in `lib/accounts.ts`). The splash page's Counselors section links to `/org`
with the free line. Tests: `tests/join-page.test.mts` (states, rendering, codes, the `next` round trip, the section,
the menu, the landing) and `tests/join-db.test.mts` (the joins, the refusals, and the grant controls on PGlite).

## Open questions
1. ~~Seat pricing~~ Closed 2026-10-26: free. ~~A block of advisor plans bought by an office~~ Not in this model: the
   family pays, the office never does ([commercialization.md](commercialization.md#open-questions)).
2. **Per-counselor caseloads inside a school office** (each counselor sees only their alphabet range): not in phase 1;
   every member sees every student. Revisit when a school with several counselors asks.
3. **Should a parent be told when their child joins a caseload?** Phase 1: the grant shows on the child's page in the
   household and in the access log; no email. Recommended to stay that way (the student can share their account with
   whom they choose at 13+, as the accounts spec decided).
4. **The "counselor recommended" code** for a first-year price stays with commercialization.md's question 4; the
   portal carries nothing that assumes an answer.
