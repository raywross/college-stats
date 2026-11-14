---
title: The Advisor's trial and billing, built and waiting for the switch
pr: 251
date: 2026-11-14
kind: feature
summary: Quad Advisor can now be sold the way the owner decided, 14 days free from the day a student joins with a card on file and then $20 a year per student unless cancelled, with parents and counselors free, but nothing changes on the site until the owner connects Stripe and turns the price on.
---

## What's new

Nothing you can see yet, on purpose. Quad Advisor is still free for every account while Quad is in preview.

What's ready behind the Advisor tab, for the day the price goes live:

- **One price: $20 a year per student.** Parents and counselors pay nothing for their own accounts. Everything else on
  Quad stays free: every college's page, Explore, Compare, the data, your record, and Quad's estimate on every college
  page. The new [pricing page](/pricing) lists it, and what the money never buys: no ads, no featured listings, no leads
  sold to colleges, no advisor commissions.
- **A 14-day free trial that starts by itself**, the moment a student's record is made. A student who signs up, a
  student a parent adds, a student a counselor invites: all three get the same 14 days of the whole advisor.
- **A card on file, charged when the trial ends unless you cancel.** A student of any age puts their own card on file
  when they first open the Advisor tab; nothing is charged until the trial ends, and cancelling before then costs
  nothing. A parent enters one card for the household, once; each student they add is paid for from it after the
  student's trial.
- **While the trial runs**, the Advisor tab says quietly when it ends and how to keep it, and an email comes three days
  before the end. No second reminder, and never a text about billing.
- **Your account page** gets an Advisor row: the card on file, each student's subscription with its date, Cancel or
  Keep in one tap, and Stripe's billing portal for invoices and receipts.
- **If a trial ends with no card, or a subscription lapses**, nothing is charged and the advisor turns read-only: your
  list, its levels, the calendar, and the offers stay; the guides, the changes, the weekly email, and the texts stop.
  Nothing is deleted, and subscribing restores it.
- **Counselors can invite a parent.** On a student's page, "Invite a parent" sends the household's ordinary invitation;
  the parent who accepts sees the same advisor the student does and can pay for it.
- **Early accounts.** Every account made before the price goes live keeps the advisor free through the end of this
  application cycle, August 31, 2027.

## Behind the scenes

The entitlement hook every advisor write already asked (`allowed()`) now reads a real map: which capabilities are free,
which come with the advisor, and which a lapsed plan may still read. It answers yes to everything until two things are
true: Stripe's keys are on the deployment and an admin has turned the price on from the console's Settings. A database
trigger starts a trial for every new student record, so no door in can miss it. The `subscriptions` table is written
only by the server, from Stripe's webhooks, the checkout's return, and a nightly reconcile that refetches every live
subscription so a missed webhook corrects itself within a day; the same job sends the reminder for trials with no card.
The counselor caseload's chip reads "Preview" until then, and afterwards Advisor, Trial, Not yet, or Lapsed. Telemetry
gains the trial funnel (a card added, reminder sent, converted, cancelled, renewed), with the product and never an amount.
