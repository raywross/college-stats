# Open the doors: the public site, free, before the price

> Status: **planned** 2026-11-09 (owner). Let the public in, and let search engines index the site in earnest, before
> Stripe and the trial exist: "We could let people use it for free for now. The cost is really only on the essay
> proofreading, and I have that capped, so the risk would be quite low." This epic is the list of what has to be true
> first, what "free for now" promises, and what we watch once the doors are open. It pulls
> [launch-database.md](../launch-database.md) forward from "just before the formal release" to now, and takes wave 1 of
> the Growth console ([marketing/console.md](marketing/console.md#build-plan)) as its findable-and-counted half. Part of
> [product](README.md); the price itself is [commercialization.md](commercialization.md).

## Why now

Search needs lead time. The marketing plan's first paid push is January 2027 ([marketing/plan.md](marketing/plan.md#calendar)),
and its engine is organic search, which takes weeks to months to index about 17,000 pages and start sending people.
Waiting for billing to open the doors would spend that lead time. Nothing in the findable-and-counted work depends on
Stripe, and the Advisor's gate was never built, so the site is already free for anyone who signs in; the only thing
missing is the decision to invite them and the handful of things a public site owes its users.

## What "open" means today

Read from the live site and the code on 2026-11-09:

| Question | Answer |
|---|---|
| Can crawlers reach the site? | Yes. `usequad.app` answers 200, there is no `robots.txt`, and no page carries a site-wide `noindex`. The admin, caseload, join, and sign-in pages already say `noindex` in their metadata |
| Are they finding it? | Slowly and badly: no sitemap, one site-wide description, no canonical URLs, no cards, no structured data ([marketing/seo.md](marketing/seo.md#today)) |
| Who can sign up? | Anyone 13 or older with an email address ([accounts.md](accounts.md)); nothing is invite-only |
| What do they get? | Everything. The entitlement map and the trial are planned, not built, so the Advisor, the essays workspace, the reader's notes, and the counselor portal are free to every account |
| Whose database holds their data? | The **dev** Supabase project in Montréal, which also holds the 13 user-testing personas, the "pretend today" setting, and gets every migration first ([supabase.md](../supabase.md#current-state-pre-release-dev-only)) |
| What does a user cost? | Nearly nothing, except essay reads: Claude Opus per read, capped at five a day per draft, fifty a day per student, and sixty per draft per cycle, under the owner's API spending cap ([essays/reviewer.md](essays/reviewer.md)) |
| What is the site missing as a public service? | A terms-of-use page; the privacy page's sentence naming the essay reader's provider and what it receives; any statement that the Advisor is free for now and what happens when it is not |

So "opening the doors" is not a switch. It is five small obligations, one database, and wave 1 of the Growth console.

## What we promise, and what we say

**Free for now, in so many words.** The splash page, the home page's Advisor block, and the `/for/*` landing pages
say the same sentence, drawn from one constant so it changes once: *"Quad Advisor is free while we're in early access.
A price comes in 2027, and accounts made before then keep the Advisor free through the end of this application cycle."*
No price is shown anywhere until the pricing page ships; the plan's "$20 a year" stays in the specs.

**Early accounts.** Every account created before the price goes live is an *early account*. The rule is a single
setting, `advisor.price_live_at` (unset until Stripe ships), and `isEarly(account)` is `created_at < price_live_at`:
no column, no backfill. Early accounts:

- keep the Advisor free until **2027-08-31**, the end of the 2026–27 cycle, then renew at the list price in force,
  with the ordinary renewal notice ([commercialization.md](commercialization.md#billing));
- are reported separately in the Growth overview and **excluded from the price test and from trial-conversion
  metrics** ([marketing/measurement.md](marketing/measurement.md)): a cohort that was promised free would distort both;
- are counted with `acquired_via` like anyone else, so we still learn how they arrived (`organic`, a counselor's code,
  a share link).

**What stays private.** The public opening changes nothing about data: no pixels, no behavioral targeting, the
privacy page's rules for minors hold, and the campaign cookie arrives only with wave 1d and is described on the
privacy page the day it does.

## The work

In order. Each row says who does it and roughly how long.

### A. Owed to the public before the first stranger signs up

| # | Work | Who | Size |
|---|---|---|---|
| A1 | **The production database**: create `quad-prod` in us-east-1, apply every migration, deploy the invite function and its secrets, set the Auth site URL and sender, point Vercel Production at it, keep dev as dev. Prod starts empty except the owner's own account, re-created; the personas stay on dev. The `planner.today` ("pretend today") setting is never set on prod. The full procedure is [launch-database.md](../launch-database.md) | Owner creates the project; Claude does the rest | Half a day |
| A2 | **Terms of use** at `/terms`, linked from the footer beside Privacy and from sign-up: 13 and older, a guardian's permission for a minor's account, the estimate may not be scraped or systematically queried ([chances/estimate.md](../chances/estimate.md#protecting-the-method)), essays stay the student's, no warranty on data (every value cites its source and year), how to close an account, how to reach us (`support@usequad.app`). Payment and refund terms are added when the price ships | Claude drafts; owner reads before merge | A day |
| A3 | **Privacy page additions**: the essay reader's provider (Anthropic), what is sent (the draft and the prompt, never the student's name or record), that the API terms exclude training, and the retention window; the "free for now" promise's data side (nothing). The campaign cookie paragraph waits for A5/wave 1d | Claude | Hours |
| A4 | **The "free for now" sentence** on the splash page and the home page's Advisor block, from one constant (`lib/brand.ts` `EARLY_ACCESS_NOTICE`), and the `advisor.price_live_at` setting with `isEarly()` in `lib/entitlements.ts` (which exists and answers yes to everything today; commercialization fills in the map later) | Claude | Hours |
| A5 | **Hosting tiers checked, not assumed**: Vercel's plan allows commercial use (Hobby does not); Resend's free tier is 100 emails a day, which sign-in links plus digests will pass at public scale, so the Pro tier is bought when the daily count nears 80; Supabase's tier against the prod project's size; PostHog's free million events a month against the sitemap's crawl (crawlers send no events; fine) | Owner checks the plans; Claude adds the daily email count to the Growth overview | An hour |
| A6 | **The method's repository**: the launch checklist moves `lib/chances/model.ts` and `specs/chances/method/` to a private package "at launch" ([chances/estimate.md](../chances/estimate.md#at-launch-move-the-method-private)); the owner decided on 2026-10-10 to deal with it then. Decide whether opening the doors is "then" | Owner decides | A day if yes |

### B. Findable and counted: wave 1 of the Growth console, as written

[marketing/console.md](marketing/console.md#build-plan) wave 1, unchanged: 1a sitemap, robots, canonical, IndexNow;
1b metadata templates; 1c Open Graph images and structured data; 1d attribution (`/go/{code}`, the cookie,
`acquired_via`, the funnel events); 1e the Growth door with the Overview and Campaigns; 1f the landing pages;
1g QA. Two additions for this epic:

- the Overview gains an **Early access** block: accounts to date, early accounts, sign-ups per day for 14 days, essay
  reads per day and their estimated cost, emails sent per day against the tier's limit;
- the landing pages carry the "free for now" sentence from A4 instead of a price or a trial button.

### C. Owner steps, from home

| Step | Why |
|---|---|
| Create `quad-prod` in Supabase (East US, North Virginia) and hand over the URL and keys | A1 |
| Verify `usequad.app` in Google Search Console and Bing Webmaster Tools; connect Search Console to the console when wave 3 ships | The Search screen's numbers; nothing indexes faster for it, but we can see what does |
| Check the Vercel and Resend plans | A5 |
| Read the terms draft | A2 |
| Decide the method's repository | A6 |
| Say when: the recommendation is to open as soon as A1–A5 and wave 1 are live, **targeting 2026-12-01**, so search has December to index before the January push | The whole point |

### D. What we watch once open

The Growth overview's Early access block, read daily for the first two weeks and weekly after:

| Signal | Fine | Look |
|---|---|---|
| Sign-ups a day | Any | A jump with no campaign and no share links behind it: check for bots at sign-up, add a turnstile if real |
| Essay reads a day and their cost | Under the owner's API cap by half | Rising toward the cap: lower the per-student daily cap by setting, not by code |
| Emails a day | Under 80 on Resend's free tier | Over: buy the tier that day |
| Pages indexed (Search Console) | Rising week over week | Flat after four weeks: check the sitemap is fetched and the crawler switches are open |
| Error rate and p75 response on the public pages | As today | Up with the crawl: the pages are static and cached, so this would be a regression to find, not a capacity problem |

Nothing here requires a human on call. A reads-per-day alert and an emails-per-day alert go to the owner by email
through the console's existing job-failure path.

## Done when

- The site runs on `quad-prod`; dev holds only development data.
- `/terms` exists and is linked; `/privacy` names the essay reader's provider.
- The splash page, the home page, and the landing pages say the Advisor is free for now and what early accounts keep.
- `isEarly()` exists, is tested, and the Growth overview reports early accounts apart from the rest.
- Wave 1 of the Growth console is live: a sitemap is submitted, Search Console shows pages indexed, every public page
  has its own title and description, a shared college page shows a card, `acquired_via` is written on new accounts.
- The owner has checked the hosting tiers and decided the method's repository.
- A release note tells readers the site is open and free for now.

## Owner decisions

1. **What early accounts keep.** Recommended: the Advisor free through 2027-08-31, then list price. Alternatives: a
   plain 14-day trial like everyone else when the price arrives (breaks a promise if we said "free for now"), or a
   lifetime price lock (sets a price we have not tested yet).
2. **The date.** Recommended 2026-12-01, after A1–A5 and wave 1; the owner's call if wave 1 slips.
3. **The method's repository** (A6): move it private now, or at the formal release.
4. **The early-access sentence.** The wording above, or the owner's own.

## Files (planned)

- `app/terms/page.tsx` (new), `components/layout/Footer.tsx` (the link), `app/privacy/page.tsx` (the reader's
  provider paragraph), `lib/brand.ts` (`EARLY_ACCESS_NOTICE`), `lib/entitlements.ts` (`isEarly(account, settings)` beside
  today's `allowed()`), `app/advisor/page.tsx` and the home page's Advisor block
  (the sentence), the Growth overview's Early access block (with wave 1e), `tests/entitlements.test.mts` (an account
  created before `price_live_at` is early; after, not; unset means everyone is early).
- Settings: `advisor.price_live_at` (`app_settings`, set by `admin_set_setting()` the day Stripe goes live).
- No migration of its own: `created_at` already exists on profiles, and `acquired_via` arrives with wave 1d.
- Specs touched: [launch-database.md](../launch-database.md) (pulled forward), [commercialization.md](commercialization.md)
  (early accounts in the billing rules), [marketing/console.md](marketing/console.md) (the Early access block).
