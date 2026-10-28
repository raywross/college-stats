---
title: "The plan is now Quad Advisor, and a page that shows what it does"
pr: 180
date: 2026-10-27
kind: feature
summary: The Plan tab is now Advisor, every link to the old address still works, and a visitor without an account sees a page that shows the advisor at work for a sample student instead of a form.
---

## What's new

- **Plan is now Advisor.** The middle tab, the header, and every sentence on the site say advisor: it reads your
  record, sorts your list by where you stand, says what to do this season and how, and never misses a date. "Your
  plan" is "your advisor"; a parent sees "Jordan's advisor". The four tabs inside (Next steps, Colleges, Calendar,
  Offers), the guides, and Your record keep their names.
- **The address moved to `/advisor`.** Every old `/plan` link, in emails, texts, bookmarks, and calendar feeds, lands
  on the same page and the same tab.
- **A page that shows the advisor before you sign up.** Open the Advisor tab without an account and you see what a
  junior named Jordan would see: five colleges sorted by level, the three things to do this season with their guides,
  a month of the calendar with the text that arrives the night before a deadline, the parent's view, and two offers
  side by side. Every college figure is real and cited; Jordan is not, and every frame says so. The button starts an
  account; while Quad is in preview, the advisor is free.
- The home page has a new line under the search: "Try Quad Advisor".

## Behind the scenes

- One module holds the name (`lib/planner/advisor.ts`), so the word is a one-line change; the link builders keep their
  names and return the new address; `next.config.ts` redirects the old routes permanently, query strings included.
  Internal names (the `plan_child` cookie, the `/api/plan` routes, telemetry event names, file names) keep "plan".
- Two guard tests: one sweeps the code for any literal `/plan` route, the other parses every component with the
  TypeScript compiler and fails on "your plan" or a bare "Plan" label in anything a person reads, with an allowlist for
  plans that are plans (a course plan, the College Financing Plan).
- The splash page renders the product's own components over one fixture (`data/reference/sample-plan.json`); its
  move titles and deadlines are checked against the move catalog and the dataset, so the page can't drift from the
  product. The old signed-out plan is gone; a list kept in the browser before this release still imports on sign-in.
- The 14-day trial and its billing are the next step ([the advisor's plan](/roadmap/advisor)).
