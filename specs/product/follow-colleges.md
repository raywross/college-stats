# Follow Colleges: Update Emails When the Data Changes

> Status: **planned** (not built). After [accounts.md](accounts.md); becomes useful once the
> [scheduled data refresh](../backlog.md#data) runs on its own. Part of [product](README.md).

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
- **What changed (public):** a panel on each profile, under the hero, listing the college's changes from the last
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
  `components/profile/WhatChanged.tsx`, `components/FollowButton.tsx`.
- Migration `…_follows.sql`: `follows`, `notification_prefs`, `dataset_changes`, `digests`, policies.
- `tests/changes.test.mts` (every change kind on fixtures, tolerances, derived-field rule, years from lineage),
  `tests/digest.test.mts` (one digest per user per publish, cut-off at 8 colleges, unsubscribe token, the rendered
  sentences contain both years), `tests/follows-policies.test.mts` (RLS: a guardian can't read a student's follows).
- Env: `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` (Vercel Cron's bearer token); `vercel.json` cron entry.

## Open questions
1. Should guardians be able to see which colleges their student follows? Recommendation: no; the list already
   carries what they're allowed to see, and a follow outside the list is the student's business.
2. A monthly cadence option (one email a month at most, even across several publishes)? Recommendation: not in v1;
   publishes are already rare. Add it if the college-reported agent makes publishes weekly.
3. Should the public What changed panel include history revisions by NCES? Recommendation: yes, as the one-line
   summary, since it explains why an "Over time" chart moved.
