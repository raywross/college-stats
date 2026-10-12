# Admin console: the shell and People pages (as built)

> Status: **built 2026-10-12** on `feature/admin-people-ui`. The plan is [admin.md](admin.md); this page records what the
> screens do and the choices the plan left open. Part of [product](README.md).

## Shell
- `app/admin/layout.tsx` decides by standing, from `adminState()` through the pure table `shellFor()`
  (`lib/admin/console.ts`): not an admin, signed out, or sign-in unconfigured → a 404 (the console's existence isn't
  advertised); signed in but `is_admin_any_aal()` missing → a setup notice; an admin at `aal1` → the second-factor step
  in place of every page; an admin at `aal2` → the rail and the page. The layout is a convenience: every page, route
  handler, and Server Action checks again (`requireAdmin()`, `withAdmin()`), and the database checks `is_admin()` on every
  read and write.
- **Rail** (`components/admin/AdminRail.tsx`): People, Colleges, Health, Operations, Log, plus "Who is an admin"; the global
  search at the top. From `lg` a left column; on phones a strip (search, then the sections in one swipeable row).
- **Global search** (`AdminSearch`) is a GET form to `/admin/people?q=`. One hit opens its page; several list; none says so
  and points to Colleges. Colleges and high schools are searched on their own pages (unit U7).
- `robots: noindex, nofollow` on the layout and every page. **No analytics under `/admin`**: `AnalyticsProvider` renders
  nothing there (`isAdminPath()` in `lib/analytics.ts`), so posthog-js isn't loaded and no event is sent.
- `proxy.ts` refreshes the session on `/admin/:path*`.
- The site Header, Footer, and tab bar still render around the console (they belong to the root layout).

## Second factor
`components/admin/MfaStep.tsx` (client) calls Server Actions in `app/admin/mfa/actions.ts`, not `supabase.auth.mfa` in the
browser: the site's browser never talks to Supabase (httpOnly session cookies, no public key), and a Server Action may
write the cookies, so the session that comes back from `verify` is the `aal2` one. `startEnrollment()` clears stale
unverified factors, enrolls TOTP, and returns the QR code (an SVG data URI) and the secret; `verifyCode()` runs
challenge-and-verify on the session's own factor. Both refuse unless the session is an admin at `aal1`, and enrolling
refuses when a verified factor exists. After `verified` the component calls `router.refresh()`.

## People
- **Search** `/admin/people`: `admin_search_people`. Rows show kind, name, email (the only place on the site that shows one
  beside a name), household, status chips (Paused, Deleting, Invited, No account yet), created and last sign-in.
- **A person** `/admin/people/[user]`: Account (with Auth data from `admin_user_auth`), Households (with **Leave**), Student
  records, Lists and plan (counts only; the lists open on the student page), Notifications, Who viewed their data. Actions in
  a right column (below the content on phones, with a "Jump to actions" link): Edit details, Change email (typed twice,
  optional re-point of invitations), Copy reset link, Send reset email (shown only when `emailConfigured()`), Sign out
  everywhere, Deactivate (reason required) / Reactivate, Delete account (typed `delete`; then `admin-auth sign_out`),
  Export their data. A deleted account shows a banner with the purge date and only **Restore** and **Delete now** (typed:
  the account's email, read by the action). An admin can't deactivate or delete their own account here.
- **Copy reset link** returns the link in the action's state; `AdminForm` shows it once in a box with Copy. It is never
  logged, never put in a URL, a storage key, or a redirect.
- **Export** is a `POST` to `/admin/people/[user]/export` (a plain form), because it writes log rows.
- **A household** `/admin/households/[id]`: roster (students, then guardians), invitations with state (never a token),
  seats, home as a place. Actions: Rename, Remove a person (typed `remove`), Cancel an invitation, Close (empty only), and
  two pickers (`?add=student|parent&q=`) that search, then offer **Add** or, for someone already in another household,
  **Move here** with the sentence naming that household (`moveWarning()`). A parent's can-edit box starts ticked.
- **A student record** `/admin/students/[id]`: the page calls `admin_log_access` once per render, **before** reading
  anything, so a failed log means a failed page; a missing student is a 404. Shows the record, numbers, lists (each
  college with `StandingPanelSlot`, which unit U7 fills), plan, snapshots, and who viewed. Edit, Attach to an account
  (managed records), Delete the record (typed `delete`, managed records only). Each Server Action refresh re-renders the
  page, which logs another view.
- **Log** `/admin/log`: filters by action, admin, target kind and id, in the URL; paged by the last row's id ("Older").
- **Who is an admin** `/admin/admins`: grant by searching a person, revoke with the rules (not yourself, not the last
  admin; the buttons say so and the database refuses either way).
- **On `/household`**: a one-line notice per admin link or unlink of the last 30 days, "Quad support added Jordan to this
  household on Oct 12", from `admin_household_notice`. Never the admin's name; a member name that is an email address
  reads "someone".

## Refusals
Every database refusal has plain text (`ADMIN_ERRORS` in `lib/admin/constants.ts` plus `HOUSEHOLD_ERRORS`), and every
admin-auth failure too (`authFailureMessage()`); a test reads the migration's `raise exception` names and fails if one
has no text. A thrown error becomes a generic message and a log line naming the action, never the error's text.

## Tests
`tests/admin-console-ui.test.mts`: the layout's table against the real `adminState()`; every page and route handler calls
`requireAdmin()`; every action goes through `withAdmin()`; the actions refuse without an admin session; typed
confirmations are enforced in the actions as well as the button; the reset link stays out of logs and URLs; the student
page logs once, first; the notice wording; no analytics under `/admin`. Each guard is shown failing when broken.
