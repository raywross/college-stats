# Marketing Plan: Three Audiences, One Product, Everything Measured

> Status: **planned** (nothing built). Written 2026-11-09 from the owner's brief: "a key to making the business
> commercially successful will be advertising. We probably want to have a plan to advertise to parents, counselors, and
> students, probably as different campaigns. How do we approach this? How do we track success? How much will it cost? How
> do we implement? Ideally we'd drive the whole thing from the admin functions on the site." This is the plan; the other
> three specs in this folder are what gets built for it: [measurement.md](measurement.md) (attribution, PostHog in the
> console), [seo.md](seo.md) (search, driven from the console), and [console.md](console.md) (the Growth door: campaigns,
> links, pages, emails, spend). Part of [product](../README.md); the product being sold is in
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
   paid campaigns are small, seasonal, and killed or scaled by their measured cost per trial.
2. **Nothing we would not say on the privacy page.** No ad pixels, no Meta or Google tags, no conversion APIs that send
   hashed emails, no retargeting, no lookalike audiences built from our users, no ads aimed at anyone under 18
   ([telemetry.md](../telemetry.md#privacy); [measurement.md](measurement.md#what-we-do-not-do)). Attribution is a
   first-party campaign code and our own numbers. We accept that ad platforms optimize worse without their pixels.
3. **The data does the talking.** Every ad, post, and email leads with a number the site can cite: a college's admit
   rate for its pool, a trend study, a price gap. No "boost your chances" and no percentage chances, ever
   ([chances/README.md](../../chances/README.md)).
4. **The counselor is the channel, not the customer.** A counselor who runs a caseload on Quad brings dozens of
   families; the portal is free and the student's path is the ordinary one
   ([counselor-portal.md](../counselor-portal.md#the-channel)). We never pay counselors, show them who has not paid,
   or hand them referral links.
5. **Every campaign is measured end to end** from the first click to the paid year, with the same funnel for every
   audience, in the console, with no spreadsheet ([measurement.md](measurement.md)).
6. **One owner, part time.** The plan assumes one person and coding agents. Anything that needs a daily hand (bidding,
   posting, replying) is sized for an hour a day or dropped.

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
| Channels, paid | **Google Search**, exact and phrase match on high-intent queries: "{college} acceptance rate", "{college} chances", "is {college} a reach", "college list builder", "net price {college}", "ED vs EA"; landing on the college's own page with the advisor's card, not on a generic page. **Meta (Facebook and Instagram)**, interest targeting only (parents, college planning; no custom or lookalike audiences, no retargeting), static ads built from the data. **Podcast and newsletter sponsorships** for parents of teens (one or two tests at $300 to $1,000 each) |
| Channels, free | The trends studies as shareable posts; a monthly "what changed in the data" email a parent can subscribe to without an account; parent Facebook groups and Reddit (r/Parenting, state and school groups) only as a participant answering questions with cited pages, never as ads |
| Landing | `/for/parents` (the console's page, [console.md](console.md#pages)): the splash page's parent sections first (For parents, Never miss a date, Offers), the price, the trial button |
| Conversion | `trial_started` with `product` and `campaign`; until Stripe ships, `signup_completed` with `role_hint: guardian` |
| Test budget | $1,500 a month for three months, January to March 2027: $1,000 Search, $500 Meta; one sponsorship test in February |
| Stop or grow | Stop a channel above $20 per trial after two weeks of spend; double a channel under $12 per trial for a month, then re-read |

### Students: earn their attention, convert the household

Students under 16 cannot buy; those 16 and over may with a parent's permission ([advisor.md](../advisor.md#2-the-trial)).
A student campaign therefore ends in an account and a parent invited, and the household converts on the parent's side.
Paid ads to minors are out by principle 2, so this campaign is content and presence, not spend.

| | |
|---|---|
| Who | 10th to 12th graders doing their own research; they arrive from search on a college's name, from Reddit, and from short video |
| When | August to November (seniors), January to May (juniors), and the days after decisions (late March) |
| Message | *The numbers colleges publish about who they admit, with the source on every one.* Where you stand, no percentage games, the three things to do this season |
| Channels | **Search** (the college pages, the glossary, the trends: [seo.md](seo.md)). **Short video** from the data: one chart, one fact, 20 seconds (the trends studies are a year of material: shrinking colleges, where the students went, the price gap), posted to TikTok, Instagram Reels, and YouTube Shorts from one account, two a week, with the page linked. **Reddit** r/ApplyingToCollege and r/chanceme as a named, declared participant answering with cited pages, within the subreddits' rules; no ads. **School newspapers and counseling offices** through the counselor campaign |
| Landing | `/for/students`: the Where you stand strip, the season's three things, "Invite a parent" as the second button |
| Conversion | `signup_completed` with `role_hint: student`, then `household_invite_sent` (a new event, [measurement.md](measurement.md#new-events)) |
| Budget | $0 in ads; about $300 a quarter for video tooling and stock music; the owner's time, two posts a week |
| Stop or grow | Judged by organic student sign-ups and the share who invite a parent within 30 days; the video account is dropped after six months if it sends under 2% of student sign-ups |

### Counselors: the free portal, office by office

| | |
|---|---|
| Who | Independent educational consultants (about 2,000 IECA members, about 1,000 HECA, and many more unaffiliated), then high school counseling offices (ASCA's 40,000-plus members; a few counselors per public high school) |
| When | **May to August** (consultants plan the next cycle; offices are quiet), **September** (offices set up the year), and the two national conferences (IECA's spring and fall conferences, NACAC's September national conference) |
| Message | *See every student's plan in one place, free.* The caseload, asks, notes, the export; your families pay $20 a year for the advisor, you pay nothing, and nothing about money reaches you |
| Channels | **Direct email** to consultants from public directories, one at a time with the person's name and a sentence about their practice (an hour a day, 20 a day, from the owner's own mailbox, never a blast). **A 20-minute demo** on a standing weekly slot. **Membership** in IECA or HECA as an associate or affiliate where allowed, for the directory listing and the newsletter. **One conference table** in 2027 if the first fifty emails convert at 10% or better. **LinkedIn** posts from the data, aimed at counselors. **A counselor newsletter**, monthly: what changed in the data, with the Data Steward's own findings as the material |
| Landing | `/for/counselors`: the caseload in one frame, the free line, "Start an organization" (the portal's `/org`), the privacy rules a school will ask about, a demo link |
| Conversion | `org_created {kind}`, then `org_student_joined` (both exist); the console counts organizations with five or more students as a working office |
| Budget | $0 to $500 a month: memberships (IECA associate membership is in the low hundreds a year), a demo tool, a conference table in 2027 at $2,000 to $5,000 if the email test earns it |
| Stop or grow | Fifty emails a month; grow when one email in ten becomes an organization with students; the conference waits for that |

## Calendar

| Month | Build ([console.md](console.md#build-plan)) | Parents | Students | Counselors |
|---|---|---|---|---|
| Nov 2026 | Wave 1: sitemap, robots, metadata, Open Graph, structured data; campaign links and the cookie; the Growth overview | | Video account opens; two posts a week from the trends | First 50 consultant emails; the demo slot |
| Dec 2026 | Wave 2: Search Console in the console, SEO templates, the Steward's SEO audit, landing pages | Parent newsletter opens (no account needed) | Decision-season posts | Newsletter issue 1 |
| Jan 2027 | Stripe and the trial ship ([commercialization.md](../commercialization.md)); wave 3: lifecycle emails, spend and cost per trial | **Search and Meta tests start**, $1,500 a month | Junior-season posts | 50 emails; offices after winter break |
| Feb–Mar 2027 | Read the numbers weekly; kill or double | Sponsorship test; offers-season creative ready | | IECA spring conference as an attendee |
| Apr–May 2027 | | Offers side by side campaign, small | Decision posts | Consultants plan the next cycle: the big push |
| Jun–Aug 2027 | Review the cycle; set the 2027–28 budget | Quiet | Quiet | Emails and demos continue; conference table decision for NACAC in September |

## Budget

Six months, November 2026 to April 2027, planning figures:

| Item | Monthly | Six months | Notes |
|---|---|---|---|
| Google Search ads (parents, Jan–Mar) | $1,000 | $3,000 | Exact and phrase match; no display network; no remarketing |
| Meta ads (parents, Jan–Mar) | $500 | $1,500 | Interest targeting only; no pixel, so judged by our numbers |
| Sponsorships (one or two tests) | | $1,000 | A parent newsletter or podcast, February |
| Counselor memberships and tools | $100 | $600 | IECA or HECA associate membership, a demo tool |
| Video and creative tooling | $100 | $600 | Editing app, music, a template set |
| Conference travel (attendee, spring) | | $1,500 | One person, one conference |
| PostHog | $0 | $0 | The free tier is 1 million events a month; the site is far under it. The Query API is included |
| Google Search Console, IndexNow, Bing Webmaster Tools | $0 | $0 | |
| Resend | $20 | $120 | 50,000 emails a month on the first paid tier; lifecycle and newsletter mail |
| **Total** | | **about $8,300** | About $1,400 a month across the six months, $2,300 in the three ad months |

Not in the table: the owner's time (an hour a day for counselor email and posting), and the engineering, which is the
build plan in [console.md](console.md#build-plan) and is done by the owner with coding agents at the usual cost of a
session. Everything in the table stops in a day if the numbers say so. The reserve for a channel that works is another
$5,000 in spring 2027, released only by a measured cost per trial under $12.

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
| Cost per trial started, by paid campaign | under $12 to grow, over $20 to stop | The only number that lets ads scale |
| Trial to paid | 40% or better | The product's job; below 30%, fix the trial before spending more |
| Working offices (organizations with five or more students) | 25 | The counselor channel's unit |
| Students who invite a parent within 30 days | 25% | Whether the student campaign converts households |
| Twelve-month renewal (first readable in 2028) | 70% | The lifetime assumption behind the ceiling |

Read every Monday; a short note in the console's log each week with the decision taken (kill, hold, double), so the
history of the plan is on the site with everything else.

## What must exist first

1. **Before any spend:** wave 1 of [console.md](console.md#build-plan): the campaign cookie and `acquired_via`, the
   `/go/{code}` links, the funnel events, and the Growth overview reading PostHog. Spending before this is spending
   blind.
2. **Before paid parent campaigns:** Stripe, the trial, and `/pricing` ([commercialization.md](../commercialization.md));
   the page at `/for/parents` and the lifecycle emails; the legal pages (terms, refund, privacy extended with the
   campaign cookie).
3. **Before conference spending:** fifty counselor emails and their measured outcome.
4. **Before anything aimed at students:** the design rules in principle 2, and the "Invite a parent" step on the student
   landing page.

## Owner decisions

1. **Pixels and conversion APIs.** The plan says none, and judges ads by our own numbers. Google's and Meta's
   optimization will be worse for it (they cannot see conversions). Confirm, or allow server-side conversion events with
   hashed emails for adults only (then the privacy page says so).
2. **AI crawlers** (GPTBot, ClaudeBot, PerplexityBot and the rest) in `robots.txt`: allow, so answers cite Quad, or
   block ([seo.md](seo.md#crawlers)). The plan's default is allow for the public data pages and block for everything
   signed in.
3. **The ad ceiling.** $1,500 a month for three months as the test, $5,000 in reserve. Confirm or change.
4. **Memberships and the conference.** IECA or HECA associate membership in 2027, and whether a conference table is on
   the table at all.
5. **A "counselor recommended" code** for a first-year discount ([commercialization.md](../commercialization.md#open-questions),
   question 4): the campaign links can carry a Stripe promotion code the day the owner wants one; nothing here needs it.
6. **The fifth door.** Growth as its own door in the console and a fifth tab on a phone, or under More
   ([console.md](console.md#placement)).
