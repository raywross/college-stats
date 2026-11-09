# The Growth Door: Campaigns, Links, Pages, Search, Emails, and Spend, Run From the Console

> Status: **planned** (not built). Written 2026-11-09 for [plan.md](plan.md): the owner wants to "drive the whole
> thing from the admin functions on the site". This spec is the console side of that and the build plan for all four
> marketing specs. It adds a fifth door, **Growth**, to the console of [admin-redesign.md](../admin-redesign.md), with
> six screens, five tables, four jobs, and the editable landing pages and lifecycle emails the campaigns need. The
> numbers it shows come from [measurement.md](measurement.md); the Search screen is [seo.md](seo.md). Part of
> [product](../README.md).

## Placement

A fifth door in the rail and, below `lg`, a fifth tab in the console's bottom bar (the site's own bar has five, so the
pattern and the widths exist; [mobile.md](../../mobile.md)). The owner may prefer it under More until there is traffic
to look at ([plan.md](plan.md#owner-decisions), decision 6); the screens are the same either way, under
`/admin/growth/*`, and `lib/admin/console.ts` moves the group with one edit.

```
Growth
  Overview        How the funnel did this week
  Campaigns       Every campaign, its links, and its ads on Google and Meta
  Ads             Connections, the creative library, alerts, the ceiling
  Pages           The landing pages' words
  Search          How search finds us              (seo.md)
  Emails          Lifecycle emails and the newsletter
  Spend           What each campaign cost
```

The campaigns themselves are written, launched, paused, and re-budgeted here, through the platforms' APIs
([Ad platforms](#ad-platforms-the-campaigns-run-from-here)); the owner's day-job network blocks the platforms' own
consoles, and the site is reachable, so the console has to be enough on its own, on a phone.

Every panel title carries a help key ([Help entries](#help-entries)); every table becomes a card list below `md`;
every action that sends mail, changes a live page, or changes `robots.txt` uses `ConfirmTyped`; every write goes
through the admin log, as the redesign's rules require.

## Overview

`/admin/growth`. The Monday screen ([measurement.md](measurement.md#weekly-review)).

| Block | Shows |
|---|---|
| **This week** | The funnel table from [plan.md](plan.md#how-we-know-it-is-working): arrived, engaged, account, trial, paid, as three columns (parents, students, counselors) with this week, last week, and the change; each number says its source (`PostHog` or `db`) on hover and in the card list |
| **Paid campaigns** | One row per active campaign with spend this month, trials, cost per trial, and a chip: green under $12, amber to $20, red above; the Decision box (kill / hold / double, a sentence) that writes the log and the campaign's status |
| **Price test** | One row per live price variant: links showing it, visitors, trials started, trials converted, first-year cash per trial, and the cost per trial the variant can afford; the comparison the April 2027 price decision reads ([commercialization.md](../commercialization.md#price-tests-owner-2026-11-09)) |
| **Search** | Clicks and sign-ups from organic search this week against last; a link to Growth › Search |
| **Counselors** | Organizations created, students joined, working offices (five or more students); a link to People › Organizations |
| **Targets** | The seven metrics of the plan with their April 2027 targets and where each stands, so the plan's promise is on the screen that judges it |
| **Dashboards** | Links to the three PostHog dashboards (URLs in `app_settings` under `growth.dashboards`) |
| **Last pull** | When `marketing-pull` and `search-console-pull` last ran and whether they succeeded; "Refresh now" (rate-limited) |

With `POSTHOG_PERSONAL_API_KEY` unset the PostHog columns read "not connected here" and the `db` columns still work,
so the preview deployment shows real sign-up counts and no analytics.

## Campaigns

`/admin/growth/campaigns`. The registry and the link builder.

**The table** (`marketing_campaigns`): code, name, audience (parents / students / counselors), channel (google-search /
google-shorts / meta-feed / meta-reels / other), status (draft / live / paused / ended), start, end, planned monthly
budget, landing page, **price variant** (the student and family prices this campaign's visitors see; the list price by
default; [commercialization.md](../commercialization.md#price-tests-owner-2026-11-09)), and the week's opens, sign-ups,
trials. A link may override its campaign's variant, which is how half a campaign's links show the test price while
the audience stays the same. Filters by
audience and status. A campaign's page shows its links, its daily series (opens, sign-ups, trials, from
`marketing_daily` and `marketing_link_opens`), its spend by month, the decisions taken with their sentences, and a
notes field.

**The link builder**, on the campaign's page: destination path (any path on the site, validated against the route
list; a college page by its id with the name shown), source and medium for the UTM form, an optional Stripe
promotion code (when the owner decides on one; it rides in the URL as `promo` and the checkout reads it), and the
resulting two URLs with copy buttons: `https://usequad.app/go/{code}` and the long UTM form. A **QR code** (SVG,
rendered on the server from the short URL, downloadable) for handouts and conference tables. One campaign may have
several links (one per ad group or placement, `parents-search-jan27-harvard`), and the campaign's numbers sum them.

Creating a campaign requires a code that is lowercase letters, digits, and hyphens, unique, and not one of the
`organic:*` values; the audience; and a landing page that exists. Ending a campaign stops nothing on the site: its
links keep redirecting (an ad already printed should work), and its opens are counted under "ended".

## Pages

`/admin/growth/pages`. The three landing pages and the pricing page's editable words.

Each page (`/for/parents`, `/for/students`, `/for/counselors`, and the words on `/pricing`) is a code template with
**copy blocks** the console edits (`marketing_pages`: page, block, text, updated). The template fixes the structure and
the product frames (the same components and the same `sample-plan.json` fixture as the splash page in
[advisor.md](../advisor.md#3-the-page-advisor-signed-out), so the page cannot drift from the product); the console
owns the headline, the sentence under it, each section's one line, the Questions section (a list of question and
answer pairs, which also feeds the page's `FAQPage` markup), and the button labels. A preview renders the page with
the draft blocks; **Publish** writes them and revalidates the page. Drafts are kept per page, so the owner can prepare
the spring words in February and publish them in March.

Rules: the blocks are plain text with no HTML; a block may not name a percentage chance or any claim the
[chances README](../../chances/README.md) forbids (a word list is checked on save: "guarantee", "boost your
chances", "%"); the price is never typed into a block (it comes from `lib/entitlements.ts`'s constants, so a price
change is one edit).

## Search

[seo.md](seo.md#the-search-screen-in-the-console): Templates, Crawlers, Search performance, Indexing, Sharing.

## Emails

`/admin/growth/emails`. Two kinds, with different rules.

**Lifecycle emails** are sent by the site to people who have an account, about the thing they signed up for. A table
of **sequences**, each with its steps, an on/off switch, and the week's sends and opens (opens from Resend's webhook,
counted per step, never per person):

| Sequence | To | Steps | Rule |
|---|---|---|---|
| Trial | the guardian or the 16+ student who started one | day 1 (what to do first), day 7 (the season's three things), day 12 (the trial ends in two days, the price, cancel in one click), day 15 (welcome, or sorry to see you go) | Transactional: tied to the trial; the day-12 reminder already exists in [commercialization.md](../commercialization.md) and moves here as a step |
| New account, no record | an account with no record entered after three days | one email: the record takes five minutes; what it unlocks | Transactional (a product the person asked for), one send, never repeated |
| Lapsed plan | a plan that lapsed | two weeks after, once: the plan is read-only, renew for $20 | Transactional |
| Counselor onboarding | a counselor who created an organization | day 0 (invite your students: the code and the link), day 7 (asks and notes), day 30 (what your office did this month) | Transactional |
| Student invited a parent, parent did not join | the student, after five days | one email: a nudge they can forward | Transactional; the parent is never emailed by us until they join |

Each step is a template in `lib/emails/` (the existing pattern: HTML and text, `List-Unsubscribe` headers) with its
words editable in the console the way page blocks are (subject, the one paragraph that varies; the frame and the legal
footer are code). The **send window** is 13:00 UTC daily, by the existing `digests` job's pattern, from a new
`lifecycle-emails` job that selects due recipients by state and sends through `lib/email.ts`. A person who turns off
"Update emails" in `/account` gets no lifecycle mail except the two the law and the trial require (the day-12 reminder
and the renewal reminder), which are stated at checkout.

**The newsletter** is marketing mail, to adults who asked for it. A subscribe form on the parent and counselor landing
pages and in the footer, **double opt-in** (a confirmation link; the row is `pending` until clicked), a separate table
(`newsletter_subscribers`: email, kind parents / counselors, status, source campaign, confirmed at), one issue a month
written in the console as a draft (title, intro, and a pick of release notes and trends studies rendered as cards),
previewed, sent to a test address, then sent with a typed confirmation. Unsubscribe is one click by token, and the
footer carries the postal address the law requires (`lib/contacts.ts`). **Never to a student**, and a student account
cannot subscribe: the form asks "I am a parent or guardian" or "I am a counselor", and a signed-in student sees no
form. Open and click counts per issue from Resend; no per-recipient tracking is shown anywhere.

Both kinds count: `lifecycle_sent {sequence, step}` and `newsletter_sent {kind}` (server events, counts only) join the
registry.

## Spend

`/admin/growth/spend`. A month-by-campaign grid of amounts (`marketing_spend`), typed in by hand or imported from a
CSV (Google Ads and Meta both export a monthly campaign report; the importer maps their campaign name column to our
code, with a preview and a "didn't match" list). The grid's totals feed cost per trial on the overview and the
campaign's page. A planned-budget column from the campaign's row, so overspend shows. Ad-platform APIs are not used:
both need an app review and a developer token for a number the owner can type in a minute a month.

## Ad platforms: the campaigns run from here

> Owner, 2026-11-09: "I'd really rather control everything from the admin site on my end. I have a day job, and
> getting onto Google and Meta ad platforms are blocked. I can get to my site. So if I need to monitor or make a change
> while in the office this will allow me to stay connected and monitoring."

So the console is where the Google and Meta campaigns are written, launched, watched, paused, and re-budgeted. Both
platforms have APIs that allow all of it (the Google Ads API and the Meta Marketing API), and the console wraps them
behind the same campaign the rest of this spec describes. What the platforms' own consoles remain for is listed
plainly [below](#what-still-needs-their-consoles), and it is all one-time setup done from home.

### A campaign's platform side

A campaign in `marketing_campaigns` gains a **Platform** tab on its page. Creating one walks through five steps, each a
panel with its help icon, saved as a draft at every step, and nothing reaches a platform until **Launch**:

| Step | Google (Search, YouTube Shorts) | Meta (Facebook and Instagram feeds, Reels) |
|---|---|---|
| **1 Audience and placement** | Search, or Shorts; country U.S.; language English; for Shorts the age floor (13 or 18) and nothing else | Feed, Reels, or both; countries; age range (13 to 19 for students, 35 to 60 for parents, 25 to 65 for counselors); interest categories picked from Meta's own list through its targeting-search API (parenting, college planning, education professions); never a custom, lookalike, or Advantage+ audience (the console does not offer the field) |
| **2 Colleges and keywords** (Search only) | Pick colleges the way Explore does (a filter set, a saved list, or a paste of names); pick **query patterns** from a fixed list ("{name} acceptance rate", "{name} chances", "is {name} a reach", "{name} test optional", "{name} net price"; counselors: "college counseling software", "Common Data Set {name}") with match type; the console generates one ad group per college with its keywords, negative keywords from a shared list ("jobs", "football", "hospital"), and the college page as the final URL carrying the campaign code | not applicable |
| **3 Ads** | **Responsive search ads** from templates with placeholders filled from the data ("{name}: {admit_rate} admitted ({admit_year})", "See where you stand at {short_name}", "An advisor for the whole road to college"); the console shows the rendered headlines and descriptions for three colleges and their character counts, and refuses a template that breaks a platform limit or the words rule. For Shorts: a video asset chosen from the console's **creative library** | **Single-image or video ads**: the image rendered by the site's own renderer (the advisor's frames for families, the caseload for counselors, a college's Open Graph card for college ads) or uploaded; primary text, headline, description from templates; the campaign link as the destination. Reels: a video from the library |
| **4 Budget and schedule** | Daily budget; manual CPC with a cap, or maximize clicks with a cap (no conversion bidding: no pixels); start and end dates; dayparting off | Daily budget at the ad set; lowest cost with a bid cap; start and end; placements fixed by step 1 |
| **5 Review and launch** | A **dry run**: every API mutation the launch would send, in words ("Create 212 ad groups, 1,060 keywords, 212 responsive search ads; set budget $33/day"), plus the first month's maximum spend; the ceiling check ([below](#the-ceiling)); `ConfirmTyped`; then the calls, in batches, with progress and a clear error per failed item | the same |

Launch writes the platform ids into `ad_entities` (our campaign and link → their campaign, ad group or ad set, ad,
keyword ids), so every later read and change is by id. The platform's review follows (minutes to a day); the
campaign's status chip shows **Under review**, **Live**, **Disapproved** (with the platform's reason, in words, and the
ad it names), **Paused**, **Ended**, or **Limited by budget**.

### Operating from a phone at work

The campaign page's top panel on a phone is the four things the owner will do from the office, each one tap and a
confirm: **Pause**, **Resume**, **Change daily budget** (a number field with the ceiling shown), **Swap creative** (pick
another from the library). Below it: today's and this week's spend, clicks, impressions, cost per click, and, from our
own tables, sign-ups and trials with cost per trial against the lines, then the ads with their status. Every action is
an API call made at once, logged with before and after, and shown as done only when the platform confirms.

### Sync, alerts, and drift

An hourly job, `ads-sync`, while any campaign is live (daily otherwise): pulls spend, impressions, clicks, and status
for every entity in `ad_entities` into `ad_metrics_hourly`; writes the day's spend per campaign into
`marketing_spend` (source `google` or `meta`, replacing the typed-in number for platform campaigns); reads each ad's
review status and disapproval reasons; and compares what the platform holds against what the console last set (a
budget or status changed from the platform's console shows as **Changed outside Quad** with both values, and the
owner picks which wins).

**Alerts** go to the owner by email and, when the number is set, by text (through the same provider the planner's
texts use), so the console does not have to be open to know:

| Alert | When |
|---|---|
| Disapproved | an ad's status becomes disapproved, with the reason |
| Over the line | a campaign's cost per trial (or per sign-up, per organization) has been above its stop line for seven days |
| Ahead of pace | the month's spend is on track to pass the planned budget by 20% or more |
| Stopped | a campaign the console expects live is paused or ended on the platform, or a connection's token has expired |
| Nothing moving | a live campaign with a budget has had no impressions for 24 hours |

Each alert links to the campaign's page, which on a phone opens with Pause at the top. The Steward reviews `ads-sync`
like every job and files a finding when a sync fails twice.

### The ceiling

`growth.ad_ceiling_cents` in `app_settings`: the most all platform campaigns together may spend in a month. The launch
dry run and every budget change compute the month's maximum (sum of daily budgets times days left, plus spent so far)
and refuse to pass it. Raising the ceiling is its own typed-confirm action on Growth › Ads. Platform-side daily budgets
are the hard stop; the ceiling is ours, so a mistake in a budget field cannot become a bill.

### The creative library

`ad_creatives`: images and videos with their text, tags (audience, season, platform), and where they are in use.
Images come from the site's renderer (`/api/ads/image?kind=advisor-list&…`, the same engine as the Open Graph images,
at each platform's sizes) or an upload; videos are uploads (the 15-second advisor cuts: the list sorted by level, the
three cards, a text reminder arriving; the caseload for counselors). For Shorts, a video must live on a YouTube channel:
the console uploads it there through the YouTube Data API with the connected Google account, unlisted, and keeps the
video id. A creative's words are checked against the same forbidden list as a copy block.

### Connections

Growth › Ads › Connections: one card per platform with its status, the account it is connected to, when the token was
last refreshed, and a **Connect** or **Reconnect** button.

- **Google:** a Google Cloud project with the Google Ads API enabled, an OAuth client, and a **developer token** from
  a Google Ads manager account. OAuth consent is a redirect to Google and back (`/admin/growth/ads/connect/google`);
  the refresh token is stored encrypted (`ad_connections`, Supabase Vault for the secret) and used server-side only.
  The developer token's **Basic access** must be applied for and approved by Google before it works against a real
  account; the application takes days to a few weeks and is usually granted for a tool managing its own account, so it
  goes in during wave 1 ([Owner steps](#owner-steps)). Until then the console works against a Google Ads test account.
- **Meta:** a Meta app in development mode (enough for ad accounts its admins own), a **system user** in the business
  with the ads-management permission and a long-lived token, stored the same way. Business verification is a Meta
  console step. The Marketing API's standard access is applied for only if the development tier's limits are hit.
- Both tokens are refreshed by `ads-sync`; an expired or revoked one raises the Stopped alert and the card goes red.

### What still needs their consoles

One-time or rare, done from home: creating the Google Ads and Meta ad accounts and setting the payment method;
business verification at Meta; applying for the Google developer token; the OAuth consent screens themselves (a
redirect to google.com and facebook.com, which the office network may block, so the Connect step is done at home once);
appealing an ad disapproval the API reports but cannot appeal; and a billing dispute. Everything that happens weekly or
in season happens in the console.

### Rules

- Only placements, audiences, and bidding the plan allows exist as fields: no Display Network, no Performance Max, no
  remarketing lists, no custom or lookalike audiences, no conversion bidding, no detailed targeting of under-18s beyond
  age and country. The console cannot be used to break principle 2 of [plan.md](plan.md#principles).
- Student-facing ads: the template set for a campaign whose age range includes anyone under 18 has no price field and
  no "subscribe" word; a test holds it.
- Every mutation is logged with the platform's response id, and the dry run is kept with the launch so what was sent
  is readable later.
- A campaign's `channel` is now `google-search`, `google-shorts`, `meta-feed`, `meta-reels`, or `other` (for anything
  layered in later and run by hand).

## Sharing

Not a console screen but a site feature the console counts: a **Share** button on a college page, a compare page,
and each trends study, offering copy link, text, X, Facebook, and the system share sheet on a phone (`navigator.share`),
with the Open Graph image making the shared card worth looking at ([seo.md](seo.md#built-in-code-once)). Fires
`share_created {kind, channel}`. A shared list (`/l/{token}`) already exists and stays as it is. No referral codes,
no rewards, no "invite three friends": the share is a courtesy, and the count tells us whether the pages travel.

## Model

| Table | Columns | Notes |
|---|---|---|
| `marketing_campaigns` | id, code (unique), name, audience, channel, status, starts_on, ends_on, monthly_budget_cents, landing_path, price_variant (a key into the entitlements map's variants; null is the list price), notes, created_by, created_at | Decisions are admin-log rows with `action: campaign_decision` and the sentence |
| `marketing_links` | id, campaign_id, code (unique), destination_path, utm_source, utm_medium, promo_code, price_variant (overrides the campaign's), qr_svg, created_at | `code` defaults to the campaign's; sub-links append a suffix |
| `marketing_link_opens` | link_code, day, count | `increment_link_open(code)` security-definer function, callable by the anon role from the route handler, increments or inserts; nothing else about the open is kept |
| `marketing_spend` | campaign_id, month (date, first of month), amount_cents, source, note, updated_at | |
| `marketing_daily` | day, campaign (code or `organic:*` or `all`), audience, step, count, source | Written by `marketing-pull`; the overview and campaign pages read it |
| `marketing_pages` | page, block, draft_text, published_text, updated_at, updated_by | |
| `newsletter_subscribers` | id, email, kind, status, source_campaign, token, confirmed_at, unsubscribed_at | Email is the only personal field in this spec's tables; deleted on unsubscribe after 30 days |
| `newsletter_issues` | id, kind, title, intro, picks (jsonb of release-note slugs and trend slugs), sent_at, sent_count | |
| `lifecycle_steps` | sequence, step, subject, body_variable, enabled, updated_at | The editable words of each step |
| `ad_connections` | platform, account_id, account_name, token_secret_id (Supabase Vault), scopes, refreshed_at, status | One row per platform |
| `ad_entities` | campaign_id, link_id, platform, kind (campaign / ad_group / ad_set / ad / keyword / video), platform_id, parent_platform_id, name, status, review_reason, last_synced_at | Our side of every platform object |
| `ad_metrics_hourly` | entity_id, hour, spend_cents, impressions, clicks | Rolled up to the campaign and the day for the pages |
| `ad_creatives` | id, kind (image / video), source (rendered / uploaded), storage_path, youtube_video_id, platform_asset_ids (jsonb), text (jsonb), tags, created_at | |
| `ad_drafts` | campaign_id, step, payload (jsonb), dry_run (jsonb), launched_at | The five steps and what the launch sent |
| `ad_alerts` | campaign_id, kind, detail, sent_at, channel | What was sent to whom and when |
| `seo_templates`, `seo_overrides`, `seo_daily`, `seo_pairs` | [seo.md](seo.md#files-planned) | |
| `profiles.acquired_via`, `profiles.acquired_at`; `organizations.acquired_via`, `acquired_at` | [measurement.md](measurement.md#acquired_via-on-the-account) | |

Row-level security: every table admin-only (`is_admin()`), except `increment_link_open` (anon, by function) and
`newsletter_subscribers` writes by token through security-definer functions (`newsletter_subscribe`,
`newsletter_confirm`, `newsletter_unsubscribe`). All in one migration per wave, applied to dev first, as always.

## Jobs

Registered in `lib/jobs/registry.ts` with schedules in `vercel.json` and expectations for the Steward's review:

| Job | When (UTC) | Does | Expects |
|---|---|---|---|
| `marketing-pull` | daily 06:00 | PostHog Query API → `marketing_daily`; `db` counts from profiles and subscriptions | rows written above zero on a weekday; under 60 s |
| `search-console-pull` | daily 06:30 | Search Analytics and Sitemaps APIs → `seo_daily`, coverage counts | rows for the day three days back; under 60 s |
| `seo-audit` | Sundays 05:00 | The checks in [seo.md](seo.md#the-stewards-seo-audit) → Steward findings | ran; findings may be zero |
| `lifecycle-emails` | daily 13:00 | Due steps → `lib/email.ts` | sent or nothing due; never over 500 in a run (a guard: more means a state bug) |
| `ads-sync` | hourly while a campaign is live, else daily 07:00 | Google Ads and Meta metrics and statuses → `ad_metrics_hourly`, `marketing_spend`, `ad_entities`; token refresh; drift check; alerts | every connected platform answered; under 120 s; an alert sent when its condition held |

Each is a Vercel cron route wrapped in `withJobRun`, so Growth's jobs appear on Steward › Jobs with every other job
and a failed pull is a red chip the Steward reads the next morning.

## Help entries

Added to `lib/admin/help.ts` under a new door key `growth` (the `HelpDoor` type gains it; `/admin/help` lists it):
`growth-overview`, `funnel`, `cost-per-trial`, `campaign`, `campaign-link`, `campaign-code`, `decision`, `landing-page`,
`copy-block`, `lifecycle-email`, `newsletter`, `double-opt-in`, `spend`, `seo-template`, `placeholder`, `crawler`,
`search-performance`, `indexing`, `sharing-preview`, `organic`, `ad-platform`, `ad-connection`, `developer-token`,
`ad-group`, `ad-set`, `query-pattern`, `responsive-search-ad`, `dry-run`, `ad-ceiling`, `ad-review-status`,
`changed-outside`, `creative-library`, `ad-alert`. Each with `title`, `short`, `do`, and `see` pointing at the section
of these specs; the console test holds every panel to a key as it does today.

## Build plan

Four waves, each a PR of its own with its release note, built the way [build-roadmap-section](../../../.claude/skills/build-roadmap-section/SKILL.md)
builds a section: units on sub-branches, a model per unit, merged into `feature/growth-{wave}`, verified, one PR. The
first two must be live before the January 2027 push ([plan.md](plan.md#calendar)); wave 1 has no dependency on
anything unbuilt; wave 4 waits for Stripe and the trial ([commercialization.md](../commercialization.md)).

### Wave 1: findable, measurable, and somewhere to land (November 2026)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 1a Sitemap, robots, canonical | `app/sitemap.ts`, `app/robots.ts` rendered from the crawler switches with a safe default, `alternates.canonical` on every public page, IndexNow | Medium | Sonnet |
| 1b Metadata templates | `seo_templates` with defaults, `lib/seo/templates.ts` and placeholders, every public `generateMetadata` through it, the Templates editor with preview, per-page overrides | Large | Opus |
| 1c Open Graph, structured data, the image renderer | `opengraph-image.tsx` for the college family, trends, and the default; `lib/seo/structured-data.ts` and the JSON-LD on each page type; the renderer generalized so the creative library can ask for ad sizes | Medium | Sonnet |
| 1d Attribution | `/go/{code}`, the cookie in `proxy.ts`, `acquired_via`, the new events, the privacy paragraph, `marketing_links` and `marketing_link_opens` | Medium | Opus (touches auth) |
| 1e Growth door, Overview, Campaigns | The door and tab, `marketing_campaigns`, the link builder with QR, `lib/marketing/posthog.ts`, `marketing-pull`, `marketing_daily`, the Overview reading `db` counts and PostHog | Large | Opus |
| 1f Landing pages | `/for/parents`, `/for/students`, `/for/counselors` from the splash page's components, `marketing_pages` and the Pages editor with drafts, `FAQPage` from Questions, `landing_*` events | Large | Opus |
| 1g QA | Phone at 390 px, help keys, `npm run verify`, Lighthouse SEO score on five page types, a shared-card check | | Sonnet |

### Wave 2: the ad platforms (December 2026)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 2a Connections and the client layer | `ad_connections` with Vault secrets, the OAuth redirect for Google, the Meta system-user token, `lib/ads/google.ts` and `lib/ads/meta.ts` (typed wrappers over the two APIs' REST surfaces with retries, rate-limit handling, and recorded dry runs), the Connections cards; runs against a Google Ads test account until the developer token is approved | Large | Opus |
| 2b Authoring | The five-step Platform tab, `ad_drafts`, the college and query-pattern generator, responsive-search-ad and Meta templates with limits and the words rule, the dry run, the ceiling check, Launch writing `ad_entities` | Extra large | Opus |
| 2c Creative library | `ad_creatives`, rendered images at platform sizes from the 1c renderer, uploads, the YouTube unlisted upload for Shorts, tags and in-use | Medium | Sonnet |
| 2d Operate, sync, alerts | Pause, Resume, Change budget, Swap creative; `ads-sync` with metrics, statuses, spend into `marketing_spend`, drift detection; `ad_alerts` by email and text; the Steward's expectations for the job | Large | Opus |
| 2e QA | Every mutation against the test account, replayed from the dry run; the ceiling refuses an over-budget launch; a phone can pause in two taps; the under-18 template set has no price | | Sonnet |

### Wave 3: search in the console, sharing (January 2027)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 3a Search Console pull | `lib/seo/search-console.ts`, `search-console-pull`, `seo_daily`, the Search performance and Indexing panels | Medium | Sonnet |
| 3b Steward SEO audit | `seo-audit` with its checks and findings, proposals for template fixes | Medium | Opus |
| 3c Share buttons and compare pairs | The Share button and `share_created`; `/compare/{id}-vs-{id}` for the top pairs with `seo_pairs`; the Sharing panel | Medium | Sonnet |
| 3d QA | | | Sonnet |

### Wave 4: money and mail (after Stripe and the trial)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 4a Spend and cost per trial | `marketing_spend` for non-platform costs (typed in or CSV), the grid, cost per trial on the overview and campaign pages joining platform spend with trials, the Decision box | Medium | Sonnet |
| 4b Lifecycle emails | `lifecycle_steps`, the five sequences' templates, `lifecycle-emails`, the Emails screen's switches and words, the account preference's effect | Large | Opus |
| 4c Newsletter | Double opt-in, the tables and functions, the issue editor, send with typed confirmation, Resend's open and click webhook into counts | Medium | Opus |
| 4d QA | Deliverability check (SPF, DKIM, DMARC already set for `usequad.app`; a mail-tester run), the legal footer, unsubscribe in one click | | Sonnet |

The migration for each wave goes to the owner to apply on dev before the PR merges, as every console build has done.

## Files (planned)

- `app/admin/growth/{page,campaigns,pages,search,emails,spend}/…`, `lib/admin/console.ts` (the door), `lib/admin/help.ts`,
  `lib/admin/growth-*.ts` (reads, actions, view models, words), `components/admin/LinkBuilder.tsx`, `components/admin/CopyBlockEditor.tsx`.
- `app/for/{parents,students,counselors}/page.tsx`, `components/marketing/*` (the frames reused from the splash page).
- `app/go/[code]/route.ts`, `lib/marketing/*`, `app/api/cron/{marketing-pull,lifecycle-emails}/route.ts`, `lib/emails/lifecycle/*`,
  `app/newsletter/{confirm,unsubscribe}/[token]/route.ts`.
- The SEO files in [seo.md](seo.md#files-planned); the attribution files in [measurement.md](measurement.md#files-planned).
- Ads: `app/admin/growth/ads/{page,connections,creatives}/…`, `app/admin/growth/ads/connect/google/route.ts` (OAuth
  start and callback), `app/admin/growth/campaigns/[id]/platform/…` (the five steps), `lib/ads/google.ts`,
  `lib/ads/meta.ts`, `lib/ads/youtube.ts`, `lib/ads/generate.ts` (colleges and query patterns → ad groups, keywords,
  ads; pure, tested), `lib/ads/templates.ts` (platform limits, the words rule), `lib/ads/ceiling.ts`, `lib/ads/alerts.ts`,
  `app/api/ads/image/route.ts` (the renderer at platform sizes), `app/api/cron/ads-sync/route.ts`.
- Migrations: `…_marketing_wave1.sql`, `…_marketing_wave2.sql` (the `ad_*` tables and Vault secrets),
  `…_marketing_wave3.sql`, `…_marketing_wave4.sql`.
- Env: `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`, `SEARCH_CONSOLE_SITE_URL`,
  `INDEXNOW_KEY`, `RESEND_WEBHOOK_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_CLIENT_ID`,
  `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (the manager account), `META_APP_ID`,
  `META_APP_SECRET`, `ADS_ALERT_PHONE` (optional; email alerts always go to the admin's address).
- Tests for the ads: `tests/ads-generate.test.mts` (a filter set and three patterns yield the expected ad groups and
  keywords; negatives applied; the final URL carries the campaign code), `tests/ads-templates.test.mts` (every
  template within each platform's limits for the longest college name; the under-18 set refuses a price), `tests/ads-ceiling.test.mts`,
  `tests/ads-sync.test.mts` (fixture responses from both APIs land in the right rows; drift is detected; each alert
  fires on its condition and not otherwise; an expired token raises Stopped), `tests/ads-dry-run.test.mts` (the dry
  run's words match the mutations sent).
- Tests: the ones named in the three specs, plus `tests/growth-console.test.mts` (every Growth panel has a help key; a
  campaign code is validated; a destination must be a route; ending a campaign keeps its links; the newsletter form is
  absent for a signed-in student; a copy block with a forbidden phrase is refused).

## Owner steps

From home, once, in November 2026 so the January push is not waiting on an approval:

1. **Google:** create a Google Ads manager account and, under it, the ad account with its payment method; in Google
   Cloud, a project with the Google Ads API enabled and an OAuth client (web application, redirect
   `https://usequad.app/admin/growth/ads/connect/google`); apply for the developer token's **Basic access** from the
   manager account (the form asks what the tool does: "manages our own account's campaigns from our admin console");
   create a Google Ads **test account** for the build to run against meanwhile; set the four `GOOGLE_ADS_*` variables
   with `npm run vercel-env`.
2. **Meta:** a Meta Business portfolio with business verification, the ad account and its payment method, an app in
   development mode with the Marketing API product, a system user with ads-management permission and a long-lived
   token; set `META_APP_ID` and `META_APP_SECRET`; paste the token into the Connections card once (it is stored in
   Vault, not in env).
3. **Connect** both platforms from Growth › Ads › Connections (the Google step redirects to a Google consent screen
   and back), and set the month's ceiling and the alert phone number.
4. **YouTube:** a channel for the brand on the same Google account, so Shorts videos can be uploaded unlisted.
5. Everything after this happens in the console. If an ad is disapproved and the API's reason is not enough, the
   appeal is the one thing that may send you back to the platform's console.

## Owner decisions

1. The fifth door or under More ([plan.md](plan.md#owner-decisions), decision 6).
2. **Text alerts:** the planner's text provider can carry the ad alerts to the owner's phone; confirm the number and
   whether all five alerts text or only Disapproved and Stopped (the others arriving by email).
3. **The Google developer token's timing:** if Basic access is not approved by mid-December, launch the January Search
   campaigns from Google's console at home once and let the console take over operating them (the sync and operate
   units work by id on campaigns created anywhere); the authoring unit is used for the next campaign. Decide whether
   that fallback is acceptable or the push waits for the token.
2. Whether the newsletter ships in wave 3 or waits: it is the one part of this spec that holds an email address outside
   `auth.users`, and the owner may prefer to wait until there is something monthly to say.
3. The `promo` parameter on campaign links: built in wave 1 as a passthrough, used only when the owner decides on a
   first-year code ([commercialization.md](../commercialization.md#open-questions), question 4).
