# Accounts and Households

> Status: **built** 2026-10-05 on `feature/accounts` ([foundation](#built-foundation-2026-10-05),
> [households](#built-households-2026-10-05)): email magic-link sign-in, the schema with row-level security,
> `/account`, households and invitations, export, delete, and the access log. Google sign-in and a transactional email
> provider wait for the new domain ([backlog](../backlog.md#platform)). Foundational for
> [saved-lists.md](saved-lists.md), the planning tools, and [commercialization.md](commercialization.md). Part of
> [product](README.md).

## Goal
A person can sign in and keep their work: lists, their own numbers, estimates, and award letters. A **household**
links a parent or guardian to one or more students. The guardian sees each student's lists and planning; the
student never sees the guardian's income, assets, or any other financial input. A student can belong to more than
one household (two parents in different homes), and a guardian can have several students.

Everything on the site today keeps working without an account. Signing in adds memory and tools; it never gates a
federal number ([commercialization.md](commercialization.md#what-stays-free)).

## Research (2026-10-02)
- **Supabase Auth** is bundled with the database the site already uses: 50,000 monthly active users on the free
  plan, 100,000 on Pro ($25/month), and row-level security (RLS) policies can read the signed-in user's id, which is
  how every privacy rule below is enforced. Clerk's free tier is similar in size but adds a second vendor; Auth0
  costs more at the same scale. Choice: Supabase Auth.
- **Next.js App Router pattern:** `@supabase/ssr` keeps the session in `httpOnly` cookies; a server client reads
  them in Server Components, Server Actions, and route handlers. A browser client is optional. The app keeps its
  rule that the browser never talks to Supabase directly ([supabase.md](../supabase.md#keys)): sign-in, sign-out,
  and every read and write go through Server Actions, so no `NEXT_PUBLIC_SUPABASE_*` variable is needed.
- **Minors.** COPPA covers children under 13; Supabase's terms exclude under-13 users. State laws for 13–17 year
  olds (California's Age-Appropriate Design Code, partly enjoined; Nebraska and South Carolina codes from 2025–26;
  California's Digital Age Assurance Act from 2027) restrict profiling, dark patterns, and geolocation rather than
  forbidding accounts. Rule: **13 and older only**, a birth year is asked at sign-up, under-13 is refused, and the
  site runs with the strictest settings for everyone (no behavioral ads, no replay, no geolocation), so no per-age
  branching is needed ([telemetry.md](telemetry.md#privacy)).
- **FERPA** applies to schools and their vendors, not to a family's own use of a consumer site. It matters for
  [counselor-portal.md](counselor-portal.md) and [scattergrams.md](scattergrams.md), not here.

## Sign-in
- **Methods:** email magic link (no passwords to leak or reset). Google is deferred to the backlog (2026-10-05: the
  owner is registering a new domain first); the login form has a marked slot for it. Apple sign-in when there is a
  native app. Passkeys later.
- **Routes:** `/login` (one form, both methods; `?next=` returns to the page that asked), `/auth/confirm` (where
  magic links land), `/auth/callback` (`?code=` / `?token_hash=` links, server-side), `/account` (name, email, birth
  year, households, subscription, export, delete).
- **Sign-in links (fixed 2026-10-05).** Links are sent in Supabase's **implicit flow**: the link returns the session
  in the URL fragment, `/auth/confirm` (a client page) hands it to a Server Action that stores it as cookies after
  checking it with `getUser()`, removes it from the address bar, and moves on to `?next=`. The default PKCE link only
  works in the browser that asked for it, and a phone's mail app usually opens another, so sign-ups confirmed the
  email but never signed in. The cleaner fix (PKCE with a `token_hash` email template) needs an edited template, which
  Supabase's free plan allows only with custom SMTP, so it waits for the new domain ([backlog](../backlog.md#platform)).
  Tested end to end with an admin-generated link opened in a fresh WebKit iPhone browser.
- **Redirect allow list.** Supabase silently replaces a return address it doesn't allow with the Site URL. The Site
  URL must be the live site (`https://college-stats-nine.vercel.app`), with that host, the preview wildcard, and
  localhost in Redirect URLs; a wrong Site URL sent the first live sign-ups to a Vercel login wall.
- **Session:** `httpOnly` cookies via `@supabase/ssr` (`AUTH_COOKIE_OPTIONS` in `lib/supabase-server.ts`; the
  library's default is script-readable); `proxy.ts` (Next 16's name for middleware) refreshes the token; `getUser()`
  (not `getSession()`) in every server read, because only `getUser()` verifies the token with Supabase.
- **Anonymous first.** Tools work signed out with state in `localStorage` (the compare list already does).
  On sign-in, local state is offered for import once ("Save these 4 colleges to your list?"), then cleared.
- The header gains an avatar menu (desktop) and the phone More sheet gains "Account" ([mobile.md](../mobile.md)).

## Roles and households
```
auth.users ──1:1── profiles (display_name, birth_year, role_hint: student | guardian | counselor, created)
                     │
                     ├── households (id, name, created_by)
                     │      └── household_members (household_id, user_id | student_id, role: guardian | student,
                     │                              status: invited | active, invited_email, can_edit)
                     └── students (id, user_id nullable, display_name, grad_year, managed_by nullable)
```
- A **student** record is the unit the tools attach to (profile, lists, chances). It usually belongs to a user
  (`user_id`). A guardian may also create a **managed student** (`user_id` null, `managed_by` = guardian) for a
  child who hasn't signed up; when the child later signs in with the invited email, the record becomes theirs and
  the guardian keeps household access.
- **Invitations** are by email with a signed link (7-day expiry). A student must accept a guardian's link, and a
  guardian must accept a student's; nobody is added to a household silently. Either side can leave at any time.
- A guardian's access to a student is **view by default**; `can_edit` lets the guardian add to lists and notes
  (set by the student, or by the guardian for a managed student). Edits are attributed ("Added by Mom").
- One user can be a guardian in several households and a student in several (two homes). Counselor organizations
  are a separate structure ([counselor-portal.md](counselor-portal.md)) that reuses `students` and the same grants.

## Privacy model
Every user-data table has an **owner column** and a **visibility rule**, enforced with RLS policies that use
`auth.uid()` and the `household_members` table. The UI never decides access; it only reflects it.

| Data | Owner | Guardians in the student's households | Student | Notes |
|---|---|---|---|---|
| Student profile (GPA, scores, major, state) ([student-profile.md](student-profile.md)) | student | read; write if `can_edit` | read/write | |
| Saved lists, notes, statuses ([saved-lists.md](saved-lists.md)) | student | read; write if `can_edit` | read/write | Notes have a `private` flag the guardian can't read |
| Chances results ([chances-and-fit.md](chances-and-fit.md)) | student | read | read | Derived from the profile |
| **Household finances** (AGI, assets, household size, number in college) ([net-price-estimator.md](net-price-estimator.md)) | **guardian** (per guardian user) | own only; another guardian in the same household sees nothing unless the owner shares | **never** | The student sees only an estimate the guardian chose to share, as a range per college, with no inputs |
| Award letters ([award-letter-analyzer.md](award-letter-analyzer.md)) | whoever uploads, attached to a student | read | read | A letter is about the student, so both sides see it; the guardian's financial inputs used alongside it stay hidden |
| Subscription ([commercialization.md](commercialization.md)) | the paying user | n/a | n/a | A guardian's plan covers the students in their households |
| Home address ([home-and-distance.md](home-and-distance.md), built 2026-10-05) | the user | **never** | **never** | Own-row only: each household member sees distances from their own home. Not in the access log |

- **Sharing an estimate** creates a `shared_estimates` row (student, college set, range, as-of date) that the
  student reads; the finances table itself has no policy that any other user can satisfy. A test proves a student
  session selecting from `household_finances` returns zero rows even in the same household.
- Guardians see "what the student sees" through the same queries the student's session would run, with a
  banner ("Viewing as a guardian"). There is no impersonation: the guardian's own session is used, so every access
  is logged under their id.
- **Audit:** `access_log` (who, what table, which student, when) for guardian reads of a student's data, visible
  to the student in `/account` ("Mom viewed your list on Oct 2").

## Data handling
- All user tables live in Supabase only (dev project now; prod at the formal release), created by new migrations
  in `supabase/migrations/`, applied to dev before prod. No JSON counterpart, no publish step.
- Documents are `jsonb` where key order doesn't matter (profiles, settings) and typed columns where it does
  (counts, money). Unlike the dataset tables, these are written row by row.
- **Export:** `/account` → "Download my data" produces one JSON file (profile, households, lists, notes, estimates,
  letters) from a Server Action; a guardian's export includes their finances but not a student's private notes.
- **Delete:** deleting a user removes their profile, finances, letters they uploaded, and memberships; a student's
  record and lists survive if the student's own user still exists; a managed student with no user is deleted with
  its guardian only if no other guardian has access. Thirty-day soft delete, then a scheduled hard delete.
- **Retention:** accounts idle for 3 years get a warning email, then deletion after 90 more days.
- **Secrets:** the Supabase secret key stays out of Vercel ([supabase.md](../supabase.md#keys)). Auth and all
  user-data queries use the signed-in user's token through the server client, so RLS applies to every query.
  Admin tasks (hard delete, migrations) run from scripts with the secret key.

## Files (as planned 2026-10-02; see [Built](#built-foundation-2026-10-05) for what exists)
- `lib/auth.ts` (server-only: `getUser()`, `requireUser()`, `currentStudent()`), `lib/supabase-server.ts`
  (`@supabase/ssr` client bound to cookies), `middleware.ts` (token refresh).
- `app/login/`, `app/auth/callback/route.ts`, `app/account/` (page, household, invitations, export, delete).
- `supabase/migrations/2026…_accounts.sql`: `profiles`, `households`, `household_members`, `students`,
  `invitations`, `access_log`, policies, and `accept_invitation()`.
- `tests/accounts-policies.test.mts`: RLS checked against real Postgres (PGlite, as `tests/supabase.test.mts`
  does): a student cannot read finances; a guardian outside the household cannot read anything; a revoked
  membership stops access at once; the policy test must fail when a policy is removed.
- Env: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (already set) are enough; Auth redirect URLs are configured per
  environment in the Supabase dashboard (local, preview wildcard, production).

## Open questions
1. Should students under 18 need a guardian's consent to create an account at all? Recommendation: no (13+ with a
   birth year, as most consumer education sites do), but a guardian link is encouraged at sign-up.
2. Email provider: Supabase's built-in SMTP is rate-limited (a few emails an hour); a transactional provider is
   needed before launch for magic links and invitations. Decided 2026-10-02 in
   [follow-colleges.md](follow-colleges.md#research-2026-10-02): Resend, shared with the update emails.
3. Counselor sign-in reuses this spec; whether school counselors sign in with Google Workspace SSO (and whether
   that requires district approval) is settled in [counselor-portal.md](counselor-portal.md).

## Built: foundation (2026-10-05)
Unit A of the accounts build. Everything below is in the code; households, invitations UI, export, delete, and the
access-log view build on it.

### Contracts (what later work uses)
| File | Exports |
|---|---|
| `lib/supabase-server.ts` (server only) | `createServerSupabase(): Promise<SupabaseClient>` (new `@supabase/ssr` client per request, bound to `cookies()`; throws when unconfigured), `supabaseAuthEnv()` |
| `lib/auth.ts` (server only) | `authConfigured(): boolean`, `getUser(): Promise<User \| null>` (`auth.getUser()`, per-request `cache`), `requireUser(next?): Promise<User>` (redirects to `/login?next=`), `getAccount(): Promise<Account \| null>`, `currentStudent(): Promise<StudentRecord \| null>`, `studentsICanSee(): Promise<StudentAccess[]>`, `AccountsSetupError` |
| `lib/accounts.ts` (pure) | Types `Account` (`{ user: { id, email }, profile }`), `Profile`, `StudentRecord`, `Household`, `HouseholdMember`, `Invitation`, `StudentAccess` (`{ student, relation: "self" \| "guardian", canEdit }`), `RoleHint`, `MeState`; `birthYearAllowed(year, today?)`, `parseBirthYear`, `safeNextPath(next, fallback?)`, `loginHref(next?)`, `resolveStudentAccess`, `wantsOwnStudent`, `initialsFor`, `INVITATION_ERRORS`, `ROLE_HINTS`, `AGE_GATE_COOKIE` |
| `lib/email.ts` | `sendEmail({ to, subject, html, text, headers }): Promise<SendResult>` (`{ sent: true, id }`, `{ sent: false, reason: "not-configured" }`, or `{ sent: false, reason: "error", error }`; never throws), `emailConfigured()` |
| `components/account/` | `SignInPrompt` (`reason`, `next`, `variant: "card" \| "inline"`), `AccountMenu` (avatar menu; add links to its `ACCOUNT_MENU_LINKS`), `useMe()` (client hook over `/api/me`), `AccountSection` + `ComingSoon`, `SignOutButton`, `AuthUnavailable` |
| `tests/helpers/pg-auth.mts` | `createAuthDb(migrations)`, `asUser(db, userId \| null, sql, params)`, `affectedAsUser(...)`, `createUser(db, { email, birthYear?, roleHint?, displayName? })` |

SQL (`supabase/migrations/20261005120000_accounts.sql`): tables `profiles`, `households`, `household_members`,
`students`, `invitations`, `access_log`, all with RLS. Helper functions (security definer, stable, `search_path = ''`)
for later policies: `is_own_student(uuid)`, `can_read_student(uuid)`, `can_edit_student(uuid)`, plus
`is_household_member(uuid)`, `is_household_guardian(uuid)`, `is_guardian_of(uuid, need_edit)`,
`household_has_members(uuid)`, `birth_year_allowed(int)`. RPCs: `create_invitation(household, email, side, student?,
can_edit?) → { id, token, expires_at }`, `accept_invitation(token) → household id`, `invitation_preview(token)` (anon
allowed; name, inviter, side, expiry, state; never the email), `log_access(student, table)`.

### Decisions made while building
- **13+ from a birth year is conservative:** a year exactly 13 back is refused (that person may still be 12), so in
  2026 the youngest allowed birth year is 2012. Checked in the login action, again by a trigger on `profiles` (the
  sign-up trigger fails the sign-up), and on `/account` edits. A refusal sets a one-day `quad_age_gate` cookie so the
  question can't simply be retried with another year. No guardian consent (owner decision 2026-10-05).
- **Birth year only for new accounts:** the form first tries `signInWithOtp` with `shouldCreateUser: false`; if
  Supabase says there's no such user, it asks for the birth year and "I'm a student / parent or guardian / counselor"
  and sends them as user metadata, which the `on_auth_user_created` trigger copies into `profiles`. "New here? Create
  an account" opens the same fields directly. (This tells a visitor whether an email has an account, as Supabase's own
  API already does.)
- **Header state comes from `GET /api/me`** (`private, no-store`) fetched by `useMe()` in the browser. A visitor
  without an `sb-` auth cookie gets an answer without a call to Supabase. Public pages never read cookies, so they keep
  their static/ISR rendering (checked with `next build`; a test fails if a page outside the account routes imports
  `next/headers`, `lib/auth`, or `lib/supabase-server`).
- **`proxy.ts` runs only on** `/login`, `/auth/*`, `/account/*`, `/me/*`, `/invite/*`, `/api/me`, and only when an
  `sb-` cookie is present. Later account routes add their prefix to the matcher and to `ACCOUNT_ROUTES` in
  `tests/accounts.test.mts`. Server Actions on public pages (Follow, Add to list) refresh the session themselves.
- **Account pages call `connection()`**, so they're rendered per request even when built without keys.
- **`currentStudent()` creates the user's own student record lazily** when their role hint is `student` or unset;
  guardians and counselors get none.
- **Guardian access requires both memberships to be `active`** and the household not deleted; `can_edit` lives on the
  guardian's membership and covers that household's students. Only a student's invitation can grant `can_edit` (a
  guardian inviting another guardian always gives view-only). `status = 'invited'` is reserved: pending invitations
  live in `invitations` and never grant access.
- **Memberships come only from `accept_invitation()`**, except a household's creator adding themselves and a guardian
  adding a managed student they created. Invitation tokens are 64 hex characters; only their SHA-256 is stored.
  Accepting checks expiry (7 days), revocation, reuse, the signed-in user's email, and that it isn't the inviter's own.
- **Claiming a managed student** sets `user_id` and clears `managed_by`; the guardian keeps access through the
  household. If the invitee already has a student record, theirs joins the household and the managed one is left
  alone. Ownership columns can't be changed through the API (trigger).
- **Soft delete:** `profiles`, `households`, `students` have `deleted_at`. A student's owner still sees a soft-deleted
  record (Postgres checks updated rows against the select policy, and it allows restoring); guardians lose it at once.
  App reads filter `deleted_at is null`.
- **Not built here:** names of other household members (needs a function; the `profiles` policy is own-row only),
  changing `can_edit` after joining, removing someone else from a household, export, delete, the access-log view.

### Setup (owner)
1. **Apply the migration** to the dev project: SQL Editor → paste `supabase/migrations/20261005120000_accounts.sql`
   → Run. (Prod later, before the formal release.) Until then account pages show "Accounts aren't set up yet".
2. **Supabase → Authentication → URL Configuration:**
   - Site URL: `https://college-stats-nine.vercel.app` (later the new domain).
   - Redirect URLs: `http://localhost:3000/**` through `http://localhost:3005/**` (each worktree's dev port),
     `https://*-raywross-projects.vercel.app/**` (Vercel previews; adjust to the team slug in a preview URL), and
     `https://college-stats-nine.vercel.app/**`. A redirect URL that isn't listed silently falls back to the Site URL.
3. **Email templates (optional, recommended):** the default Magic Link and Confirm signup templates work with the
   PKCE `?code=` flow, but only in the browser that asked for the link. To make links work when the email opens
   elsewhere (a phone's mail app), change both templates' link to
   `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email` (the app always sends a redirect with `?next=`, so the
   `&` is right; `/auth/callback` accepts both forms).
4. **Rate limit:** Supabase's built-in mailer sends only a few emails an hour per project; enough for testing. The
   login form says "Too many sign-in emails" when it's hit. Before launch, point Supabase Auth's SMTP at Resend
   (Authentication → Emails → SMTP) once the sending domain is verified, and set `RESEND_API_KEY` and `EMAIL_FROM` in
   Vercel for invitations and digests.
5. Vercel needs nothing new: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are already set.

## Built: households (2026-10-05)
Unit B of the accounts build, on the foundation above. Migration `supabase/migrations/20261005125000_households.sql`
(apply after the accounts migration); tests `tests/households.test.mts` (PGlite, every assertion as a user, with
guard tests that break the roster function and the remove policy), `tests/household-rules.test.mts`,
`tests/purge-accounts.test.mts`.

### What's there
- **`/account`**: the household section lists each household's members (names and roles) with a link to manage, or a
  "Start a household" form; **Who viewed your information** (students only) groups `access_log` into lines like "Mom
  viewed your list on Oct 2"; **Download my data**; **Delete my account…**. An account scheduled for deletion sees only
  "Restore my account" and Sign out.
- **`/account/household`**: one card per household: members (name, role badge, view/edit), **Remove** (guardians),
  **Allow editing / View only** (who may decide: below), **Leave**, pending invitations with **Cancel**, the invite form
  (email; guardians pick guardian or student and may hand over a managed student; students tick "Let them edit my
  list and profile"), and **Add a student without an account** (guardians). "Start another household" at the bottom.
- **Invitations** show the link on screen once, to copy ("Send this link to …"), and are also emailed through
  `sendEmail()` when `RESEND_API_KEY`/`EMAIL_FROM` are set. "Not configured" is the normal state today and isn't an
  error. Only the token's hash is stored, so a lost link is cancelled and re-sent.
- **`/invite/[token]`**: `invitation_preview()` (works signed out): household, inviter, side; used/expired/cancelled
  states in plain words; signed out → `SignInPrompt` with `next` back to the invite; signed in → **Accept** →
  `/account/household`. Refusals map through `INVITATION_ERRORS`. `referrer: no-referrer`, `noindex`.
- **`/account/delete`** explains what goes and what stays (each managed student: "stays with Dad" or "removed too"),
  then a typed "delete" confirmation. The action calls `delete_my_account()`, signs out everywhere (`scope: global`),
  and lands on `/account/deleted`.
- **`/account/export`** (GET route; a link with `download`): one JSON file, `quad-data-YYYY-MM-DD.json`.
- Avatar menu gains **Household**. Glossary: `household-invitation`, `edit-access`, `access-log`.

### Contracts for later units
| What | Use |
|---|---|
| `components/account/GuardianBanner.tsx` | `<GuardianBanner studentName={string \| null} canEdit={boolean} className? />`: "Viewing as a guardian · You can (look but not change \| edit) Alice's information. Alice can see when you view it." Server component. |
| `lib/households.ts` (server only) | `openStudentAs(studentId, table): Promise<StudentAccess \| null>`: resolves access via `studentsICanSee()` and, when `relation === "guardian"`, logs the read with `log_access`. Call it at the top of a page that shows one student's data; render `GuardianBanner` for guardians; `notFound()` on null. `logStudentRead(studentId, table)` logs alone (never throws). Also `myHouseholds()`, `myAccessLog()`, `deletionPreview()`. |
| `lib/household-rules.ts` (pure) | Types (`RosterMember`, `HouseholdView`, `AccessLogRow`), `ACCESS_TABLE_LABELS` (add your table's wording: `lists` → "your list"), `HOUSEHOLD_ERRORS`, `errorMessage()`, `editAccessControl()`, `canRemove()`. |
| `lib/account-export.ts` | `ACCOUNT_EXPORTERS`: append `{ key, description, run(ctx) }` for your tables (student profile, lists, follows…). `ctx` has `supabase` (the user's session), `userId`, `email`, `ownStudentId`, `studentIds` (own + managed students the user created). Keys must be unique (tested); a failing exporter fails the whole export. Don't export another person's private data (a student's private notes for a guardian; another guardian's finances). |

### SQL added
`household_roster(household)` (security definer: active co-members' names, roles, `can_edit`, managed flags; empty for
non-members; never emails or birth years), `create_household(name, role)`, `add_managed_student(household, name,
grad_year?)`, `leave_household(household)`, `set_member_can_edit(member, bool)`, `my_access_log(limit?)`,
`account_deletion_preview()`, `delete_my_account()`, `restore_my_account()`; policy **"Members: guardians remove"**
(an active guardian deletes any membership in their household). Internal, not granted to users:
`household_has_actors`, `close_household_if_empty`, `managed_student_heir`.

### Decisions made while building
- **Who removes whom:** an active guardian may remove any other member (guardian or student). A student doesn't
  remove guardians; they leave, or take away edit access. Everyone can leave.
- **Edit access after joining** (`set_member_can_edit`): granted by a student of the household, or by a guardian when
  every student there is a managed record that guardian created (at least one). Nobody grants themselves; a guardian
  can give up their own. Because `can_edit` sits on the guardian's membership, it covers every student in that
  household, so any student there can change it (a known limit of the per-household model; per-student grants would
  need a new table).
- **Leaving or deleting closes a household** when nobody who can act is left (no active guardian and no student with
  an account): it's soft-deleted and its pending invitations are revoked. This also stops a creator who left from
  still seeing an empty household.
- **Delete** (`delete_my_account`, one `deleted_at` for everything): profile and own student record soft-deleted;
  managed students pass to the longest-standing other active guardian in a shared household (who becomes
  `managed_by`), else are soft-deleted with the account; the user's memberships are removed at once; unused
  invitations they sent are revoked. **Restore** within 30 days brings back the profile, the own student record, and
  managed students deleted with it, but not memberships (rejoin by invitation).
- **Purge:** `npm run purge-accounts` (dry run unless `--apply`; `--days N`, never under 30) hard-deletes student
  records, households, and then auth users (Auth admin API, cascading to profiles, memberships, access-log rows)
  soft-deleted 30+ days ago. A soft-deleted student record whose own account still exists is never purged. Run by hand
  with the secret key for now; scheduling it is a later step.
- **Export** is a GET route rather than a Server Action, so a plain download link works; it only reads.
- **Edit attribution** ("Added by Mom") belongs to the tables guardians edit (lists, notes: [saved-lists.md](saved-lists.md));
  nothing this unit writes is a guardian edit of student data except creating managed students, which `managed_by` records.
- **The invitation email** is a plain HTML string with escaped names and a text part (no React render), in
  `invitationEmail()`.
- **Not built:** changing your email address (Supabase `updateUser({ email })` with the `email_change` callback the
  foundation already accepts), the 3-year idle-account warning, and a scheduled purge.

### Setup (owner)
1. **Apply the migration** after the accounts one: SQL Editor → paste
   `supabase/migrations/20261005125000_households.sql` → Run (dev first; prod at the formal release).
2. Nothing else is required. For emailed invitations, set `RESEND_API_KEY` and `EMAIL_FROM` once the sending domain is
   verified; until then the link is shown to copy.
3. **Purge** (monthly, by hand for now): `npm run purge-accounts` to see what would go, then
   `npm run purge-accounts -- --apply`. It uses `SUPABASE_URL` + `SUPABASE_SECRET_KEY` from `.env.local` (dev) and must
   never run in Vercel.

