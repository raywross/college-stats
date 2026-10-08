# Commercialization: Free, Plus, and Pro

> Status: **planned** (not built). After [accounts.md](accounts.md) and [saved-lists.md](saved-lists.md) (the first
> things worth paying for). Source: the commercialization strategy in [ideas/](ideas/quad_commercialization_strategy.md),
> adjusted below. Part of [product](README.md).

## What stays free
Quad's reputation is open, cited data with no lead generation. Everything derived from federal data, and every
college's profile, Explore, Compare (4 colleges), the Data page, the glossary, and the roadmap stay free for
everyone, signed out. Paid tiers sell **memory, personalization, and decision tools**, never access to a public
number. No ads, no selling leads to colleges, no sponsored placements; the strategy document's "ad-free" bullet is
moot because there are no ads to remove.

## Tiers
| | Free | Plus | Pro |
|---|---|---|---|
| For | Everyone; underclassmen; casual searchers | A student building and running a list | A family in decision season; a guardian with several students |
| Price | $0 | **$1.99/month or $15.99/year** | **$49 one-time season pass (12 months)** or $9.99/month |
| Covers | | one student | the guardian's households (all their students), or one student |

Pricing follows the strategy document. Notes from research (2026-10-02): at $1.99, Stripe's $0.30 + 2.9% is about
18% of revenue (plus 0.7% for Stripe Billing), so the **annual plan is the default** on the pricing page, with
monthly shown second. Stripe Tax handles sales tax where digital goods are taxed. A $49 one-time pass is a
one-off payment with a 12-month entitlement, not a subscription, so there is nothing to cancel.

## Feature map
Each feature's own spec says what's free; this table is the single list the entitlement code reads from
(`lib/entitlements.ts`, one typed object, tested).

| Feature | Free | Plus | Pro |
|---|---|---|---|
| Profiles, Explore, Compare (4), Data, glossary, roadmap | ✓ | ✓ | ✓ |
| Account, household, student profile ([student-profile.md](student-profile.md)) | ✓ | ✓ | ✓ |
| Saved list ([saved-lists.md](saved-lists.md)) | 1 list, 12 colleges | lists, 30 colleges each | same |
| Statuses, outcomes, notes, deadlines | ✓ | ✓ | ✓ |
| Follow colleges and update emails ([follow-colleges.md](follow-colleges.md)) | ✓ | ✓ | ✓ |
| Standing on a profile ([chances-and-fit.md](chances-and-fit.md)) | ✓ | ✓ | ✓ |
| Standing across the list and in Explore; fit sort | | ✓ | ✓ |
| Compare up to 10 (table view) | | ✓ | ✓ |
| CDS detail: GPA bands, early rounds, class sizes ([cds-admissions.md](../data-expansion/cds-admissions.md)) | on profiles | + filters and sorts | same |
| Early-application checklist ([early-decision-strategy.md](early-decision-strategy.md)) | | ✓ | ✓ |
| Earnings by major, deeper views ([field-of-study.md](../data-expansion/field-of-study.md)) | top majors on profiles | ✓ | ✓ |
| CSV and PDF export of a list | | ✓ | ✓ |
| SAI and Pell estimate ([net-price-estimator.md](net-price-estimator.md)) | ✓ | ✓ | ✓ |
| Per-college price ranges and 4-year projection | 3 colleges | 3 colleges | whole list |
| Award letter form and one comparison ([offers.md](../planner/offers.md)) | ✓ (Mar–May) | ✓ | ✓ |
| Award letter upload, 4-year totals, appeal summary | | | ✓ |
| Family PDF dossier (list, standing, estimates, offers) | | | ✓ |

The planner ([planner/README.md](../planner/README.md), 2026-10-07) is meant to be the primary paid feature, but
its line is drawn here only after it is built (owner decision); its specs name no tier and expose capability names
through one hook ([model.md](../planner/model.md#entitlements)) for this map to fill in then.
| Scattergrams from your high school ([scattergrams.md](scattergrams.md)) | counts | ✓ | ✓ |
| Multiple students under one plan | | | ✓ |

Gating UX: a gated block renders its frame with a blurred sample and a "Plus" or "Pro" chip and a one-line
reason; nothing is hidden, nothing nags. One upgrade sheet, from any chip.

## Billing
- **Stripe Checkout** (hosted) for payment; **Stripe Billing** for the subscriptions; **Customer Portal** for
  cancel, card, and invoices. No card data ever touches the app.
- Products: `plus_monthly`, `plus_yearly`, `pro_pass` (one-time), `pro_monthly`. Prices live in Stripe; the app
  reads a price id per product from env.
- **Webhooks** (`/api/stripe/webhook`, signature-verified) write `subscriptions (user_id, tier, status,
  current_period_end, stripe_customer_id, stripe_subscription_id)`; the entitlement check reads that table, not
  Stripe, at request time. A nightly job reconciles against Stripe.
- `entitlements(user)` (server-only) returns the tier and limits; a guardian's Pro applies to every student in
  their active households ([accounts.md](accounts.md#roles-and-households)). Server Actions and pages enforce it;
  the UI only reflects it.
- **Trials and refunds:** a 7-day Plus trial once per account; Pro pass refundable within 14 days if unused
  (no upload, no export). Stated on the pricing page.
- **Minors paying:** under-18s can't form contracts in most states; the Terms say a purchase by a minor is made
  with a guardian's permission (the strategy document's "allowance" case). Apple/Google in-app purchase rules
  apply only if there's a native app.
- Telemetry events `subscribe_started` / `subscribe_completed` / `subscription_cancelled` from the server
  ([telemetry.md](telemetry.md#event-registry)).

## Pricing page (`/pricing`)
Per the strategy document's layout: a Monthly / Annual toggle with annual preselected ("Save 33%"), two Plus cards
and a Pro card, the feature map as a comparison table, FAQ (what stays free, refunds, minors, cancel any time), and
a line about why there are no ads. Linked from the footer and the upgrade sheet; not in the main nav.

## B2B
Organization plans are specified separately: [counselor-portal.md](counselor-portal.md) ($299–$599/year per
organization by seats) and [data-api.md](data-api.md) ($1,200+/year). Both reuse the Stripe products and
`entitlements()` with an `org_id`.

## Legal and operational before launch
Terms of service, privacy policy (telemetry, minors, data export and deletion), refund policy, a business entity
and bank account for Stripe, sales-tax registration where Stripe Tax says it's needed, a support email, and a
status page. The formal release in [backlog.md](../backlog.md#platform) (prod Supabase project) is a prerequisite.

## Files (planned)
- `lib/entitlements.ts` (feature map, limits, `entitlements()`), `app/pricing/`, `app/api/stripe/webhook/route.ts`,
  `lib/stripe.ts`, migration `…_subscriptions.sql`, `tests/entitlements.test.mts` (every gated feature in a
  spec appears in the map; guardian coverage; expired subscription loses access).
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`.

## Open questions
1. Is Pro a one-time $49 pass (the document's first option) or a $9.99/month seasonal subscription (the second)?
   Recommendation: offer both, expect the pass to dominate, and watch telemetry.
2. Niche now offers award-letter decoding free. Should the award letter form stay free year-round rather than
   March–May? Recommendation: decide after the first spring's funnel data.
3. A "counselor recommended" referral discount for Plus (a code from a counselor organization) could be the main
   acquisition channel; cheap to add to Stripe (promotion codes).
