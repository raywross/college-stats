# Marketing Plan: Three Audiences, One Product, Everything Measured

> Status: **planned** (nothing built). Written 2026-11-09 from the owner's brief: "a key to making the business
> commercially successful will be advertising. We probably want to have a plan to advertise to parents, counselors, and
> students, probably as different campaigns. How do we approach this? How do we track success? How much will it cost? How
> do we implement? Ideally we'd drive the whole thing from the admin functions on the site." This is the plan; the other
> three specs in this folder are what gets built for it: [measurement.md](measurement.md) (attribution, PostHog in the
> console), [seo.md](seo.md) (search, driven from the console), and [console.md](console.md) (the Growth door: campaigns,
> links, pages, emails, spend). **Revised the same day on the owner's decisions:** the first push runs on Google and
> Meta only, with everything else [layered in later](#layered-in-later) if those two don't carry it; and students 13
> to 17 may be reached with contextual ads (no behavioral targeting), since the law and the platforms allow it and the
> earlier blanket line was a choice, not a rule. Part of [product](../README.md); the product being sold is in
> [commercialization.md](../commercialization.md) and [advisor.md](../advisor.md).

## Where we stand (2026-11-09)

- **The product.** One paid thing, Quad Advisor: $20 a year for a student, $30 for a family, a 14-day trial with the
  card up front, annual only ([commercialization.md](../commercialization.md)). Everything else is free: 1,893 college
  profiles with eight topic pages each, Explore, Compare, the trends studies, the high school pages, the glossary, and a
  free account with the record and Quad's estimate. Counselors and consultants use the portal free
  ([counselor-portal.md](../counselor-portal.md)).
- **Not yet for sale.** Stripe, the trial, and the pricing page are not built. Until they are, a campaign's last step is
  a free account, not a payment. That decides the order below: search, the counselor channel, and the measurement go
  first, and paid campaigns to parents wait for the day a parent can buy.
- **What exists to build on.** PostHog, cookieless, through a typed event registry with 60-odd events
  ([telemetry.md](../telemetry.md)); the admin console with four doors, a jobs registry, and site-wide switches
  ([admin-redesign.md](../admin-redesign.md), [admin-jobs.md](../admin-jobs.md)); email through Resend with
  unsubscribe handling; a splash page at `/advisor` that renders the product with a sample student
  ([advisor.md](../advisor.md#3-the-page-advisor-signed-out)); share links for lists (`/l/{token}`).
- **What is missing for search.** No `sitemap.xml`, no `robots.txt`, one site-wide description, a bare title on
  college pages, no Open Graph image, no structured data ([seo.md](seo.md#today)). Some 17,000 public pages with real,
  cited data are findable only by accident. This is the cheapest marketing we will ever do.

## Principles

1. **Search is the engine; ads are the tests.** At $20 a year, paid acquisition cannot carry the business (the math is
   [below](#the-economics)). The pages we already have, made findable, plus the counselor channel, are the volume;
   paid campaigns are small, seasonal, and killed or scaled by their measured cost per trial. **The first push runs on
   two platforms, Google and Meta** (owner, 2026-11-09): Google Ads for Search and YouTube, Meta for Facebook and
   Instagram. Nothing else is paid for or staffed until those two have been read for a season
   ([Layered in later](#layered-in-later)).
2. **Nothing we would not say on the privacy page.** No ad pixels, no Meta or Google tags, no conversion APIs that send
   hashed emails, no retargeting, no lookalike or custom audiences built from our users, and **no behavioral targeting
   of anyone**: an ad reaches a person because of the query, the video, or the page it sits beside, never because of
   who the platform thinks they are ([telemetry.md](../telemetry.md#privacy);
   [measurement.md](measurement.md#what-we-do-not-do)). Students 13 to 17 may be reached this way; the law restricts
   targeted advertising to minors, not advertising, and both platforms already limit teen targeting to age and
   location. Ad copy to students never presses a minor to spend: the ask is an account and a parent invited.
   Attribution is a first-party campaign code and our own numbers. We accept that ad platforms optimize worse without
   their pixels.
3. **Sell the advisor and the caseload; the data is the proof** (owner, 2026-11-09). To parents and students, every ad
   shows the advisor doing its job: the list sorted by where the student stands, the three things to do this season
   with a guide for each, the calendar that texts the day before, offers side by side, the parent's view. To
   counselors, every ad shows the caseload: every student's plan in one place, asks, notes, the export, free. A cited
   number from the site (a college's admit rate for its pool, a trend) backs the claim and never replaces it. No
   "boost your chances" and no percentage chances, ever ([chances/README.md](../../chances/README.md)).
4. **The counselor is the channel, not the customer.** A counselor who runs a caseload on Quad brings dozens of
   families; the portal is free and the student's path is the ordinary one
   ([counselor-portal.md](../counselor-portal.md#the-channel)). We never pay counselors, show them who has not paid,
   or hand them referral links.
5. **Every campaign is measured end to end** from the first click to the paid year, with the same funnel for every
   audience, in the console, with no spreadsheet ([measurement.md](measurement.md)).
6. **One owner, part time.** The plan assumes one person and coding agents. Anything that needs a daily hand (bidding,
   posting, replying) is sized for an hour a day or dropped.
7. **Everything runs from the console** (owner, 2026-11-09). The owner's day-job network blocks Google's and Meta's ad
   consoles and not the site, so the campaigns are written, launched, watched, paused, and re-budgeted from the Growth
   door through the platforms' APIs, on a phone, with alerts that arrive without the console open
   ([console.md](console.md#ad-platforms-the-campaigns-run-from-here)). The platforms' own consoles are for one-time
   setup from home.

## The economics

| | Student | Family |
|---|---|---|
| Price a year | $20 | $30 |
| After Stripe (2.9% + $0.30; Stripe Tax where owed) | about $19.10 | about $28.80 |
| Years a plan lasts (planning assumption) | 2.5 (sophomore spring to the deposit) | 3.5 (an older and a younger child) |
| Lifetime revenue, net | about $48 | about $100 |
| Trial to paid (assumption until measured) | 40% | 40% |
| Revenue per trial started | about $19 | about $40 |

So a trial is worth about $19 to $40 over its life, and a first year's cash is $19 to $29. The rules that follow:

- **A paid campaign's ceiling is $12 per trial started** (blended across the two products), which pays back inside the
  first year. A campaign running above $20 per trial for two weeks stops. Consumer-subscription benchmarks in 2026 put
  search ads for a $20 product at $15 to $40 per trial, so most paid tests will fail this bar; the plan exists to find the
  few that do not (a parent searching a college's name plus "chances" in January is the best candidate).
- **Organic sign-ups cost the content.** A college page that ranks for its name plus "admit rate" sends visitors for
  years at no marginal cost; the SEO work in [seo.md](seo.md) is the highest-return item in this plan.
- **One counselor is worth a campaign.** A consultant with 40 students whose families take the advisor at 40% is 16
  trials, about $400 of first-year revenue, for an email, a demo, and a free account.
- The first full cycle (September 2027 to August 2028) aims at 2,000 paid plans, about $45,000, from roughly 5,000
  trials. The channels are sized to that, not to a venture-scale number.
- **The price is being tested, not assumed** (owner, 2026-11-09). The list price stays $20 and $30 and the first
  campaigns run at it; half of each paid campaign's links show $49 and $79 instead, the price riding on the campaign
  code so a visitor sees one price throughout ([commercialization.md](../commercialization.md#price-tests-owner-2026-11-09)).
  At $49 a trial is worth about $17 in first-year cash and the ceiling per trial rises to about $20; at $99 to about
  $30. The April 2027 reading of trials and conversions by price decides the list price for the next cycle, and the
  recommendation on the table is $49 and $79 with a counselor-recommended code toward $35.

## The three campaigns

Each campaign has an audience, a season, one message, its channels, a landing page, a conversion the console counts, a
test budget, and a rule for when it stops or grows. The landing pages are the console's editable pages
([console.md](console.md#pages)); the links are campaign links so every arrival carries its code
([measurement.md](measurement.md#campaign-links)).

### Parents: "Know where your kid stands"

| | |
|---|---|
| Who | Parents of 10th and 11th graders, and of seniors in the fall; 40 to 55; the one who runs the family calendar |
| When | **January to March** (junior-year planning, the biggest window), **August to October** (senior fall), **late March to April** (offers side by side). Quiet in summer and December |
| Message | *An advisor for the whole road to college, for less than one test-prep book.* Where your kid stands at every college on the list, the three things to do this season, every date, offers side by side. $20 a year, 14 days free |
| Proof | The splash page's real frames; a trend study a parent recognizes ("test-optional colleges, this cycle"); the "never does" list (no ads, no leads sold) |
| Google | **Search**, exact and phrase match on high-intent queries: "{college} acceptance rate", "{college} chances", "is {college} a reach", "college list builder", "net price {college}", "ED vs EA"; landing on the college's own page with the advisor's card, not on a generic page. No Display Network, no Performance Max, no remarketing |
| Meta | **Facebook and Instagram feeds**, age 35 to 60 and U.S. as the only targeting plus Meta's own interest categories for parenting and college planning (contextual, not built from our users); three creatives rotated, each a frame of the advisor rendered by the site (the list by level with the shape line, the parent's season view, offers side by side) with one cited number as the caption; no Advantage+ audiences, no custom or lookalike audiences |
| Landing | `/for/parents` (the console's page, [console.md](console.md#pages)): the splash page's parent sections first (For parents, Never miss a date, Offers), the price, the trial button |
| Conversion | `trial_started` with `product` and `campaign`; until Stripe ships, `signup_completed` with `role_hint: guardian` |
| Test budget | $1,500 a month for three months, January to March 2027: $1,000 Google Search, $500 Meta |
| Stop or grow | Stop a channel above $20 per trial after two weeks of spend; double a channel under $12 per trial for a month, then re-read |

### Students: reach them where they search and watch, convert the household

Students under 16 cannot buy; those 16 and over may with a parent's permission ([advisor.md](../advisor.md#2-the-trial)).
A student campaign therefore ends in an account and a parent invited, and the household converts on the parent's side.
Ads reach students contextually (principle 2): by the query they typed or the video they are watching, with age and
country as the only targeting, which is all Google and Meta allow for teens anyway.

| | |
|---|---|
| Who | 10th to 12th graders doing their own research, 13 to 17 and the 18-year-old seniors; they arrive from search on a college's name and from short video |
| When | **January to March** (juniors, in the first push), then August to November (seniors) and the days after decisions (late March) in the next cycle |
| Message | *An advisor that knows where you stand at every college on your list, and what to do this season.* The list sorted by level, the three cards with their guides, the text the day before a deadline; no percentage games, every number with its source. Never "subscribe" or a price to a student; the buttons are "See where you stand" and "Invite a parent" |
| Google | **Search** on the same college-name queries as the parents' campaign (one ad group serves both; a query has no age), plus student-shaped queries: "{college} SAT range", "is {college} test optional", "how many colleges should I apply to". **YouTube Shorts** ads, 15 to 20 seconds: a screen recording of the advisor for the sample student (the list re-sorting by level, a Now card opening its guide, a text arriving), age 13-plus and U.S. as the only targeting, placed on college and study-channel content |
| Meta | **Instagram Reels** ads, the same advisor cuts, age 13 to 19 and U.S. as the only targeting (Meta allows age and location for teens and nothing else) |
| Landing | `/for/students`: the Where you stand strip, the season's three things, "Invite a parent" as the second button, and the "Ask your assistant with Quad's numbers" block ([seo.md](seo.md#assistants-and-ai-search)) |
| Conversion | `signup_completed` with `role_hint: student`, then `household_invite_sent` (a new event, [measurement.md](measurement.md#new-events)) within 30 days |
| Test budget | $500 a month for three months, January to March 2027: $250 Google (Search and Shorts), $250 Meta Reels |
| Stop or grow | Judged by cost per student sign-up and the share who invite a parent within 30 days; a household that converts counts as the student campaign's trial for cost per trial. Stop a placement above $8 per student sign-up or under 15% inviting a parent after a month; double one under $4 per sign-up with 25% inviting |

### Counselors: the free portal, office by office

| | |
|---|---|
| Who | Independent educational consultants (about 2,000 IECA members, about 1,000 HECA, and many more unaffiliated), then high school counseling offices (ASCA's 40,000-plus members; a few counselors per public high school) |
| When | **January to March** in the first push (consultants are mid-cycle and feel the caseload pain), then **May to August** (they plan the next cycle) and **September** (offices set up the year) |
| Message | *See every student's plan in one place, free.* The caseload, asks, notes, the export; your families pay $20 a year for the advisor, you pay nothing, and nothing about money reaches you |
| Google | **Search** on the queries a consultant types: "college counseling software", "independent educational consultant software", "college list tool for counselors", "Common Data Set {college}" (the data pages are a draw for professionals), "caseload management IEC". Small, exact-match, with the free line in the ad |
| Meta | **Facebook feed**, interest categories for education and counseling professions as Meta offers them (contextual), U.S., 25 to 65; a single creative showing the caseload. A $100-a-month test; if Meta cannot find counselors, Google alone carries this audience |
| Landing | `/for/counselors`: the caseload in one frame, the free line, "Start an organization" (the portal's `/org`), the privacy rules a school will ask about, and a link to book a 20-minute demo on a standing weekly slot |
| Conversion | `org_created {kind}`, then `org_student_joined` (both exist); the console counts organizations with five or more students as a working office |
| Test budget | $300 a month for three months, January to March 2027: $200 Google Search, $100 Meta |
| Stop or grow | Judged by cost per organization created and the share that reach five students in 60 days. Stop above $60 per organization; double under $30 with a third reaching five students |

## Calendar

| Month | Build ([console.md](console.md#build-plan)) | Parents | Students | Counselors |
|---|---|---|---|---|
| Nov 2026 | Wave 1: sitemap, robots, metadata, Open Graph and the image renderer, structured data; campaign links and the cookie; the Growth overview; the three landing pages. Owner, from home: ad accounts, the Google developer-token application, the Meta app ([console.md](console.md#owner-steps)) | Advisor frames rendered for the feed ads; words drafted | Three 15-second advisor cuts recorded | The counselor landing page's words; the caseload frame |
| Dec 2026 | Wave 2: the ad platforms in the console: connections, authoring with the dry run, the creative library, operate, sync, alerts, the ceiling | Campaigns authored in the console against the test account: colleges and query patterns picked, ads rendered and reviewed against principle 3 | Shorts uploaded unlisted; Reels set authored | Search campaign authored; demo slot set up |
| Jan 2027 | Stripe and the trial ship ([commercialization.md](../commercialization.md)); wave 3: Search Console in the console, the Steward's SEO audit, sharing | **Launched from the console**: Search and Meta, $1,500 a month | **Launched from the console**: Search, Shorts, and Reels, $500 a month | **Launched from the console**: Search and a Meta test, $300 a month |
| Feb–Mar 2027 | Read the numbers every Monday; kill or double | Offers-season creative ready for April | Swap creatives at week four | |
| Apr 2027 | **Read the push:** which placements came in under their lines; decide what to [layer in](#layered-in-later) | Offers side by side ads, small, if under the line | Decision-week Shorts if under the line | |
| May–Aug 2027 | Review the cycle; set the 2027–28 budget | Quiet | Quiet | Consultants plan the next cycle: Search continues if it worked |

## Budget

Six months, November 2026 to April 2027, planning figures:

Two platforms, three audiences, three months of spend (January to March 2027), and the tooling around them:

| Item | Monthly (Jan–Mar) | Six months | Notes |
|---|---|---|---|
| Google Ads: parents (Search) | $1,000 | $3,000 | Exact and phrase match; no Display Network, no Performance Max, no remarketing |
| Google Ads: students (Search and YouTube Shorts) | $250 | $750 | Age 13-plus and U.S. as the only targeting; placements on college and study content |
| Google Ads: counselors (Search) | $200 | $600 | Exact match on counseling-software and Common Data Set queries |
| Meta: parents (Facebook and Instagram feeds) | $500 | $1,500 | Age, country, and Meta's parenting and college-planning interest categories; no custom, lookalike, or Advantage+ audiences |
| Meta: students (Instagram Reels) | $250 | $750 | Age 13 to 19 and U.S.; the Shorts cuts reused |
| Meta: counselors (Facebook feed) | $100 | $300 | A test; dropped if Meta cannot find counselors |
| Creative tooling | $50 | $300 | An editing app, music, a template set for the static ads and the three video cuts |
| PostHog | $0 | $0 | The free tier is 1 million events a month; the site is far under it. The Query API is included |
| Google Search Console, IndexNow, Bing Webmaster Tools | $0 | $0 | |
| Resend | $20 | $120 | 50,000 emails a month on the first paid tier; lifecycle mail |
| **Total** | **$2,370 in each ad month** | **about $7,300** | $6,900 of it is ad spend across the three months |

What it buys is information at a known price: by April we know each platform's cost per trial for parents, cost per
student sign-up and the share who invite a parent, and cost per counselor organization, each against the line that
stops or doubles it. Google Ads is the larger share because a search ad is matched to a question someone is asking
right now; Meta's share is a test of whether a feed ad can create the question.

Not in the table: the owner's time (an hour a week per platform to read the numbers and swap creatives), and the
engineering, which is the build plan in [console.md](console.md#build-plan) and is done by the owner with coding agents
at the usual cost of a session. Everything in the table stops in a day if the numbers say so. The reserve for a
placement that works is another $5,000 in spring 2027, released only by a measured cost under its line.

## Layered in later

Everything below was in the first draft of this plan and was set aside on the owner's decision (2026-11-09) to run the
first push on Google and Meta alone. Each has a trigger: the reading in April 2027 that would bring it in.

| Channel | What it would be | Bring it in when |
|---|---|---|
| Direct email to consultants | Twenty personal emails a day from the owner's mailbox to consultants in public directories, with a sentence about their practice; a standing demo slot | Google Search finds counselors at under $30 an organization but too few of them (the queries are thin); email is the way to reach the rest |
| IECA or HECA membership; a conference table | Associate membership for the directory and newsletter; a table at IECA's spring or NACAC's September conference ($2,000 to $5,000) | Twenty-five working offices exist and a third came from consultants, so the audience is proven and worth meeting in person |
| Sponsorships | A parent newsletter or podcast placement, $300 to $1,000 a test | Meta's parent cost per trial lands between $12 and $20: the message works and needs a cheaper, more trusted carrier |
| Organic short video | One account on TikTok, Instagram, and YouTube Shorts, two posts a week from the trends studies | Paid Shorts and Reels bring students under $4 a sign-up: the cuts work and an organic account would compound them |
| Reddit | Ads placed in r/ApplyingToCollege and r/chanceme, and a named, declared participant answering with cited pages | Student search ads work and a second contextual student placement is wanted |
| LinkedIn | Posts and a small ad test aimed at counselors | Meta cannot find counselors and the Search queries are exhausted |
| The newsletter | A monthly "what changed in the data" issue for parents and counselors who opt in ([console.md](console.md#emails)) | There are 500 adult accounts to send it to, or the parent campaign shows that the data stories are what people respond to |
| Community participation | Parent Facebook groups and Reddit's parent subreddits, answering with cited pages, never ads | Any time the owner has the hour; it costs nothing but is not counted on |
| The assistant connector as a message | Ads and a landing section built on "Ask ChatGPT, Claude, or Gemini about colleges with Quad's numbers" ([seo.md](seo.md#assistants-and-ai-search); the connector itself is built, [assistants.md](../assistants.md)) | The Assistants referrer group shows citations arriving (50 sessions a week), or 5% of landing-page visitors open the connector block |

Nothing in this table is built or bought until its trigger is read on the Growth overview and the decision is written
in the log.

## How we know it is working

One funnel for every audience, read weekly in the Growth overview ([console.md](console.md#overview)) from PostHog and
our own tables ([measurement.md](measurement.md)):

| Step | Event | Parents | Students | Counselors |
|---|---|---|---|---|
| Arrived | `$pageview` with a campaign code, or an organic landing | visits by campaign | organic visits to college pages | visits to `/for/counselors` and `/org` |
| Engaged | `school_viewed`, `estimate_shown`, `landing_viewed` | saw the advisor's card | saw an estimate | opened the demo or `/org` |
| Account | `signup_completed {role_hint, campaign}` | guardian accounts | student accounts, and `household_invite_sent` | `org_created` |
| Trial | `trial_started {product, campaign}` | | (the household's) | `org_student_joined` |
| Paid | `trial_converted`, `subscription_renewed` | | | students in the office with the advisor (a count, never who) |

The numbers that decide things, with the first targets:

| Metric | Target by April 2027 | Why this one |
|---|---|---|
| Organic search clicks a week (Search Console) | 5,000, from near zero | The engine; the SEO work's direct result |
| Sign-ups a week from organic search | 150 | Search sending the right people |
| Cost per trial started, by paid placement (parents) | under $12 to grow, over $20 to stop | The only number that lets ads scale |
| Cost per student sign-up, by placement | under $4 to grow, over $8 to stop | The student campaign's price, since a student's conversion is an account, not a payment |
| Cost per counselor organization, by placement | under $30 to grow, over $60 to stop | One organization is many families |
| Trial to paid | 40% or better | The product's job; below 30%, fix the trial before spending more |
| Working offices (organizations with five or more students) | 25 | The counselor channel's unit |
| Students who invite a parent within 30 days | 25% | Whether the student campaign converts households |
| Twelve-month renewal (first readable in 2028) | 70% | The lifetime assumption behind the ceiling |

Read every Monday; a short note in the console's log each week with the decision taken (kill, hold, double), so the
history of the plan is on the site with everything else.

## What must exist first

1. **Before any spend:** waves 1 and 2 of [console.md](console.md#build-plan): the campaign cookie and `acquired_via`,
   the `/go/{code}` links, the funnel events, the Growth overview reading PostHog, the landing pages, and the ad
   platforms connected with the ceiling set, so the campaigns can be launched, watched, and paused from the console.
   Spending before this is spending blind, or spending from a console the owner cannot reach at work.
2. **Before paid parent campaigns:** Stripe, the trial, and `/pricing` ([commercialization.md](../commercialization.md));
   the page at `/for/parents` and the lifecycle emails; the legal pages (terms, refund, privacy extended with the
   campaign cookie).
3. **Before any student placement runs:** the ads carry no price and no "subscribe"; targeting is age and country
   only, checked in each platform's settings; the student landing page has its "Invite a parent" button and the
   `household_invite_sent` event, so the campaign's conversion can be counted.
4. **Before anything is layered in:** the April 2027 reading of the Google and Meta push, with its trigger met
   ([Layered in later](#layered-in-later)).

## Owner decisions

1. **Pixels and conversion APIs.** The plan says none, and judges ads by our own numbers. Google's and Meta's
   optimization will be worse for it (they cannot see conversions). Confirm, or allow server-side conversion events with
   hashed emails for adults only (then the privacy page says so).
2. **AI crawlers** (GPTBot, ClaudeBot, PerplexityBot and the rest) in `robots.txt`: allow, so answers cite Quad, or
   block ([seo.md](seo.md#crawlers)). The plan's default is allow for the public data pages and block for everything
   signed in.
3. **The ad ceiling.** $2,300 a month for three months across the two platforms and three audiences, $5,000 in
   reserve. Confirm or change.
4. ~~Memberships and the conference~~ Set aside 2026-11-09: in [Layered in later](#layered-in-later) with its trigger.
5. **A "counselor recommended" code** for a first-year discount ([commercialization.md](../commercialization.md#open-questions),
   question 4): the campaign links can carry a Stripe promotion code the day the owner wants one; nothing here needs it.
6. **The fifth door.** Growth as its own door in the console and a fifth tab on a phone, or under More
   ([console.md](console.md#placement)).
7. ~~The price~~ Decided 2026-11-09: test at $20 first and adapt. The list price stays $20 and $30 through the first
   push, with $49 and $79 shown on half of each paid campaign's links as a price test; the April 2027 reading decides
   ([commercialization.md](../commercialization.md#price-tests-owner-2026-11-09)).
