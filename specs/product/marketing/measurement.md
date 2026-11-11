# Measuring Marketing: Campaign Links, First-Party Attribution, and PostHog in the Console

> Status: **planned** (not built). Written 2026-11-09 for [plan.md](plan.md). How the site knows which campaign
> brought a visitor, an account, a trial, and a paid year, without pixels or cross-site tracking, and how those numbers
> reach the console's Growth door ([console.md](console.md)) from PostHog and from our own tables. Extends
> [telemetry.md](../telemetry.md), whose privacy rules hold here without exception. Part of [product](../README.md).

## The questions

1. For each campaign: how many arrived, signed up, started a trial, paid, and what each of those cost.
2. For each audience (parents, students, counselors): the same funnel, summed over its campaigns and its organic traffic.
3. For search: which pages and queries send visitors, and which of those visitors sign up ([seo.md](seo.md#search-performance)).
4. Week over week, in one screen, with the decision (kill, hold, double) written down beside the number.

## Why the current telemetry cannot answer them

PostHog records UTM parameters on each `$pageview` and, for an identified user, as initial person properties. But
anonymous visitors run with `persistence: "memory"` ([telemetry.md](../telemetry.md#privacy)): a parent who clicks an ad
on Tuesday and signs up on Thursday is two unrelated sessions, and the sign-up carries no campaign. Nothing is stored
on the account about how it was acquired, so a trial or a payment weeks later cannot be traced to its campaign either.
Ad platforms would answer this with a pixel and a cross-site cookie; we have ruled those out.

## The design

### Campaign links

Every link we put anywhere (an ad, a post, an email, a QR code on a handout, a counselor's directory listing) is a
**campaign link**: `https://usequad.app/go/{code}`, where `code` is a short, readable slug the console issues
(`parents-search-jan27`, `ieca-directory`, `tiktok-bio`). The console's link builder ([console.md](console.md#campaigns))
creates it with its destination (any path on the site, a college page included) and prints the long form too,
`{destination}?utm_source=…&utm_medium=…&utm_campaign={code}`, for places that want UTMs (Google Ads auto-tagging
coexists; `gclid` passes through untouched and is never stored).

`/go/{code}` is a Route Handler (`app/go/[code]/route.ts`): it looks the code up (a cached read of `marketing_links`),
counts the open (`marketing_link_opens`, a daily counter per code: no IP, no user agent, no identifier), sets the
campaign cookie, fires the server event `go_link_opened {code}`, and redirects with the UTMs appended so PostHog's
page view sees them too. An unknown code redirects to `/`. The handler is `robots: noindex` and the sitemap omits it.

### The campaign cookie

A first-party cookie, `quad_src`, set by `/go/{code}` and by `proxy.ts` when a request arrives with `utm_campaign`:

- **Value:** the campaign code and the day it was set, nothing else (`parents-search-jan27.2027-01-14`). No identifier
  of any kind; two visitors from the same ad carry the same value.
- **Life:** 30 days, `SameSite=Lax`, `HttpOnly`, `Secure`; first touch wins (an existing cookie is not overwritten,
  so the campaign that found the family gets the credit; a later `utm_campaign` is still on that one page view).
- **Read** exactly once, on the server, when an account is created: `signup_completed` carries `campaign` and
  `campaign_age_days`, the account's row gets `acquired_via` and `acquired_at`, and the cookie is cleared.
- **Not** sent to PostHog as a person property, not read on any other page, not used to change what a visitor sees.
- The privacy page gains one paragraph: a 30-day cookie that remembers which of our links brought you, holding only
  the link's name, used to count sign-ups per campaign, and removed when you sign up. This is not cross-site
  tracking and needs no banner under the laws the telemetry spec reviewed; it is still said plainly.

GPC and DNT: when the browser sends either, `/go/{code}` still redirects (the link has to work) but sets no cookie and
sends no event, matching the provider's rule for everything else.

### `acquired_via` on the account

A column on the profile row (`profiles.acquired_via text`, `acquired_at timestamptz`), written once at sign-up from
the cookie, or `organic:{landing}` when there was no cookie (`organic:school`, `organic:trends`, `organic:home`, from
the first page of the session the auth callback can see in the referrer; `direct` otherwise). Every later server event
about money or the plan reads it from the row, so `trial_started`, `trial_converted`, `subscription_cancelled`, and
`subscription_renewed` carry `campaign` without any cookie surviving that long. Admins see it on a person's page
("Came from: parents-search-jan27, January 14") beside the role; nobody else does. Deleting an account deletes it.

An organization gets the same two columns, set from the creating counselor's cookie, so the counselor channel's
campaigns (directory listings, conference QR codes) are measured the same way.

### New events

Added to the registry in [telemetry.md](../telemetry.md#event-registry) under the same rules (strings, numbers,
booleans; no free text; the denied-token test gains nothing because `campaign`, `code`, `page`, and `product` pass):

| Event | Properties | Fired from | Why |
|---|---|---|---|
| `go_link_opened` (server) | `code` | `app/go/[code]/route.ts` | Opens per campaign link, counted even when the visitor blocks PostHog in the browser |
| `landing_viewed` | `page`: parents / students / counselors; `campaign` (from the URL's `utm_campaign`, or empty) | The three `/for/*` pages | Which landing pages get read, from which campaigns |
| `landing_cta_clicked` | `page`, `cta`: trial / signup / invite-parent / start-org / demo | The pages' buttons | Whether the page moves people |
| `signup_completed` (exists) | gains `campaign`, `campaign_age_days` (0–30) | The auth callback | The join between the click and the account |
| `household_invite_sent` (server) | `by`: student / guardian; `campaign` | The household invitation action | The student campaign's conversion |
| `trial_started`, `trial_converted`, `trial_cancelled`, `subscription_cancelled`, `subscription_renewed` (server) | `product`: student / family; `campaign`; `price_variant` (the variant key, or `list`; never an amount beyond the published prices) | [commercialization.md](../commercialization.md), when built; the names there are kept and gain `campaign` and `price_variant` | The money funnel, by campaign and by price ([commercialization.md](../commercialization.md#price-tests-owner-2026-11-09)) |
| `share_created` | `kind`: list / compare / trend; `channel`: link / x / facebook / copy | The share buttons ([console.md](console.md#sharing)) | Word of mouth, counted |
| `connect_opened` | `page`: parents / students / counselors / connect; `assistant`: chatgpt / claude / gemini / other | The "Ask your assistant with Quad's numbers" block on the landing pages and the steps on `/connect` ([seo.md](seo.md#assistants-and-ai-search)) | Whether people take Quad into their assistant; the trigger for the connector message in [plan.md](plan.md#layered-in-later) |

`campaign` is a registered property name on every event that carries it, and its value is always a code the console
issued or one of the fixed `organic:*` values; a test holds the set of values in fixtures to that rule.

### PostHog dashboards

Three dashboards, built once by hand in PostHog from these definitions (as the telemetry spec does), and linked from the
Growth overview so a click opens the live chart:

1. **Campaigns:** funnel `go_link_opened → $pageview → signup_completed → trial_started → trial_converted`, broken down
   by `campaign`, 30-day window; a trend of `signup_completed` by `campaign`.
2. **Audiences:** the same funnel broken down by `role_hint` on sign-up; `landing_viewed` to `landing_cta_clicked`
   by `page`; `household_invite_sent` within 30 days of a student's `signup_completed`.
3. **Search:** `$pageview` where `$referring_domain` is a search engine, by entry path family (`/schools`, `/trends`,
   `/high-schools`, `/glossary`); `signup_completed` where `campaign` starts with `organic:`.

### The console reads PostHog

The Growth door shows numbers, not iframes, so it has to query PostHog. Two secrets, server-only, never in the
browser: `POSTHOG_PERSONAL_API_KEY` (a personal API key scoped to `query:read` and `insight:read` on the one project)
and `POSTHOG_PROJECT_ID`. `lib/marketing/posthog.ts` wraps the Query API (`POST /api/projects/{id}/query` with a
`HogQLQuery`), with a 20-second timeout, never throwing, and returning `null` with a reason when the key is missing
(the screens then say "PostHog isn't connected here" the way the settings page speaks of a missing migration).

The queries run in a **daily job**, not on page view: `marketing-pull` (a Vercel cron route, 06:00 UTC, registered in
`lib/jobs/registry.ts` so the Steward reviews it like every job) runs a fixed set of HogQL queries for the last 35 days
and upserts `marketing_daily` (day, campaign, audience, step, count). The overview reads that table, so it opens in
milliseconds and still works when PostHog is slow or the key lapses (the page then shows the last pull's day). A
"Refresh now" button on the overview runs the same pull for today, rate-limited to once in ten minutes.

The queries, in words (the HogQL lives beside the job with a test that each parses against a fixture schema):

- Page views by `utm_campaign` and by referring-domain class (search, social, direct, other) per day.
- `signup_completed` by `campaign` and `role_hint` per day.
- `trial_started`, `trial_converted`, `trial_cancelled`, `subscription_renewed` by `campaign` and `product` per day.
- `landing_viewed` and `landing_cta_clicked` by `page` per day.
- `org_created` and `org_student_joined` per day.
- `household_invite_sent` within 30 days of a student sign-up, per sign-up week (a cohort query).

PostHog's **free tier** (1 million events a month) covers the site for the whole plan; the Query API is included in it
with its own rate limits (about 120 queries a minute per project), which the daily pull is nowhere near.

### Our own tables fill the gaps

Some numbers never pass through PostHog, or cannot be trusted to (a parent with an ad blocker still signs up):

| Table | Holds | Written by |
|---|---|---|
| `marketing_campaigns` | code, name, audience, channel, start and end, planned budget, status, landing page, notes | The console |
| `marketing_links` | code → destination path, UTM source and medium, created by, the QR's rendered SVG | The console's link builder |
| `marketing_link_opens` | code, day, count | `/go/{code}` (an upsert that increments) |
| `marketing_spend` | campaign, month, amount, source (`google` / `meta` / `manual` / `csv`), note | The hourly `ads-sync` for platform campaigns ([console.md](console.md#sync-alerts-and-drift)); the console's Spend screen or a CSV for anything else |
| `marketing_daily` | day, campaign, audience, price_variant, step, count, source (`posthog` / `db`) | `marketing-pull`, which also counts `profiles.acquired_via` and the subscriptions table directly (the `db` rows), so the account and money steps have a number the browser cannot block; the price test's rows come from the subscriptions table's stored variant |
| `seo_daily` | day, page or query, clicks, impressions, CTR, position | `search-console-pull` ([seo.md](seo.md#search-performance)) |

**Cost per trial** is `marketing_spend` for the campaign's month divided by the `db` count of trials for that campaign
and month; the overview shows it beside the PostHog funnel and says which source each number came from. When the two
disagree by more than 20% (ad blockers, usually), the row says so rather than averaging.

All six tables are admin-only under row-level security (the `is_admin()` pattern the console uses), written only by
the console's Server Actions and the jobs, and every write goes through the admin log.

## What we do not do

- No Meta Pixel, Google tag, TikTok pixel, LinkedIn Insight tag, or any third-party script on any page.
- No server-side conversion APIs (Meta CAPI, Google Enhanced Conversions): each sends a hashed email or phone to the
  platform, which the privacy page would have to disclose, and many of our users are minors. If the owner decides
  otherwise ([plan.md](plan.md#owner-decisions), decision 1), it is adults only, opt-in at sign-up, and a separate spec.
- No campaign codes carried into the browser's analytics as a person property; the join happens on our server.
- No session replay, heatmaps, or surveys, as before. PostHog's experiments and feature flags are not used for marketing
  (an A/B test of a landing page is a later spec, if ever, and would run server-side on the campaign code).
- No reading of `gclid`, `fbclid`, or any platform click id beyond passing it through on the redirect.

## Weekly review

Monday, in the Growth overview ([console.md](console.md#overview)): this week against last for every row of the funnel
table in [plan.md](plan.md#how-we-know-it-is-working), each paid campaign's cost per trial against the $12 and $20
lines, the three audiences, and search. A "Decision" box on each campaign takes one of kill / hold / double and a
sentence; it writes the admin log and the campaign's status, so a later reader can see why the budget moved.

## Files (planned)

- `app/go/[code]/route.ts`, `proxy.ts` (the `utm_campaign` cookie), `lib/marketing/attribution.ts` (cookie value
  format, first-touch rule, the `organic:*` values; pure, tested), `lib/marketing/posthog.ts` (Query API wrapper),
  `lib/marketing/queries.ts` (the HogQL, as constants), `app/api/cron/marketing-pull/route.ts` with its row in
  `lib/jobs/registry.ts` and `vercel.json`, `lib/analytics.ts` (the new events), the auth callback (reads the cookie,
  writes `acquired_via`), migration `…_marketing_tables.sql` (the six tables, RLS, the increment function for opens).
- Tests: `tests/marketing-attribution.test.mts` (cookie parse and format; first touch wins; GPC sends nothing; an
  unknown code redirects home; `campaign` values are codes or `organic:*`), `tests/marketing-pull.test.mts` (the
  queries parse; a fixture response upserts the expected rows; a missing key yields a "not connected" state and no
  throw), and the registry tests already in place (every event registered, no denied token, every job scheduled in
  one place).

## Owner steps

1. In PostHog, create a personal API key with `query:read` and `insight:read` on the project; set
   `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` on Vercel (production and preview) with `npm run vercel-env`.
2. Build the three dashboards from the definitions above and paste their URLs into the Growth settings.
3. Extend `/privacy` with the campaign-cookie paragraph (the build drafts it; the owner approves the words).
