---
title: Plan tabs switch in place, and the rest of the speed list
pr: 231
date: 2026-11-08
kind: improvement
summary: Switching between the plan's tabs no longer reloads the page, the plan's last database round trip becomes one, a freshly started server checks your sign-in without an extra network trip, and the last pages that carried every citation now load them on demand.
---

## What's new

- **Tabs on the plan switch instantly.** Colleges, Essays, and Calendar change in place without a trip to the
  server; the address bar and the back button keep working as before. Next steps switches in place when you opened
  the plan on it; Offers still loads, since it reads its own letters.
- **The plan asks the database one question for your high school** where it asked four or five.
- **A server that has just started checks your sign-in faster.** It used to fetch the keys that verify your sign-in
  over the network first; now they ship with the deploy.
- **The list page, offers, and the chances section** load each figure's source when you open its ⓘ, as the plan
  already did, so the pages carry less.

## Behind the scenes

The high-school lookups behind the estimate become one database function, and the two shared files it needs are
held once per server until the next publish. The signing keys are written at build time and passed to the token
check, with the old fetch as the fallback for a rotated key. The tab panels are rendered once and shown by the URL's
tab, mounting each the first time it is shown. And the one request that ran in San Francisco was Vercel's own
regional failover, which needs no change on our side.
