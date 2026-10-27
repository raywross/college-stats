# Commercialization: The Advisor, $20 a Year per Student, Counselors Free

> Status: **planned** (not built); **rewritten** 2026-10-26 after the roadmap review, then **redrawn the same day on the
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
them. The owner's working name for it is the **virtual advisor**; the name on the site, the tab, and the route are decided
in [advisor.md](advisor.md#1-the-name) (recommended: **Quad Advisor**, the tab **Advisor**, "your advisor" in a
sentence; one constant, `ADVISOR_LABEL`, so the word is a one-line change, as `RECORD_LABEL` is). It costs **$20 a year for one student** or
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
| Bought by | | a guardian, or the student at 18; a younger student asks a parent ([advisor.md](advisor.md#2-the-trial)) | a guardian |
| Trial | | 14 days, card up front | 14 days, card up front |

**Annual only** (owner, 2026-10-26): a plan runs on the school year's rhythm, and a monthly price invites a family to
subscribe in December and leave in May. At $20, Stripe's $0.30 + 2.9% is about 4.4% of revenue, so no annual-versus-monthly steering is needed on
the pricing page. Stripe Tax handles sales tax where digital goods are taxed. Renewal is yearly with a reminder email
two weeks before; a plan that lapses keeps its data and turns read-only ([below](#when-a-plan-lapses)).

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
| Counselor organization: caseload, reports, scattergram uploads ([counselor-portal.md](counselor-portal.md)) | `org.*` | ✓ (free) | — |

**The trial, not a taste** (owner, 2026-10-26). There is no free slice of the plan: a visitor who opens the Advisor tab
without an account sees the splash page ([advisor.md](advisor.md#3-the-page-advisor-signed-out)), and the way in is a
**14-day free trial with a card on file**, after which the yearly charge hits unless the family cancels. One trial per
student, started by a guardian or a student 18 or older; the rules are in advisor.md. A lapsed or cancelled plan turns
read-only ([below](#when-a-plan-lapses)), so nothing a family entered is lost.

Rules the map follows:
- **Nothing public moves behind a price**, and neither does the estimate: Quad's answer to "where do I stand" stays on
  every college page for everyone with an account, because hiding it would push a family to a site that prints a
  percentage. What is paid is the plan built on it.
- **The counselor pays nothing and buys nothing for students.** Counselors see and help; families buy the advisor for
  their own student. A counselor's caseload page shows which students have the advisor, so the office knows who can
  see the guides it is talking about. (Whether an organization may buy a block of student plans is an open question.)
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
- **Minors paying:** under-18s can't form contracts in most states; the Terms say a purchase by a minor is made with a
  guardian's permission, and the checkout asks the student to confirm it. **Apple's in-app purchase rules** apply the day
  the iPhone app ships ([../iphone-app/app.md](../iphone-app/app.md#in-app-purchase)): the app either sells the advisor
  through StoreKit with the same two products or sells nothing and the site sells; decided with the app.
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
[counselor-portal.md](counselor-portal.md) is a free product under this model: the organization account, the caseload
dashboard over students' plans, the reports, and the scattergram uploads cost nothing, for independent consultants and
school offices alike (school offices still sign the data processing agreement). The office is the acquisition
channel: a counselor who runs their caseload on Quad has families who buy the advisor. The 2026-10-03 proposals that
counselors pay per seat and that counselor-invited students are free ([ideas/README.md](../ideas/README.md),
proposals 8 and 9) are superseded by the owner's decision. The Data API's paid tier is dropped from this spec: a
personal key stays free with its limits, and bulk downloads wait for a reason to exist.

## Legal and operational before launch
Terms of service, privacy policy (the built `/privacy` page, extended: telemetry, minors, data export and deletion,
texts, payments), refund policy, a business entity and bank account for Stripe, sales-tax registration where Stripe Tax
says it's needed, a support email, and a status page. The production database ([launch-database.md](../launch-database.md))
is a prerequisite, and the estimate's method moves private at launch ([../chances/estimate.md](../chances/estimate.md)).

## Files (planned)
- `lib/entitlements.ts` (the map, `allowed()`, `limitFor()`, `entitlements()`; today's eight capabilities keep their
  names; `ADVISOR_LABEL`), `app/pricing/`, `app/api/stripe/webhook/route.ts`, `lib/stripe.ts`, migration
  `…_subscriptions.sql`, `tests/entitlements.test.mts` (every capability a spec names appears in the map; the free
  column matches what is live except the plan's cap; a family plan covers a student added later; a student plan does
  not extend to a sibling; a lapsed plan is read-only, never emptied).
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ADVISOR_STUDENT`, `STRIPE_PRICE_ADVISOR_FAMILY`.

## Open questions
1. ~~The taste~~ Decided 2026-10-26: a 14-day trial with the card up front ([advisor.md](advisor.md)).
2. **The name on the site**: the owner picks from [advisor.md](advisor.md#1-the-name) (recommended: Advisor).
3. Should an organization be able to buy the advisor for its students (a block of plans at the family price)? Not in
   the first build; the owner's model is that families pay. Revisit if offices ask.
4. A "counselor recommended" code for a first-year discount is cheap in Stripe (promotion codes) and fits the channel;
   the owner decides whether the first year is ever less than $20.
