---
title: Quad plans to open its doors before there is a price
pr: 238
date: 2026-11-09
kind: plans
summary: A new roadmap entry describes how the site opens to everyone, free while in early access, with search engines invited in and a few promises written down first.
---

## What's new

Nothing on the site changes today. A new entry on the [roadmap](/roadmap), "Open the doors", says how Quad will open
to the public before Quad Advisor has a price:

- **Quad Advisor will be free while Quad is in early access.** A price comes in 2027. An account made before then keeps
  the Advisor free through the end of the 2026–27 application cycle, with no card and no trial.
- **The site gets a terms-of-use page**, and the privacy page will name the company whose model reads essay drafts and
  say exactly what it receives.
- **Search engines are invited in properly**: a sitemap, a title and description for every page, and a card when a
  college page is shared in a text or on social media.
- **People's data moves to a production database** in the same region as the site's servers before anyone new signs
  up.

## Behind the scenes

- `specs/product/open-doors.md` lists what is true of the live site today (crawlers already reach it; nothing is
  gated), the five obligations before the first stranger signs up, the early-account rule (`isEarly()` against an
  `advisor.price_live_at` setting, no migration), wave 1 of the Growth console as the findable-and-counted half, the
  signals to watch once open, and four owner decisions, with 2026-12-01 recommended as the date.
- `specs/launch-database.md` is pulled forward from "just before the formal release" to step A1 of this epic;
  `specs/product/commercialization.md` gains the early-account rule in its billing section.
