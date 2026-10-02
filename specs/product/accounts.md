# Accounts and Households

> Status: **planned** (not built). Decided 2026-10-02: Supabase Auth, server-side sessions, households with
> guardian-only finances. Foundational for [saved-lists.md](saved-lists.md), the planning tools, and
> [commercialization.md](commercialization.md). Part of [product](README.md).

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
- **Methods:** email magic link (no passwords to leak or reset) and Google. Apple sign-in when there is a native
  app. Passkeys later.
- **Routes:** `/login` (one form, both methods; `?next=` returns to the page that asked), `/auth/callback` (code
  exchange, server-side), `/account` (name, email, birth year, households, subscription, export, delete).
- **Session:** `httpOnly` cookies via `@supabase/ssr`; `middleware.ts` refreshes the token; `getUser()` (not
  `getSession()`) in every server read, because only `getUser()` verifies the token with Supabase.
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

## Files (planned)
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
2. Email provider: Supabase's built-in SMTP is rate-limited (a few emails an hour); a transactional provider
   (Resend, Postmark) is needed before launch for magic links and invitations.
3. Counselor sign-in reuses this spec; whether school counselors sign in with Google Workspace SSO (and whether
   that requires district approval) is settled in [counselor-portal.md](counselor-portal.md).
