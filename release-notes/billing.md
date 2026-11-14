---
title: The Advisor's trial and billing, built and waiting for the switch
pr: 251
date: 2026-11-14
kind: feature
summary: Quad Advisor can now be sold the way the owner decided, 14 days free with a card on file and then $20 a year for one student or $30 for a family, but nothing changes on the site until the owner connects Stripe and turns the price on.
---

## What's new

Nothing you can see yet, on purpose. Quad Advisor is still free for every account while Quad is in preview.

What's ready behind the Advisor tab, for the day the price goes live:

- **A 14-day free trial with your card on file.** Start it from the Advisor tab or the new [pricing page](/pricing):
  one student for $20 a year, or the whole family for $30 a year. Cancel before the trial ends and nothing is charged.
  Payment is handled by Stripe; Quad never sees your card.
- **Who can start one.** A parent or guardian, for one child or for the family. A student 16 or older, from their own
  account, with a parent's okay. A student under 16 asks a parent, who starts it from Household.
- **While the trial runs**, the Advisor tab says quietly when it ends, and a reminder email comes three days before,
  with one button to keep it and one link to cancel. No second reminder, and never a text about billing.
- **Your account page** gets an Advisor row: the trial's end or the renewal date, Cancel or Keep in one tap, and
  Stripe's billing portal for your card, invoices, and receipts.
- **If a subscription lapses**, the advisor turns read-only: your list, its levels, the calendar, and the offers stay;
  the guides, the changes, the weekly email, and the texts stop. Nothing is deleted, and subscribing again restores it.
- **Early accounts.** Every account made before the price goes live keeps the advisor free through the end of this
  application cycle, August 31, 2027.
- **What stays free** is everything else: every college's page, Explore, Compare, the data, your record, and Quad's
  estimate on every college page. The pricing page lists it, and what the money never buys: no ads, no featured
  listings, no leads sold to colleges, no advisor commissions.

## Behind the scenes

The entitlement hook every advisor write already asked (`allowed()`) now reads a real map: which capabilities are free,
which come with the advisor, and which a lapsed plan may still read. It answers yes to everything until two things are
true: Stripe's keys are on the deployment and an admin has turned the price on from the console's Settings. A new
`subscriptions` table is written only by the server, from Stripe's webhooks, the checkout's return, and a nightly
reconcile that refetches every live subscription so a missed webhook corrects itself within a day. The counselor
caseload's chip reads "Preview" until then, and afterwards Advisor, Trial, Not yet, or Lapsed. Telemetry gains the
trial funnel (started, reminder sent, converted, cancelled, renewed), with the product and never an amount.
