# Commercialization: The Advisor, $20 a Year per Student, Counselors Free

> Status: **billing built 2026-11-14** on `feature/billing` (see [As built](#as-built-2026-11-14) and
> [Setup (owner)](#setup-owner)): Stripe Checkout, the webhook, the `subscriptions` table, the entitlement map behind
> `allowed()`, the pricing page, the account row, the trial's email, the nightly reconcile, and the `advisor.price_live_at`
> switch. Nothing is gated or sold until the owner connects a Stripe account and turns the switch on; the legal setup
> below is still the owner's. **Rewritten** 2026-10-26 after the roadmap review, then **redrawn the same day on the
> owner's decision**: "the commercialization opportunity is really all around the planner. We should charge $20 a year
> for the 'virtual advisor' for each kid and maybe have a discount where it's $30 for a family. Then for counselors we
> should let them use the site for free to help them manage and collect data from their students. The students will
> pay, the advisors will get the site for free." That replaces the Free / Plus / Pro tiers of the 2026-10-02 strategy
> document ([ideas/](ideas/quad_commercialization_strategy.md)) and the per-seat organization plans. The entitlement
> hook exists: every planner write asks `allowed(user, capability)` in `lib/entitlements.ts`, which answers yes to
> everything today. After [launch-database.md](../launch-database.md) (the production project) and the legal setup
> below. The owner's further decisions the same day, specified in [advisor.md](advisor.md): a **14-day trial with the
> card collected up front** ("then actively cancel or the charge hits"), **annual only**, the plan **renamed** as a play
> on a virtual advisor, and a **splash page** for a visitor who opens the tab without an account. Part of [product](README.md).

## The model in one paragraph
The public site is free, and so is an account with the student's record and Quad's estimate on every college page.
**The plan is the product**: the list sorted by level with the shape of a good list, the season's three things to do
now with a guide for each, the calendar with its feeds and texts, offers side by side, and the alerts that go with
them. Its name is **Quad Advisor** (owner, 2026-10-26; [advisor.md](advisor.md#1-the-name)): the tab says **Advisor**, a
sentence says "your advisor", the route is `/advisor`; one constant, `ADVISOR_LABEL`, so the word is a one-line change,
as `RECORD_LABEL` is. It costs **$20 a year for one student** or
**$30 a year for a family**, which covers every student in the guardian's households. **Counselors pay nothing**: an
organization account ([counselor-portal.md](counselor-portal.md)) is free, so a counseling office or an independent
consultant can see their students' plans and collect their school's data, and the students' families pay the $20.

## What stays free
Quad's reputation is open, cited data with no lead generation. Everything derived from federal data, every college's
profile, Explore (every filter, the four views, the map, the For you levels), Compare, the Data page, the glossary, the
trends, the high school pages, and the roadmap stay free for everyone, signed out. With a free account: the household,
the student's record, Quad's estimate and its "what went into it" on every college page and in Compare, following
colleges and the update emails, each college's event calendar, a personal API key with its limits, and the assistants'
keyless door. Paid is **the plan**, never access to a number. No ads, no selling leads to colleges, no sponsored
placements, no featured listings, no advisor commissions: the three models the 2026-10-03 research found elsewhere
([ideas/README.md](../ideas/README.md), proposal 8), each named on the pricing page as something the money never buys.

## Prices
| | Free | Advisor, one student | Advisor, family |
|---|---|---|---|
| For | Everyone; a family looking; a counselor's office | One student's plan through senior year | A guardian with more than one student |
| Price | $0 | **$20 a year** | **$30 a year** |
| Covers | | one student, whoever pays | every student in the guardian's active households, now and added later |
| Bought by | | a guardian, or the student at 16 or older; a younger student asks a parent ([advisor.md](advisor.md#2-the-trial)) | a guardian |
| Trial | | 14 days, card up front | 14 days, card up front |

**Annual only** (owner, 2026-10-26): a plan runs on the school year's rhythm, and a monthly price invites a family to
subscribe in December and leave in May. At $20, Stripe's $0.30 + 2.9% is about 4.4% of revenue, so no annual-versus-monthly steering is needed on
the pricing page. Stripe Tax handles sales tax where digital goods are taxed. Renewal is yearly with a reminder email
two weeks before; a plan that lapses keeps its data and turns read-only ([below](#when-a-plan-lapses)).

### Price tests (owner, 2026-11-09)
The list price is $20 and $30, and the first campaigns run at it to gather data; a **price test** runs beside them
from the first push, and the owner adapts from what it shows. The marketing plan's arithmetic
([marketing/plan.md](marketing/plan.md#the-economics)) says a $20 plan can afford about $12 per trial, which paid
search rarely reaches, while $49 and $79 would afford about $20; the test measures the conversion curve instead of
assuming it.

- **A price variant is a property of a campaign** ([marketing/console.md](marketing/console.md#campaigns)): the
  campaign's row names the student and family prices its visitors see (`price_variant`, defaulting to the list
  price). The campaign cookie ([marketing/measurement.md](marketing/measurement.md#the-campaign-cookie)) already
  carries the campaign code for 30 days, so a visitor sees one price consistently from the ad to the pricing page to
  the checkout; a visitor with no campaign sees the list price. Each variant is a Stripe Price on the same two
  Products, so the checkout, webhooks, and entitlements are unchanged; `lib/entitlements.ts` exposes `priceFor(variant)`
  and the pricing page, the splash page, and the upgrade sheet render from it instead of a constant.
- **What the console shows:** trials started, trials converted, and the first-year cash per trial by price variant
  on the Growth overview, so two cohorts of equal size can be compared after a season.
- **Rules:** at most three variants live at once; a variant is never below the list price (a discount is a promotion
  code, question 4, not a variant); the price a person started a trial at is the price they renew at, stored on the
  subscription, so a test never raises an existing family's bill; nothing about a person decides the price they see,
  only the link they arrived by; and the pricing page states that prices may differ by offer and that the price shown
  is the one charged. Same-price-for-same-offer keeps this on the right side of the state price-discrimination
  rules, which concern protected characteristics, not referral source.
- **First test** (January to March 2027): the list price for every organic visitor and for half the paid campaigns'
  links; $49 and $79 for the other half, split by link within each campaign so the audiences match. Decided from the
  Growth overview in April 2027 with the rest of the push ([marketing/plan.md](marketing/plan.md#calendar)).

## Feature map
Each feature's own spec says what's free; this table is the single list the entitlement code reads from
(`lib/entitlements.ts`, one typed object, tested). The planner's eight capability names
([../planner/model.md](../planner/model.md#entitlements)) are the rows every planner write already checks; the rest
are new names the same hook takes.

| Feature | Capability | Free | Advisor |
|---|---|---|---|
| Profiles, Explore (every filter, the four views, the map, For you levels), Compare, Data, glossary, trends, high schools, roadmap | — | ✓ | ✓ |
| Account, household, the student's record ([../planner/record/README.md](../planner/record/README.md)) | — | ✓ | ✓ |
| Quad's estimate on a college's page and in Compare, with what went into it | — | ✓ | ✓ |
| Follow colleges and the update emails ([follow-colleges.md](follow-colleges.md)) | — | ✓ | ✓ |
| A college's event calendar on its page and `/me/visits` ([visit-events.md](visit-events.md)) | `visits.view` | ✓ | ✓ |
| Cost by income at the household's income on a college's page ([cost-by-income.md](cost-by-income.md)) | — | ✓ | ✓ |
| The family's price: SAI and Pell ([net-price-estimator.md](net-price-estimator.md)) | — | ✓ | ✓ |
| Data API: a personal key, 5,000 requests a day ([data-api.md](data-api.md)) | `api.key` | ✓ | ✓ |
| **The plan**: the list with levels and the shape, Now with its three cards and every guide ([../planner/v3/README.md](../planner/v3/README.md)) | `planner.tab` | the 14-day trial ([advisor.md](advisor.md#2-the-trial)) | ✓ |
| Early rounds: the ED opportunity pills and the ED sheet | `planner.rounds` | | ✓ |
| Visit log and the Show interest guide's tracking | `planner.actions.visits` | | ✓ |
| The Calendar tab, the feed, print ([../planner/redesign/calendar.md](../planner/redesign/calendar.md)) | `planner.calendar` | | ✓ |
| Reminder emails ("your week") | `planner.reminders` | | ✓ |
| Texts the evening before a hard deadline | `planner.texts` | | ✓ |
| A parent's nudge | `planner.parents.nudge` | | ✓ |
| Offers side by side, the choice ([../planner/offers.md](../planner/offers.md)); the letter reader once built | `planner.offers` | | ✓ |
| Nightly visit alert emails within a radius of home | `visits.alerts` | | ✓ |
| The family's price per college on plan rows, the "can pay" line, the four-year total | `cost.family` | | ✓ |
| Family PDF dossier (the plan, levels, prices, offers, deadlines) | `plan.dossier` | | ✓ |
| Counselor organization: the caseload, asks, notes, the export, and later the scattergram uploads ([counselor-portal.md](counselor-portal.md)) | none: the portal never asks `allowed()` | ✓ (free) | — |

**The trial, not a taste** (owner, 2026-10-26). There is no free slice of the plan: a visitor who opens the Advisor tab
without an account sees the splash page ([advisor.md](advisor.md#3-the-page-advisor-signed-out)), and the way in is a
**14-day free trial with a card on file**, after which the yearly charge hits unless the family cancels. One trial per
student, started by a guardian or a student 18 or older; the rules are in advisor.md. A lapsed or cancelled plan turns
read-only ([below](#when-a-plan-lapses)), so nothing a family entered is lost.

Rules the map follows:
- **Nothing public moves behind a price**, and neither does the estimate: Quad's answer to "where do I stand" stays on
  every college page for everyone with an account, because hiding it would push a family to a site that prints a
  percentage. What is paid is the plan built on it.
- **The counselor pays nothing, buys nothing for students, and sells nothing.** Counselors see and help; families buy
  the advisor for their own student. A counselor's caseload page shows each student's advisor status as a quiet chip
  ("Preview" until billing ships), so the office knows who can open the guides it is talking about, and nothing more:
  no referral links, no "remind them to subscribe", no commission ([counselor-portal.md](counselor-portal.md#the-channel)).
- Gating UX: a gated block renders its frame with a blurred sample and an "Advisor" chip and a one-line reason;
  nothing is hidden, nothing nags. One upgrade sheet, from any chip, with the two prices. `allowed()` keeps returning a
  boolean; a second function returns the limit (`limitFor(user, capability)`) for the capped rows.

## When a plan lapses
The plan turns read-only: the list, its levels, the calendar, and the offers stay visible; the guides, the writes, the
texts, and the alerts stop. Nothing is deleted. Renewing restores everything. A student who turns 18 and leaves the
household keeps their own plan's data under their own account, as the accounts spec already provides.

## Billing
- **Stripe Checkout** (hosted) for payment; **Stripe Billing** for the yearly subscriptions; **Customer Portal** for
  cancel, card, and invoices. No card data ever touches the app.
- Products: `advisor_student_yearly` ($20), `advisor_family_yearly` ($30). Prices live in Stripe; the app reads a price
  id per product from env. Upgrading a student plan to a family plan is a Stripe plan change with proration.
- **Webhooks** (`/api/stripe/webhook`, signature-verified) write `subscriptions (user_id, product, status,
  current_period_end, stripe_customer_id, stripe_subscription_id, covers: student_id | household)`; `allowed()` reads
  that table, not Stripe, at request time. A nightly job reconciles against Stripe.
- `entitlements(user)` (server-only) returns the plan and limits. A family plan applies to every student in the
  guardian's active households ([accounts.md](accounts.md#roles-and-households)), including a student added later; a
  student plan applies to that student alone, whoever views the plan (a guardian viewing a paid student's plan sees it
  all, the owner's rule that a parent sees the student's view word for word). Server Actions and pages enforce it; the
  UI only reflects it.
- **The trial** is the refund policy: 14 days free with the card on file, cancel before the end and nothing is charged
  ([advisor.md](advisor.md#2-the-trial)). After a charge, a refund within 14 days on request if the plan has fewer than
  three colleges and no guide completed. Stated on the pricing page.
- **Minors paying:** students 16 and older may pay with their own card (owner, 2026-10-26); under-18s can't form
  contracts in most states, so the Terms say a purchase by a minor is made with a guardian's permission and the checkout
  asks the student to confirm it. Under 16, the trial starts from a parent's account ([advisor.md](advisor.md#2-the-trial)). **Apple's in-app purchase rules** apply the day
  the iPhone app ships ([../iphone-app/app.md](../iphone-app/app.md#in-app-purchase)): the app either sells the advisor
  through StoreKit with the same two products or sells nothing and the site sells; decided with the app.
- **Early accounts** ([open-doors.md](open-doors.md)): an account created before the `advisor.price_live_at` setting
  (`isEarly()`) keeps the Advisor free through 2027-08-31 with no card and no trial, then renews at the list price in
  force after the ordinary renewal notice; early accounts are reported apart and left out of the price test.
- Telemetry events `trial_started`, `trial_reminder_sent`, `trial_converted`, `trial_cancelled`, and
  `subscription_cancelled` from the server ([telemetry.md](telemetry.md#event-registry)), with `product` and never an
  amount beyond the two list prices.

## Pricing page (`/pricing`)
The splash page at `/advisor` ([advisor.md](advisor.md#3-the-page-advisor-signed-out)) is where the selling happens;
`/pricing` is the plain reference it links to. Two cards, one student and one family, each with the price, "a year", and
"14 days free"; one sentence on what the advisor is and that everything else on the site is free; the feature map as a comparison table (Free · Advisor); a line for counselors
("Counselors and consultants use Quad free: see your students' plans and bring your school's data"); FAQ (what stays
free, refunds, minors, lapsing, cancel any time); and a section on what the money never buys: no ads, no featured
listings, no leads sold to colleges, no advisor commissions. Linked from the footer, the upgrade sheet, and the
counselor portal's sign-up; not in the main nav.

## Counselors
[counselor-portal.md](counselor-portal.md) is a free product under this model (rewritten 2026-11-01 around the
channel): the organization, the caseload over students' advisors, asks, notes, the export, and later the scattergram
uploads cost nothing, for independent consultants and school offices alike, with no agreement to sign before the
caseload works (the data processing agreement belongs to the scattergram phase, where a school's own records arrive).
The office is the acquisition channel: a counselor who runs their caseload on Quad has families who buy the advisor,
and the student's path is the ordinary one (the same account, splash page, and trial). The 2026-10-03 proposals that
counselors pay per seat and that counselor-invited students are free ([ideas/README.md](../ideas/README.md),
proposals 8 and 9) are superseded by the owner's decision. The Data API's paid tier is dropped from this spec: a
personal key stays free with its limits, and bulk downloads wait for a reason to exist.

## Legal and operational before launch
Terms of service, privacy policy (the built `/privacy` page, extended: telemetry, minors, data export and deletion,
texts, payments), refund policy, a business entity and bank account for Stripe, sales-tax registration where Stripe Tax
says it's needed, the support and billing addresses (`support@` and `billing@usequad.app`, set up 2026-10-28;
`lib/contacts.ts`), and a status page. The production database ([launch-database.md](../launch-database.md))
is a prerequisite, and the estimate's method moves private at launch ([../chances/estimate.md](../chances/estimate.md)).

## Files (planned)
- `lib/entitlements.ts` (the map, `allowed()`, `limitFor()`, `entitlements()`; today's eight capabilities keep their
  names; `ADVISOR_LABEL`), `app/pricing/`, `app/api/stripe/webhook/route.ts`, `lib/stripe.ts`, migration
  `…_subscriptions.sql`, `tests/entitlements.test.mts` (every capability a spec names appears in the map; the free
  column matches what is live except the plan's cap; a family plan covers a student added later; a student plan does
  not extend to a sibling; a lapsed plan is read-only, never emptied).
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ADVISOR_STUDENT`, `STRIPE_PRICE_ADVISOR_FAMILY`.

## As built (2026-11-14)
Built on `feature/billing` together with [advisor.md](advisor.md#as-built-2026-11-14-part-3-the-trial) part 3 (the
trial's own pages and words are written up there). The rule that governs everything: **nothing changes until the
switch is on.** `allowed()` answers yes to every capability, the splash page keeps its preview words, the Advisor tab
shows no line about money, and the caseload chip stays "Preview" until Stripe's four variables are set on the
deployment *and* `advisor.price_live_at` is set from `/admin/settings`. Clearing the setting makes the advisor free for
everyone again. So the code merges and sits inert until the owner's setup below.

**The rules, pure** (`lib/billing.ts`, tested in `tests/billing.test.mts`): the two products and list prices
(`LIST_PRICES`, `priceFor(product, variant)` with only the `list` variant until the Growth console issues campaign
codes), the trial's constants (14 days; self-pay at 16, permission confirmed under 18), `isEarly()` and the early
period through 2027-08-31, what a set of subscription rows means for one student (`statusFrom`: a paid year beats a
trial beats lapsed; `past_due` keeps the advisor whole through Stripe's retries), `entitlementFrom()` (not live →
whole; trial or year → whole; early → whole; else read-only), the **feature map** as one typed list (`FEATURE_MAP`:
each capability, whether free, whether a lapsed plan still reads it) and `allowedUnder(entitlement, capability, mode)`,
the telemetry events a change in a row means (`billingEvents(prev, next)`), and the sentences.

**The map's rows.** The `Capability` type (`lib/planner/types.ts`) gained `visits.view`, `visits.alerts`, `api.key`,
`cost.family`, and `plan.dossier` beside the planner's eight and the essays' two, so the whole table above is one
list the code reads. Free: `visits.view` and `api.key`. Read when lapsed: the tab, rounds, calendar, offers, essays,
and the family's price; never the visit log, the reminders, the texts, the nudge, the reader, the alerts, or the
dossier. The last three rows (`visits.alerts`, `cost.family`, `plan.dossier`) are in the map ahead of the code that
will ask for them.

**The hook** (`lib/entitlements.ts`, importable under plain node; the server modules load inside the functions):
`allowed(user, capability, { studentId?, mode? })`. A free row is yes at once; billing unconfigured or the price not
live is yes with no read (the setting rides the planner's one `app_settings` read, `PLANNER_SETTING_KEYS`); then one
`advisor_access(students[])` per request and student. With a student named, that student's entitlement decides;
without one (the planner's `ready()` runs before an action knows its list), the viewer's own record or any child they
reach as a guardian being whole is enough, and a viewer with no students is allowed. That coarse rule means a parent
with one covered child and one not can write on both plans; the per-student gate on the Advisor tab (the banner, the
read-only words) is exact. `entitlementFor(studentId)`, `advisorStatusFor(ids)` (the caseload chip: Advisor / Trial /
Not yet / Lapsed once live, an early account reading "Advisor"), `advisorBillingFor(studentId, viewer)` (the tab's and
the account page's facts), and `entitledStudents(client, ids, capability)` for the cron jobs (everyone while not
live; a failed read keeps everyone and logs). `planFor()` reads with `mode: "read"`, so a lapsed plan loads.

**The table** (`supabase/migrations/20261114120000_subscriptions.sql`, to apply to dev, then prod): `subscriptions`
(one row per Stripe subscription: `user_id`, `product`, Stripe's `status` word, the customer and subscription ids,
`price_id`, `price_variant`, `trial_end`, `current_period_end`, `cancel_at_period_end`, `canceled_at`,
`covers_student_id` for a student plan, `covered_student_ids` for one-trial-per-student, `reminder_sent_at`),
`billing_customers` (the Stripe customer per account), `stripe_events` (each webhook id handled once).
Written only by the server with the secret key; a person reads their own rows, an admin every row.
`subscriptions_covering(student)` is the coverage rule (a student plan naming them, or a family plan held by a guardian
sharing an active household with them or managing their record), and `advisor_access(students[])` the one read.
`admin_set_setting()` learns `advisor.price_live_at` (an ISO timestamp or null).

**Stripe** (`lib/stripe.ts`, server-only, the `stripe` SDK): `billingConfigured()`, the price id per product from
env, `ensureCustomer()`, `createTrialCheckout()` (as advisor.md specifies; no trial for a student covered before;
`allow_promotion_codes` for the counselor code of question 4 whenever the owner wants one; Stripe Tax when
`STRIPE_AUTOMATIC_TAX=1`), `createPortalSession()`, `setCancelAtPeriodEnd()`, `webhookEvent()` (signature over the raw
body), and `syncSubscription()`, the one mapping from a Stripe subscription to a row (`rowFromStripe`: metadata first,
the customer's account and the price id as fallbacks; `current_period_end` from the item, where Stripe's current API
keeps it). `lib/billing-server.ts` adds `applySubscription()` (store, then send the change's events), the family
plan's students at its start, the reminder's facts and send, and `siteOrigin()` for links from a webhook.

**Routes and pages.** `POST /api/stripe/webhook` (`checkout.session.completed`, the three `customer.subscription.*`
changes, `trial_will_end`; every other type acknowledged; a failed handler removes its event row so Stripe's retry
isn't taken for a duplicate). `/advisor/start` and its return, `/account`'s row with Cancel / Keep and the portal,
`/pricing` (two cards, what stays free, the map as a Free · Advisor table, counselors, questions, what the money never
buys; linked from the footer), the Advisor tab's line. `/api/cron/subscriptions` at 13:45 UTC (`lib/jobs/registry.ts`,
`vercel.json`): every live row refetched from Stripe through the same path, a missed trial reminder sent. The Your-week
and day-before jobs skip students whose advisor is read-only.

**Admin.** `/admin/settings` "Advisor price": live since when, whether Stripe is configured on this deployment, the
subscriptions by product and status, and one button that sets the moment to now or clears it (logged as `setting.set`).

**Not built, by design or for later:** the Growth console's price variants beyond `list` (the hook and the checkout
take a variant; the campaign cookie and the Stripe Prices per variant come with the console); the yearly renewal
reminder two weeks before (Stripe's own renewal emails can carry it until then); upgrading a student plan to a family
plan with proration (a family buys the family plan; a student plan's year runs out); the prefilled parent invitation
from "Ask a parent" (the household's ordinary invitation does the job); the counselor-recommended promotion code
(question 4, cheap to add in Stripe when decided); refunds (by hand from the Stripe dashboard, under the stated rule);
Terms of service, the privacy page's payments paragraph, and the business and tax setup (the owner's list below).

## Setup (owner)
In order; nothing is sold until step 7, and nothing on the site changes until then either.

1. **Create the Stripe account** at <https://dashboard.stripe.com/register>: the business is the entity behind Quad
   (an LLC or a sole proprietorship; Stripe asks for its legal name, address, EIN or SSN, a bank account for payouts,
   and a statement descriptor, which is what appears on a card statement: "QUAD ADVISOR" fits). Stay in **test mode**
   (the toggle at the top of the dashboard) until step 7.
2. **Make the two products** (Product catalog → Add product), each with one recurring price, **yearly**, USD:
   *Quad Advisor, one student*: $20.00 a year; *Quad Advisor, family*: $30.00 a year. Copy each price's id
   (`price_…`, shown on the product page under Pricing).
3. **Make the webhook** (Developers → Webhooks → Add destination): endpoint
   `https://usequad.app/api/stripe/webhook`, events `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`. Copy its
   signing secret (`whsec_…`). For the preview deployment, a second destination at
   `https://preview.usequad.app/api/stripe/webhook` with the same events and its own secret.
4. **Turn on the Customer Portal** (Settings → Billing → Customer portal): allow customers to cancel subscriptions
   (at the end of the period), update payment methods, and view invoices; no plan switching needed. Under Settings →
   Billing → Subscriptions and emails, turn on the emails for upcoming renewals and failed payments, and set Smart
   Retries so a failed charge is retried before the subscription is marked unpaid.
5. **Put the four values in the environment.** Add to `.env.local` (dev, test-mode values) and to Vercel:
   `STRIPE_SECRET_KEY` (Developers → API keys → Secret key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ADVISOR_STUDENT`,
   `STRIPE_PRICE_ADVISOR_FAMILY`. For Vercel: `npm run vercel-env -- STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
   STRIPE_PRICE_ADVISOR_STUDENT STRIPE_PRICE_ADVISOR_FAMILY --target preview` with the test values, then
   `--target production` with the live ones at step 7, and `--redeploy`. Optional: `SITE_URL=https://usequad.app`
   (links in the trial email).
6. **Apply the migration** `20261114120000_subscriptions.sql` in the Supabase SQL Editor (dev, then prod), and
   **test the whole path in test mode** on the preview deployment: turn the price on at `/admin/settings`, start a
   trial as a test student with Stripe's test card `4242 4242 4242 4242` (any future expiry, any CVC), see the line on
   the Advisor tab and the row on `/account`, cancel and keep, and check the webhook's deliveries in the dashboard
   (every event 200). Stripe's test clocks (Developers → Test clocks) advance a trial to its end to see the reminder
   and the charge without waiting fourteen days. Then turn the price back off.
7. **Go live**: activate the account (Stripe reviews the business details), switch the dashboard to live mode, and
   repeat steps 2, 3, and 5 with live values for Production. Register with **Stripe Tax** (Settings → Tax) if the
   business needs to collect sales tax on digital goods where it has nexus, then set `STRIPE_AUTOMATIC_TAX=1`. Put the
   Terms of service, the refund rule, and the payments paragraph on the privacy page live (the legal list above). Then
   turn the price on at `/admin/settings`: from that moment new accounts start the trial, and every account made before
   it keeps the advisor free through 2027-08-31.

## Open questions
1. ~~The taste~~ Decided 2026-10-26: a 14-day trial with the card up front ([advisor.md](advisor.md)).
2. ~~The name on the site~~ Decided 2026-10-26: Quad Advisor ([advisor.md](advisor.md#1-the-name)).
3. Should an organization be able to buy the advisor for its students (a block of plans at the family price)? Not in
   the first build; the owner's model is that families pay. Revisit if offices ask.
4. A "counselor recommended" code for a first-year discount is cheap in Stripe (promotion codes) and fits the channel;
   the owner decides whether the first year is ever less than $20.
5. ~~Is $20 the right price?~~ Decided 2026-11-09: launch at $20 and $30 and run the price test above ($49 and $79 on
   half the paid links) through the first push; the owner reads the curve in April 2027 and adapts. The marketing
   plan's recommendation on the table is $49 and $79 with a counselor-recommended code toward $35
   ([marketing/plan.md](marketing/plan.md#owner-decisions)).
