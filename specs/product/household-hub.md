# Household Hub: People by Name, One List Each

> Status: **planned** 2026-10-06 from the owner's review of the first accounts build. Reshapes what
> [accounts.md](accounts.md), [saved-lists.md](saved-lists.md), [follow-colleges.md](follow-colleges.md), and
> [student-profile.md](student-profile.md) built: the household page becomes the one place a family works from, every
> person is shown by name, and "my list" and "following" become a single list that each person, parent or student,
> owns. The plan that helps a student work through that list is its own spec,
> [application-plan.md](application-plan.md). Part of [product](README.md).

## Goal
A parent adds the family in two steps: **who they are** (a parent or a student), then the few details that role needs.
Everyone appears by **name**, everywhere: the roster, the avatar in the header, the "Added by" line on a list. Someone
who hasn't accepted yet sits in the same roster with a plain status and the link to copy or send again. From the
roster, clicking a person opens **their** page: their list and, for a student, their numbers. There is one kind of list,
and every person has one; "follow" is a switch on each college on it, on by default.

What the owner found in the first build (2026-10-06):
- Adding a person asked for an email first and a role second, and a student added without an account took a
  different form from one invited with an email.
- A parent who accepted an invitation showed as **E** in the header (the first letter of her email) and as "A guardian"
  with a **?** avatar in the roster, because nothing had asked for her name.
- Pending invitations sat in a separate "Waiting for an answer" section, apart from the people they'll become.
- "My numbers", "My list", and "Following" were three menu entries for what a family thinks of as one thing: each
  person's colleges. "Follow" and "add to my list" looked like two ways to do the same thing.

## Research and decisions (2026-10-06)
- **Invite to a password, not to a sign-up.** Supabase Auth's admin API can create a user whose email is already
  marked confirmed (`auth.admin.createUser({ email_confirm: true })`) and can mint an **invite link**
  (`auth.admin.generateLink({ type: "invite" })`) that lands the person signed in, so the only thing left to do is
  choose a password. The link itself proves they own the address, which is what email confirmation is for. The site
  already lands links on `/auth/confirm` in the implicit flow ([accounts.md](accounts.md#sign-in)), so the invite
  link reuses that page. The catch: the admin API needs the **secret key** on the server, and
  [supabase.md](../supabase.md#keys) keeps that key out of Vercel. See [owner decisions](#owner-decisions).
- **Why not just turn email confirmation off?** Then anyone could sign up with someone else's address and the invite
  flow would accept whoever got there first. Confirmation stays on for ordinary sign-up; invited people skip it
  because the token in their hands already did the job.
- **Copying a pending link.** Today only the token's **hash** is stored, so a link can't be shown twice; "New link"
  makes a fresh one and the old one dies. The owner wants Copy to work from the roster. Decision: store the token
  itself for a pending invitation (`invitations.token`, cleared on accept, cancel, or expiry). It is a 7-day,
  single-use secret readable only by the household's own members, who are the people who'd forward it anyway. The
  hash column stays for the lookup.
- **One list per person, parents included.** The list hangs off a `students` row today, and a guardian has no row.
  Rather than a new "person" table, a list gets an **owner**: a student record **or** a user (the guardian).
  Guardian lists are visible to the whole household and editable by the owner only; the privacy model stays about
  finances, not about which colleges Mom likes ([accounts.md](accounts.md#privacy-model)).
- **Follow is a column, not a feature.** `follows` keeps working as the digest's input, but it becomes a table a
  trigger maintains from `list_items.updates`; nothing in the interface says "follow" any more, and the profile's
  Follow button goes. Google, Apple, and Scoir all use one "saved" verb with notification settings per item; two
  verbs for one gesture was the confusion.
- **Status and outcome already track "plan to apply" and "accepted"**: status `applying` and outcome `admitted`
  ([saved-lists.md](saved-lists.md#model)). The new tracking row shows them as checks beside the new ones (visited,
  following on social media, updates) rather than adding parallel columns; ticking "Applying" sets the status, and
  "Accepted" sets the outcome, so the Scoir-compatible export is unchanged.
- **Names, not logins.** Every place that shows a person reads `display_name` first and never an email. The header's
  avatar uses the first letter of the first name; `initialsFor()` already does that when a name exists, so the fix is
  to make sure every account **has** a name: the invitation carries it, acceptance writes it, and `/account`'s
  profile form asks for it before anything else.

## Adding a person
On the household page, **Add someone** asks one question first: **a parent or guardian**, or **a student**. The form
then shows only what that role needs.

| Role | Asked | Optional | What happens |
|---|---|---|---|
| Parent or guardian | first name (and last, optional), email | phone | An invitation with the name attached. They get a link; opening it signs them in and asks for a password, nothing else. They appear in the roster at once, by name, marked **Invited**. |
| Student | first name (and last, optional) | email, phone, high school graduation year | Without an email: a managed student record, as today ([accounts.md](accounts.md#built-households-2026-10-05)), shown by name. With an email: the same record **plus** an invitation to claim it, so the parent can start the list now and the student finds it theirs when they set a password. |

- Phone is stored (`profiles.phone`, `students.phone`, E.164 after `libphonenumber-js` parsing, US default) and shown
  on the person's row to the household. It is not used for anything yet; [application-plan.md](application-plan.md)
  proposes text reminders, which would need consent at that point. Never shown outside the household, never exported
  to anyone but its owner.
- A student invites a parent the same way (the role question defaults to "parent" for them and "student" for a
  guardian). The edit-access tick for a parent stays as it is.
- The **inviter can't invite themselves** and the roles a person may add stay as built: students add guardians;
  guardians add either.
- Seats: a student with an email takes one seat, not two (the invitation hands over the record, which already holds
  it), as the six-seat rule already says ([accounts.md](accounts.md#rules)).

### The invited person's first visit
1. The link opens `/auth/confirm` signed in (Supabase's invite link, implicit flow), which sends them to
   `/account/password?welcome=1` with a one-line explanation: "Tracy added you to the Ross household. Choose a password
   to finish." Name and role hint are already on their profile from the invitation's user metadata (the sign-up trigger
   copies them, as it copies them from ordinary sign-up today).
2. Setting the password calls `accept_invitation()` with the invitation id carried in the user's metadata, so the
   membership activates in the same step. No second "Accept" click.
3. They land on the household page, in the roster by name, with their own empty list.
4. Someone who **already has an account** with that email gets the existing flow instead: the email says to sign in and
   accept; `/invite/[token]` works as today. The invite form notices this when `createUser` reports the address taken.
5. Expiry stays seven days. An expired invitation shows **Expired** on the row with "Send again", which mints a new
   link to the same name and email.

## The roster: everyone by name
One list on the household page, in this order: students, then guardians, each row with:
- **Avatar** with the first letter of the first name (`initialsFor(name, null)`; never the email, and never **?**: a
  row with no name at all, which only old data can produce, shows the role's first letter).
- **Name**, "(you)", the role badge, grad year for a student ("Class of 2028"), and for a guardian the view/edit line.
- **Status**, when the person hasn't finished joining: **Invited** (with "expires Oct 13"), **Expired**, and for a
  student added without an email, **No account yet**. Active members show nothing.
- **Actions** on the right: for an invited person **Copy link**, **Send again** (emails it when email is configured;
  otherwise copies), **Cancel**; for a managed student **Invite them** (the email form); the existing Remove, Allow
  editing / View only, and Leave.
- The whole row (name and avatar) links to the person's page, below.

The separate "Waiting for an answer" section goes. The data for it is the same `invitations` rows, now joined into the
roster by `household_roster()` returning pending invitations as rows with `status: "invited" | "expired"` and
`display_name` from the invitation. `/account`'s household summary lists names the same way ("Alex, Tracy (you),
Jordan (invited)").

## The household page as the hub
`/account/household` becomes **`/household`** (the old path redirects), and it is where the avatar menu's first entry
goes. It holds, top to bottom: the roster, the home address (as built), and **Add someone**. The menu loses "My
numbers", "My list", and "Following"; it reads **Household · Your account · Sign out**. Someone with no household yet
sees the same page with just themselves in the roster and "Add someone" inviting them to start a household (the
name-the-household step folds into adding the first other person: "The ___ household", prefilled from their last
name when there is one).

### A person's page: `/household/[person]`
`person` is the student id for students and the user id for guardians. The page has the person's name as its title,
the guardian banner when a guardian is viewing a student ([accounts.md](accounts.md#contracts-for-later-units)), and
two tabs:
- **List** (default): the person's list, exactly `/me/lists/[id]` as built (categories, status, round, notes, deadlines,
  distance, share, CSV), plus the tracking row below. Extra lists stay reachable from the list switcher.
- **Numbers** (students only): the profile form and completeness meter from `/me`.

`/me`, `/me/list`, `/me/lists/[id]`, `/me/following`, and `/me/updates` keep working as redirects to the signed-in
person's own page (and `/me/updates` becomes the **Updates** section on that page, under the list), so nothing linked
from a digest email breaks. The `Add to list` button on profiles, Explore, and Compare is unchanged for a student; for
a guardian it now adds to **their own** list (today a guardian has none and the button does nothing useful).

## One list per person
### Model
```
lists       (id, student_id null, user_id null, name, is_default, share_enabled, created_by, created)
             check ((student_id is null) <> (user_id is null))       -- exactly one owner
list_items  (… as built …, updates bool default true, visited_on date null, follows_social bool default false)
follows     (user_id, unit_id, source: 'list', created)                 -- maintained by trigger only
```
- **Owner.** `student_id` for a student's list (as today); `user_id` for a guardian's. `is_default` is unique per
  owner, so the partial unique index gains a twin on `user_id`.
- **Reading a guardian's list**: every active member of the guardian's household (the new policy uses
  `is_household_member(household_of(user_id))`). **Writing**: the owner only. A student's list keeps its rules
  (student, or a guardian with edit access).
- **`updates`** (default on): "tell me when this college's numbers change." The follows trigger, which today adds a
  `list` follow for the student's own user when an item is inserted, now fires on insert, delete, **and** `updates`
  changes, and resolves the user to notify as the list owner's user: the student's `user_id`, or the guardian's. A
  managed student has no user, so the guardian who manages them (`managed_by`) is notified for that list, labelled in
  the digest "on Alex's list". The `manual` source is retired: `follows.source` is always `list`, and the Follow button
  is removed from the profile hero and Compare. Existing `manual` follows are migrated into the user's default list as
  items with category `unsorted` and `updates = true`, so nobody loses an update.
- **`visited_on`**: a date (or null). The tracking row shows it as "Visited" with the date on hover; ticking it without
  a date stores today.
- **`follows_social`**: the person says they follow the college on social media. A tick, nothing more; the plan spec
  suggests which accounts ([application-plan.md](application-plan.md#suggested-steps)) from the college's
  `social` object ([social-accounts.md](../school-identity/social-accounts.md)).
- **"Applying" and "Accepted"** are the existing `status` and `outcome`: the tracking row writes `status = applying`
  (or back to `considering`) and `outcome = admitted` through the same `setItemStatus`/`setOutcome` actions.

### Display
Each list row gains a **tracking row** under the name, five small toggles in one order everywhere:
**Updates · Applying · Visited · Following on social · Accepted**. On, each reads as a filled chip; off, an outline.
On phones they wrap to two lines. A guardian without edit access sees them read-only. The CSV export gains `updates`,
`visited_on`, and `follows_social` columns after the Scoir ones, which import ignores if absent.

The list page keeps the balance line and "Next 30 days" strip. The **Updates** section below the list replaces
`/me/updates`: the digests this person received and the changes that didn't warrant one, filtered to this list's
colleges.

### What goes
- The Follow button (`components/FollowButton.tsx`) and `/me/following`.
- The `manual` follow source and `followWrite()`'s upgrade rule.
- The "Update emails" switch moves to `/account` (it is per account, not per list) with the same one-click
  unsubscribe behind it.

## Migration
One new file, `supabase/migrations/2026…_household_hub.sql`, applied to dev before prod:
1. `profiles.phone`, `students.phone` (text, E.164, checked by a regex), `invitations.display_name`, `invitations.phone`,
   `invitations.grad_year`, `invitations.token` (nullable; set by `create_invitation`, cleared by accept/revoke).
2. `lists.user_id` with the one-owner check, the second partial unique index, and the read policy for household
   members; `list_items.updates`, `visited_on`, `follows_social`.
3. `household_roster()` returns pending invitations as rows (`status`, `display_name`, `invitation_id`, `expires_at`).
4. `create_invitation()` takes the name, phone, and grad year; `accept_invitation()` writes `display_name` to the
   profile when it is empty (and to the student record for a claimed one); a new `accept_invitation_by_id()` for the
   password-setting step, callable only by the invited user (`auth.uid()` must match the invitation's `accepted_by`
   pre-set at `createUser` time).
5. The follows trigger rewritten for `updates` and for guardian-owned lists; a one-time statement moving `manual`
   follows into default lists; `follows.source` constrained to `'list'`.
6. Tests in `tests/household-hub-policies.test.mts` (PGlite, as the other policy tests): a guardian's list is readable
   by the household and writable by nobody else; a student's list rules are unchanged; the trigger adds, removes, and
   re-points follows for every owner kind; a guard test that drops the one-owner check and shows a list with two owners.

## Files
| File | Change |
|---|---|
| `app/household/page.tsx`, `app/household/[person]/page.tsx` | The hub and a person's page (list and numbers tabs); `/account/household`, `/me*` redirect here |
| `components/account/Roster.tsx` | The one roster with status and actions; replaces the members list, the pending section, and `HouseholdSummary`'s member line |
| `components/account/AddPersonForm.tsx` | Role first, then the role's fields; replaces `InviteForm`, `AddManagedStudentForm`, and `LinkManagedStudent` |
| `app/household/actions.ts` | `addPerson` (branches on role), `copyInvitationLink` (reads the stored token), `resendInvitation`, the existing member actions |
| `lib/supabase-admin.ts` (server only) | The one module that holds the secret-key client: `createInvitedUser()` and `inviteLink()`; see [owner decisions](#owner-decisions) |
| `app/account/password/` | The `welcome` variant that accepts the invitation on save |
| `lib/list-rules.ts`, `lib/lists.ts`, `components/lists/ListBoard.tsx` | Owner kinds, the tracking row, the three columns in CSV |
| `lib/household-rules.ts` | Roster rows with status; `memberName()` never returns a role fallback when a name exists; `phone` formatting |
| `lib/accounts.ts` | `initialsFor()` first-name-only; `MeState.name` always set when the profile has one |
| `components/account/AccountMenu.tsx` | Three entries |
| Glossary | `updates` (the per-college switch), `tracking` |

## Owner decisions
Decisions 2–4 were approved by the owner on 2026-10-06; decision 1 is open.
1. **The secret key in Vercel** (open). Today an invited person has to sign up themselves and confirm their email
   before accepting, because the site has no account for them. Creating the account for them, with the email already
   marked verified, and minting the link that signs them in are **administrator actions** in Supabase Auth, allowed
   only with the project's secret key, which bypasses row-level security. [supabase.md](../supabase.md#keys) keeps
   that key off Vercel today (only the publish script and GitHub Actions hold it).
   - **Option A (recommended):** set `SUPABASE_SECRET_KEY` in Vercel as a server-only variable, used by exactly one
     module, `lib/supabase-admin.ts`, with a test that no other module imports it; update supabase.md. Simple and
     the usual pattern; the cost is that a leak on Vercel would expose a key that can read every family's data.
   - **Option B:** keep the key inside Supabase by putting the two admin calls in a Supabase Edge Function that the
     Server Action calls with the invitation token. The key never leaves Supabase; the cost is a second runtime and
     deploy step for two small functions.
2. **Approved: store the invitation token in clear** for pending invitations so Copy link works (above). The
   alternative kept hash-only storage and made Copy mint a new link each time, silently killing the one sent earlier.
3. **Approved: a guardian's list is visible to the household** (it's suggestions, and the student should see them).
4. **Approved: phone now, use later.** Collected on the form as asked; nothing sends to it until
   [application-plan.md](application-plan.md) and its consent step.

## Out of scope
Suggested steps, important dates as a plan, nudges, and the parent's check-in view: [application-plan.md](application-plan.md).
Per-student edit grants (today `can_edit` covers every student in the household) stay as built.
