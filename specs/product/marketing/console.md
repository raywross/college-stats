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
  Campaigns       Every campaign and its links
  Pages           The landing pages' words
  Search          How search finds us              (seo.md)
  Emails          Lifecycle emails and the newsletter
  Spend           What each campaign cost
```

Every panel title carries a help key ([Help entries](#help-entries)); every table becomes a card list below `md`;
every action that sends mail, changes a live page, or changes `robots.txt` uses `ConfirmTyped`; every write goes
through the admin log, as the redesign's rules require.

## Overview

`/admin/growth`. The Monday screen ([measurement.md](measurement.md#weekly-review)).

| Block | Shows |
|---|---|
| **This week** | The funnel table from [plan.md](plan.md#how-we-know-it-is-working): arrived, engaged, account, trial, paid, as three columns (parents, students, counselors) with this week, last week, and the change; each number says its source (`PostHog` or `db`) on hover and in the card list |
| **Paid campaigns** | One row per active campaign with spend this month, trials, cost per trial, and a chip: green under $12, amber to $20, red above; the Decision box (kill / hold / double, a sentence) that writes the log and the campaign's status |
| **Search** | Clicks and sign-ups from organic search this week against last; a link to Growth › Search |
| **Counselors** | Organizations created, students joined, working offices (five or more students); a link to People › Organizations |
| **Targets** | The seven metrics of the plan with their April 2027 targets and where each stands, so the plan's promise is on the screen that judges it |
| **Dashboards** | Links to the three PostHog dashboards (URLs in `app_settings` under `growth.dashboards`) |
| **Last pull** | When `marketing-pull` and `search-console-pull` last ran and whether they succeeded; "Refresh now" (rate-limited) |

With `POSTHOG_PERSONAL_API_KEY` unset the PostHog columns read "not connected here" and the `db` columns still work,
so the preview deployment shows real sign-up counts and no analytics.

## Campaigns

`/admin/growth/campaigns`. The registry and the link builder.

**The table** (`marketing_campaigns`): code, name, audience (parents / students / counselors), channel (search /
meta / sponsorship / video / reddit / email / directory / conference / newsletter / other), status (draft / live /
paused / ended), start, end, planned monthly budget, landing page, and the week's opens, sign-ups, trials. Filters by
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

## Sharing

Not a console screen but a site feature the console counts: a **Share** button on a college page, a compare page,
and each trends study, offering copy link, text, X, Facebook, and the system share sheet on a phone (`navigator.share`),
with the Open Graph image making the shared card worth looking at ([seo.md](seo.md#built-in-code-once)). Fires
`share_created {kind, channel}`. A shared list (`/l/{token}`) already exists and stays as it is. No referral codes,
no rewards, no "invite three friends": the share is a courtesy, and the count tells us whether the pages travel.

## Model

| Table | Columns | Notes |
|---|---|---|
| `marketing_campaigns` | id, code (unique), name, audience, channel, status, starts_on, ends_on, monthly_budget_cents, landing_path, notes, created_by, created_at | Decisions are admin-log rows with `action: campaign_decision` and the sentence |
| `marketing_links` | id, campaign_id, code (unique), destination_path, utm_source, utm_medium, promo_code, qr_svg, created_at | `code` defaults to the campaign's; sub-links append a suffix |
| `marketing_link_opens` | link_code, day, count | `increment_link_open(code)` security-definer function, callable by the anon role from the route handler, increments or inserts; nothing else about the open is kept |
| `marketing_spend` | campaign_id, month (date, first of month), amount_cents, source, note, updated_at | |
| `marketing_daily` | day, campaign (code or `organic:*` or `all`), audience, step, count, source | Written by `marketing-pull`; the overview and campaign pages read it |
| `marketing_pages` | page, block, draft_text, published_text, updated_at, updated_by | |
| `newsletter_subscribers` | id, email, kind, status, source_campaign, token, confirmed_at, unsubscribed_at | Email is the only personal field in this spec's tables; deleted on unsubscribe after 30 days |
| `newsletter_issues` | id, kind, title, intro, picks (jsonb of release-note slugs and trend slugs), sent_at, sent_count | |
| `lifecycle_steps` | sequence, step, subject, body_variable, enabled, updated_at | The editable words of each step |
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

Each is a Vercel cron route wrapped in `withJobRun`, so Growth's jobs appear on Steward › Jobs with every other job
and a failed pull is a red chip the Steward reads the next morning.

## Help entries

Added to `lib/admin/help.ts` under a new door key `growth` (the `HelpDoor` type gains it; `/admin/help` lists it):
`growth-overview`, `funnel`, `cost-per-trial`, `campaign`, `campaign-link`, `campaign-code`, `decision`, `landing-page`,
`copy-block`, `lifecycle-email`, `newsletter`, `double-opt-in`, `spend`, `seo-template`, `placeholder`, `crawler`,
`search-performance`, `indexing`, `sharing-preview`, `organic`. Each with `title`, `short`, `do`, and `see` pointing at
the section of these specs; the console test holds every panel to a key as it does today.

## Build plan

Three waves, each a PR of its own with its release note, built the way [build-roadmap-section](../../../.claude/skills/build-roadmap-section/SKILL.md)
builds a section: units on sub-branches, a model per unit, merged into `feature/growth-{wave}`, verified, one PR. Wave
1 has no dependency on anything unbuilt; wave 3 waits for Stripe and the trial ([commercialization.md](../commercialization.md)).

### Wave 1: findable and measurable (before any spend)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 1a Sitemap, robots, canonical | `app/sitemap.ts`, `app/robots.ts` rendered from the crawler switches with a safe default, `alternates.canonical` on every public page, IndexNow | Medium | Sonnet |
| 1b Metadata templates | `seo_templates` with defaults, `lib/seo/templates.ts` and placeholders, every public `generateMetadata` through it, the Templates editor with preview, per-page overrides | Large | Opus |
| 1c Open Graph and structured data | `opengraph-image.tsx` for the college family, trends, and the default; `lib/seo/structured-data.ts` and the JSON-LD on each page type | Medium | Sonnet |
| 1d Attribution | `/go/{code}`, the cookie in `proxy.ts`, `acquired_via`, the new events, the privacy paragraph, `marketing_links` and `marketing_link_opens` | Medium | Opus (touches auth) |
| 1e Growth door, Overview, Campaigns | The door and tab, `marketing_campaigns`, the link builder with QR, `lib/marketing/posthog.ts`, `marketing-pull`, `marketing_daily`, the Overview reading `db` counts and PostHog | Large | Opus |
| 1f QA | Phone at 390 px, help keys, `npm run verify`, Lighthouse SEO score on five page types, a shared-card check | | Sonnet |

### Wave 2: search in the console, the pages

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 2a Search Console pull | `lib/seo/search-console.ts`, `search-console-pull`, `seo_daily`, the Search performance and Indexing panels | Medium | Sonnet |
| 2b Steward SEO audit | `seo-audit` with its checks and findings, proposals for template fixes | Medium | Opus |
| 2c Landing pages | `/for/parents`, `/for/students`, `/for/counselors` from the splash page's components, `marketing_pages` and the Pages editor with drafts, `FAQPage` from Questions, `landing_*` events | Large | Opus |
| 2d Share buttons and compare pairs | The Share button and `share_created`; `/compare/{id}-vs-{id}` for the top pairs with `seo_pairs`; the Sharing panel | Medium | Sonnet |
| 2e QA | | | Sonnet |

### Wave 3: money and mail (after Stripe and the trial)

| Unit | Builds | Complexity | Model |
|---|---|---|---|
| 3a Spend and cost per trial | `marketing_spend`, the grid, the CSV importer, cost per trial on the overview and campaign pages, the Decision box | Medium | Sonnet |
| 3b Lifecycle emails | `lifecycle_steps`, the five sequences' templates, `lifecycle-emails`, the Emails screen's switches and words, the account preference's effect | Large | Opus |
| 3c Newsletter | Double opt-in, the tables and functions, the issue editor, send with typed confirmation, Resend's open and click webhook into counts | Medium | Opus |
| 3d QA | Deliverability check (SPF, DKIM, DMARC already set for `usequad.app`; a mail-tester run), the legal footer, unsubscribe in one click | | Sonnet |

The migration for each wave goes to the owner to apply on dev before the PR merges, as every console build has done.

## Files (planned)

- `app/admin/growth/{page,campaigns,pages,search,emails,spend}/…`, `lib/admin/console.ts` (the door), `lib/admin/help.ts`,
  `lib/admin/growth-*.ts` (reads, actions, view models, words), `components/admin/LinkBuilder.tsx`, `components/admin/CopyBlockEditor.tsx`.
- `app/for/{parents,students,counselors}/page.tsx`, `components/marketing/*` (the frames reused from the splash page).
- `app/go/[code]/route.ts`, `lib/marketing/*`, `app/api/cron/{marketing-pull,lifecycle-emails}/route.ts`, `lib/emails/lifecycle/*`,
  `app/newsletter/{confirm,unsubscribe}/[token]/route.ts`.
- The SEO files in [seo.md](seo.md#files-planned); the attribution files in [measurement.md](measurement.md#files-planned).
- Migrations: `…_marketing_wave1.sql`, `…_marketing_wave2.sql`, `…_marketing_wave3.sql`.
- Env: `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`, `SEARCH_CONSOLE_SITE_URL`,
  `INDEXNOW_KEY`, `RESEND_WEBHOOK_SECRET`.
- Tests: the ones named in the three specs, plus `tests/growth-console.test.mts` (every Growth panel has a help key; a
  campaign code is validated; a destination must be a route; ending a campaign keeps its links; the newsletter form is
  absent for a signed-in student; a copy block with a forbidden phrase is refused).

## Owner decisions

1. The fifth door or under More ([plan.md](plan.md#owner-decisions), decision 6).
2. Whether the newsletter ships in wave 3 or waits: it is the one part of this spec that holds an email address outside
   `auth.users`, and the owner may prefer to wait until there is something monthly to say.
3. The `promo` parameter on campaign links: built in wave 1 as a passthrough, used only when the owner decides on a
   first-year code ([commercialization.md](../commercialization.md#open-questions), question 4).
