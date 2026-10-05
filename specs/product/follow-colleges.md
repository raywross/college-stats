# Follow Colleges: Update Emails When the Data Changes

> Status: **planned**, partly built. Built 2026-10-05: change detection, the follows schema, the follow Server Actions, and the
> public What changed panel ([As built](#as-built-2026-10-05-change-detection-and-follows-data)). Still to build: the
> Follow button, `/me/following`, `/me/updates`, and the digest. After [accounts.md](accounts.md); becomes useful once
> the [scheduled data refresh](../backlog.md#data) runs on its own. Part of [product](README.md).

## Goal
A signed-in person **follows** the colleges they care about. Each time the site publishes new data, anyone following
a college whose figures changed gets **one email** summarizing what changed, in plain language, with the years:
"Stanford's fall 2025 admissions are in: 3.9% admitted (fall 2024: 4.1%)". Every college on a saved list is followed
automatically, so a family's list keeps itself current without anyone checking back.

The same change record powers a public **"What changed"** panel on every profile, so visitors without an account
also see that a college's numbers moved and when.

## Why it fits
- Federal data arrives in a few big releases a year ([data-page.md](../data-page.md#release-calendar-datarelease-calendarjson)),
  and the college-reported agent ([college-reported-data.md](../college-reported-data.md)) will add a trickle of
  newer figures. A visitor has no way to know when "their" colleges moved, and the lag between a release and the
  moment a family notices it is exactly when the site is most useful.
- It is the cheapest reason to create an account: no numbers to enter, a clear benefit, and a reason to return.
  Free at every tier ([commercialization.md](commercialization.md#feature-map)).
- Every value already carries its source and year ([data-lineage.md](../data-lineage.md)), so a change can be
  described honestly: a **new year** of data, a **revision** of the same year, or a value that **appeared** or
  **disappeared**. Nothing in the email is a number the site can't cite.

## Research (2026-10-02)
- **How changes reach production.** Data changes land as a merge to `main` touching `data/**`, which runs the
  publish Action ([supabase.md](../supabase.md#production)). Publishes are rare (a handful a month at most, even
  with the scheduled sync), so "an email per publish" is a reasonable cadence and needs no batching logic beyond
  one digest per user per publish.
- **Email delivery.** Supabase's built-in SMTP is for auth mail only and is rate-limited; a transactional provider
  is needed anyway for magic links and invitations ([accounts.md](accounts.md#open-questions)). **Resend** (3,000
  emails/month free, React Email templates, one-click unsubscribe headers, webhooks for bounces) fits; Postmark is
  the fallback if deliverability is a problem. Decision: Resend, used by accounts for auth mail too.
- **Sender rules.** Gmail and Yahoo require bulk senders to use a `List-Unsubscribe` header with one-click
  (RFC 8058), SPF/DKIM/DMARC on the sending domain, and a spam rate under 0.3%. The digest meets all three from
  day one; the sending domain is a subdomain (e.g. `mail.<domain>`) so a deliverability problem never affects the
  site's domain.
- **Comparable products.** Niche and College Board send marketing mail, not change notices. Scoir notifies on
  deadlines. Nothing comparable tells families when a college's own numbers changed, which is the point of this site.

## Model
```
follows             (user_id, unit_id, source: manual | list, created)              -- one row per user × college
notification_prefs  (user_id, email_updates bool default true, unsubscribe_token, updated)
dataset_changes     (publish_id, unit_id, field, kind: new_year | revised | appeared | disappeared,
                     old json, new json, old_year text, new_year text, source text)  -- public, written at publish
digests             (id, user_id, publish_id, sent_at, provider_message_id, college_count, change_count)
                     unique (user_id, publish_id)
```
- `follows` is the user's; RLS lets only the owner read and write it. A guardian follows colleges in their own
  right; a student's follows are never visible to anyone else (they reveal the student's list).
- A saved-list item ([saved-lists.md](saved-lists.md)) inserts a `follows` row with `source: list` and removes it
  when the item leaves every list, unless the user also followed it by hand. The profile's Follow button turns a
  `list` follow into a `manual` one so unfollowing the list doesn't silently unfollow.
- `dataset_changes` is **public, derived data**, not user data: it describes the dataset, and the profile panel
  reads it anonymously. It lives next to the published collections and is written in the same publish.

## Detecting changes
Computed once per publish, never per user. `publish-data` already reads the previous version back before swapping
([supabase.md](../supabase.md#publishing-npm-run-publish-data)); the diff runs there, between the previous published
documents and the new files, and is written in the same transaction, so a change record exists if and only if the
data it describes was published.

For each college and each field in `lib/fields.ts` that is **stored** (not `computed`) and marked `notify`:
| Case | Kind | How it's told |
|---|---|---|
| The field's vintage year moved and the value differs | `new_year` | "Fall 2025: 9.1% admitted (fall 2024: 9.8%)" |
| Same year, value differs beyond the field's tolerance | `revised` | "Revised fall 2024 figure: 9.6% (was 9.8%)" |
| Was null, now a value | `appeared` | "Now reported: median earnings …" |
| Was a value, now null | `disappeared` | "No longer reported: …" (not emailed; shown on the panel only) |

- **Years** come from lineage (`citeField(path, school)` before and after), never from `meta` directly, in keeping
  with [data-lineage.md](../data-lineage.md). The release that brought the change is looked up in
  `data/release-calendar.json` when one matches, so the digest can say "From the IPEDS winter release".
- **Tolerance.** Each `notify` field names a unit (`percent`, `dollars`, `count`, `ratio`, `text`) with a default
  threshold (0.1 points, $50, 1, 0.01, any change) so float noise from re-derivation never counts as a revision.
  Derived fields (`derived`) are reported only when one of their inputs changed; the headline figure a reader
  recognizes (acceptance rate, average cost) is what's listed, not every input.
- **Overrides and college-reported values** ([college-reported-data.md](../college-reported-data.md)) produce
  `new_year` changes with their own source ("From Cornell's 2026–27 Common Data Set").
- **History.** Revisions to past years in `data/history/` are summarized as one line per college and topic
  ("NCES revised 2019–2023 cost figures") rather than listed, from the diff `sync-history` already reports.
- A rename, closure, or merger (`name`, `status` changes from the directory file) is always a change, whatever the
  threshold.

The function is pure (`lib/changes.ts`: `diffSchools(prev, next, fields) → DatasetChange[]`) and tested on fixtures
for each case, including a float that must not count and a null that must.

## The digest
One email per user per publish, only when at least one followed college changed. Sent by a daily job, not by the
publish itself: `/api/cron/digests` (Vercel Cron, once a day) sends for every publish that is **older than 24 hours**
and has no `digests` row for the user yet. The day's delay means a publish that gets rolled back the same day sends
nothing, revalidation has finished so links show the new data, and a burst of publishes collapses into one email
that describes the latest state.

Contents, in order:
1. **Subject:** "Updates for 3 of your colleges" or "Stanford: fall 2025 admissions are in".
2. **One block per college** (up to 8, then "and 4 more on your updates page"), crest and name, changes grouped
   by topic in the site's topic order, each as one sentence with both years, and the source line ("IPEDS Admissions
   survey, fall 2025, published Dec 9"). A link to the profile's What changed panel.
3. **Footer:** why you got this ("you follow these colleges" / "they're on your list"), manage follows, one-click
   unsubscribe, and the Data page's plain-language note that figures are a year or more behind.

Rules:
- **Only public college data.** Never the student's standing, estimate, list category, or any personal number;
  never another household member's name. The email is the same for everyone following the same colleges.
- **Cited like the site.** Every sentence has a year; a revised figure says "revised"; a college-reported figure says
  which document. No trend language ("getting harder to get into") in the email; the profile does that with the
  rules in [trend-indicators.md](../trend-indicators.md).
- **No open or click tracking pixels.** Resend's open tracking stays off (minors, and it adds nothing the site
  needs). Links carry a `utm_source=digest` so [telemetry.md](telemetry.md) sees digest-driven visits as sessions.
- **Rendering** uses React Email components with the design system's type and colors in light only (email clients
  disagree on dark mode); plain-text alternative always included.
- **Unsubscribe** is one click (`List-Unsubscribe-Post`), by token, with no sign-in, and sets `email_updates = false`.
  The account page shows the same switch. Auth mail (magic links, invitations) is unaffected.

## In the app
- **Follow button** on every profile hero and compare column, next to Compare and Add to list. Signed out, it opens
  the sign-in sheet with "Sign in to follow Stanford and get an email when its numbers change". Following requires an
  account; there is no email-only follow, so one address and one unsubscribe cover everything.
- **`/me/updates`:** every digest the user received, newest first, with the same blocks, plus changes to followed
  colleges that didn't warrant an email (`disappeared`, history revisions). The link target when a digest is cut off.
- **`/me/following`:** the followed colleges with the date each last changed, and a column that says "on your list"
  for automatic follows. Unfollow here or on the profile.
- **What changed (public):** a panel on each profile's overview, between the hero and the topic cards, listing the college's changes from the last
  two publishes that touched it, with the publish date and release name. Reads `dataset_changes` anonymously, is
  prerendered like the rest of the profile, and shows nothing when the college hasn't changed in a year. Explore gains
  an "Updated recently" sort so new releases are visible site-wide.
- Phones: the Follow button sits in the hero's action row ([mobile.md](../mobile.md)); `/me/updates` is a stack of
  cards with the college as the header.

## Pilot before launch
1. Run the diff against the next real publish in dry-run mode (`npm run publish-data -- --changes-only`) and read the
   change list for a dozen colleges by hand: does every line make sense, and is anything missing or noisy?
2. Send the first digest only to the owner's address for one publish; then to all followers.
3. Watch bounce and complaint webhooks from Resend for the first three publishes; a complaint rate above 0.1% pauses
   sends until the cause is found.

## Measurement
`follow_changed` (action: follow / unfollow, source: profile / compare / list, unit_id) and `digest_sent` (server:
college_count, change_count bucket) in the typed registry ([telemetry.md](telemetry.md#event-registry)); the sign-up
funnel gains "from a Follow button" as an entry. Success: share of accounts following at least one college, digest
unsubscribe rate under 1%, and return visits in the week after a release.

## Files (planned)
- `lib/changes.ts` (`diffSchools`, tolerances, sentence rendering), `lib/fields.ts` (`notify` with a unit on each
  field that should be reported), `scripts/publish-data.mts` (diff and write `dataset_changes` in the publish
  transaction; `--changes-only` dry run), `lib/follows.ts` (server actions and queries), `lib/email.ts` (Resend
  client, templates in `emails/`), `app/api/cron/digests/route.ts`, `app/me/updates/`, `app/me/following/`,
  `components/profile/WhatChanged.tsx` (built as `ProfileChanges.tsx`, so it isn't confused with Home's
  `components/history/WhatsChanged.tsx`), `components/FollowButton.tsx`.
- Migration `…_follows.sql`: `follows`, `notification_prefs`, `dataset_changes`, `digests`, policies.
- `tests/changes.test.mts` (every change kind on fixtures, tolerances, derived-field rule, years from lineage),
  `tests/digest.test.mts` (one digest per user per publish, cut-off at 8 colleges, unsubscribe token, the rendered
  sentences contain both years), `tests/follows-policies.test.mts` (RLS: a guardian can't read a student's follows).
- Env: `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` (Vercel Cron's bearer token); `vercel.json` cron entry.

## As built (2026-10-05): change detection and follows data
Unit D of the accounts build. The Follow button, `/me/*` pages, and the digest build on these contracts.

### Which fields are reported (`lib/fields.ts` `notify`)
`NOTIFY_FIELDS` is every registry entry with `notify` that isn't `computed`, kept to the headline figures on the
overview cards (17): `name` (`always`), `admissions.applicants`, `.admitted`, `.acceptance_rate`,
`.sat_reading_25_75`, `.sat_math_25_75`, `.act_composite_25_75`, `.test_policy`, `demographics.undergrad_enrollment`,
`cost.sticker` (in-state and out-of-state only), `cost.avg_paid_all` ("average cost"), `cost.aided_net_price`
("net price after grants"), `outcomes.graduation_rate`, `.retention_rate`, `.median_earnings_10yr`, `.median_debt`,
`academics.student_faculty_ratio`. Each names a unit (`percent` 0.1 points, `dollars` $50, `count` 1, `ratio` 0.01,
`text` any change), optionally a `tolerance`, the `phrase` it reads as ("{value} admitted"), and for an object the
`keys` compared. Adding one: give it `notify` and check the sentence in `tests/changes.test.mts`.

### `lib/changes.ts`
- `diffSchools(prev, next, fields = NOTIFY_FIELDS, { calendar }) → DatasetChange[]` (pure). Years come from
  `lineageFor` (what `citeField` wraps) on each side's own school and meta. Derived fields that are calculated
  (`acceptance_rate`, `cost.sticker`, `cost.avg_paid_all`) count only when a stored input changed, recursively. The
  release is the calendar entry marked published between the two datasets' `retrieved` dates that `updates` the
  field's vintage; values with their own lineage record (a CDS, the college's page) name their document in `source`.
- **Years, one style per sentence** (`periodLabel`, `periodStart`). A hand-imported CDS override cites its edition
  ("2024-25"), not the period it reports, so it's written in the field's own style: for a fall field, edition YYYY–YY
  is "Fall YYYY" (CDS B1, C1, C9); for retention, "Entered fall YYYY−1" (B22); other years are en-dashed ("2024–25").
  Periods are then ordered (Sep 1 of a fall, Jul 1 of an academic year).
- **Kind from the periods and the source**: `new_year` only when the new period is known to be later; the same period
  from the same kind of source is `revised` (a college's CDS counts as one kind, whichever pipeline read it); a
  different kind of source for the same or an earlier period, or periods that can't be ordered, is `updated`, with the
  old source in `old_source`: "Fall 2024: 44,503 undergraduates from College Scorecard (was 44,819 from Purdue
  University-Main Campus Common Data Set)". A figure never reads as newer than it is.
- `describeChange(change, { formatText? })` writes the sentence with the site's format helpers and the test policy's
  own words; two shares that round to the same whole percent get a decimal.
- `recentPublishes(rows, now)` groups stored rows for the panel: the last two publishes, nothing after a year.
- Sample (the dataset of 2026-10-02 against today's, `--changes-only --prev`): 97 changes across 34 colleges
  (new_year 85, updated 11, revised 1), e.g. "Fall 2025: 4.2% admitted (fall 2024: 3.6%)" (Harvard, from its own
  page), "Fall 2025: middle 50% SAT Math 560–660 (fall 2024: 570–670)" (Houston's CDS), "Fall 2027 applicants: Test
  scores required (fall 2024: Test-optional)" (UNC's CDS). Every `new_year` line pairs two falls, the newer first.

### Database (`supabase/migrations/20261005140000_follows.sql`, `20261005145000_change_old_source.sql`)
| Table | Who | Notes |
|---|---|---|
| `follows (user_id, unit_id, source manual\|list, created)` | owner only (select, insert, update `source`, delete) | pk (user_id, unit_id); no FK to `schools` (publishing replaces its rows). A guardian has no path to a student's follows |
| `notification_prefs (user_id, email_updates, unsubscribe_token, updated)` | owner reads, creates, updates `email_updates` | created by a trigger on a user's first follow; token is 64 hex chars, stored as is (the digest puts it in every email) |
| `digests (id, user_id, publish_id, published_at, sent_at, provider_message_id, unit_ids[], college_count, change_count)` | owner reads; only the secret key writes | unique (user_id, publish_id); `sent_at` null = recorded but not sent |
| `dataset_changes (publish_id, published_at, unit_id, field, kind, old_value, new_value, old_year, new_year, source, old_source, release)` | anyone reads; only the publish writes | unique (publish_id, unit_id, field); values are `json` like the dataset |
| `dataset_change_staging` | secret key only | filled by `stage_dataset_changes()` |

Functions: `unsubscribe_by_token(token) → bool` (anon may call; turns `email_updates` off),
`stage_dataset_changes(changes, reset)` and `publish_schools_staged_with_changes(meta, calendar, expected,
expected_changes, commit, by) → {schools, publish_id, changes}` (secret key only).

**Publish id.** `dataset_publishes.id`, the row every publish already records. Each change row also carries the
publish's time, the same transaction time as `dataset_files.published_at`, which is the dataset version the app reads.

### Publishing (`scripts/publish-data.mts`, `scripts/lib/publish-changes.mts`)
Before writing, publish-data reads the published colleges back (`fetchDatasetFiles`) and diffs them against the files;
none on a first publish. The changes are staged, then `publish_schools_staged_with_changes()` checks the count and
runs `publish_schools_staged()` and moves the changes in, **in one transaction**, so a change exists only if its data
was published; the publish then reads the row count back. Staging (not one big call) because a large release can
produce ~20,000 rows, the same reason colleges are staged. If `dataset_change_staging` doesn't exist (the migration
isn't applied), the publish runs the old function and warns that changes weren't recorded.
- `npm run publish-data -- --changes-only` prints the change list against the published dataset and writes nothing
  (reads only).
- `npm run publish-data -- --changes-only --prev <dir>` does the same against a local `schools.json` + `meta.json`
  (e.g. from `git show <ref>:data/schools.json`), with no network.

### App
- `lib/follows.ts` (Server Actions): `getFollow(unitId) → FollowState`, `follow(unitId)` and `unfollow(unitId) →
  FollowResult`, `myFollows() → FollowRow[]`; types and the rules (`followWrite`: a `list` follow becomes `manual`
  on an explicit follow) in `lib/follow-state.ts`. Unconfigured, signed out, or before the migration, they say so
  instead of throwing.
- `components/profile/ProfileChanges.tsx`: the What changed panel, between the hero and the topic cards. Reads
  `getSchoolChanges(unitId)` (`lib/data.ts`, publishable key, fail-soft), so profiles stay static and regenerate with
  the publish's revalidation. With `DATA_SOURCE=json` there are no changes (they belong to publishes, so they aren't
  committed); `CHANGES_FIXTURE=<file of rows>` shows the panel locally for QA. Each sentence has its source; the newest
  publish's lines have the ⓘ of the value shown today, and the section's footnote lists their sources.

### Deviations
- A fifth kind, `updated`: the value changed but can't honestly be called a new year or a revision: its source names
  no single year (College Scorecard's "most recent release"), it now comes from a different kind of source, or its
  period isn't later. A column the spec didn't have, `old_source`, names the previous source in that case.
- `status` isn't a stored field (closures and mergers aren't in the dataset), so only `name` is an always-change.
  Colleges present in only one dataset are skipped.
- History revisions ("NCES revised 2019–2023 cost figures") are not summarized yet: `sync-history` doesn't record a
  diff to read. Left for later (owner decision 4: only if cheap).
- Explore's "Updated recently" sort isn't built.
- Overrides and college-reported values are reported as `new_year` with their document in `source`; the digest's
  "From Cornell's 2026–27 Common Data Set" wording is the digest's to write from that.

### Setup (owner)
1. Apply `supabase/migrations/20261005140000_follows.sql` and then `20261005145000_change_old_source.sql` (the
   `old_source` column, split out because the first was already applied to dev) in the SQL Editor of the dev project
   (after `20261005120000_accounts.sql`), then prod at release. Until then publishes succeed and warn that changes weren't
   recorded, the panel shows nothing, and the follow actions answer "Following isn't set up on this site yet".
2. The first publish after applying it records changes from then on; nothing is backfilled.
3. Pilot step 1 above: run `npm run publish-data -- --changes-only` before the next real publish and read the list.

## Open questions
1. Should guardians be able to see which colleges their student follows? Recommendation: no; the list already
   carries what they're allowed to see, and a follow outside the list is the student's business.
2. A monthly cadence option (one email a month at most, even across several publishes)? Recommendation: not in v1;
   publishes are already rare. Add it if the college-reported agent makes publishes weekly.
3. Should the public What changed panel include history revisions by NCES? Recommendation: yes, as the one-line
   summary, since it explains why an "Over time" chart moved.
