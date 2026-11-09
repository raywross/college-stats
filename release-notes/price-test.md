---
title: The advisor's price will be tested before it is settled
pr: 237
date: 2026-11-09
kind: plans
summary: Quad Advisor launches at $20 a year for a student and $30 for a family, and a small test will show a higher price to some visitors so the price can be set from real numbers.
---

## What's new

Nothing changes on the site today. The plan for Quad Advisor's price is now written down:

- **The price at launch is $20 a year for a student and $30 for a family**, as decided in October.
- **Some visitors will see a different price.** During the first campaigns in early 2027, about half of the people who
  arrive through one of Quad's own ad links will see $49 and $79 instead. Whatever price you see is the price you are
  charged, it stays the same for you throughout, and it is never set by anything about you, only by the link you
  arrived through. Nobody who already has a plan will ever see their renewal price go up because of a test.
- **The pricing page will say so**, in plain words: prices may differ by offer, and the price shown is the one charged.

## Behind the scenes

- `specs/product/commercialization.md` gains a "Price tests" section: a price variant is a property of a campaign or
  of one of its links, carried by the 30-day campaign cookie; each variant is a Stripe Price on the same two
  products; at most three variants at once; never below the list price (discounts are promotion codes); the
  subscription stores the price it started at.
- The Growth overview in the admin console reports trials started, trials converted, and first-year cash per trial by
  variant; the trial and subscription events and the daily marketing table carry the variant.
- The April 2027 reading decides the next cycle's list price. The recommendation on the table is $49 and $79 with a
  counselor-recommended first-year code.
