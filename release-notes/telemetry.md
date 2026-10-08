---
title: Usage measured without cookies, and a privacy page that says how
pr: 101
date: 2026-10-08
kind: infra
summary: The site now measures how search, Explore, profiles, Compare, and the score checker are used, with no cookies, no recordings, and never a student's own numbers; a new Privacy page explains it in plain language.
---

## What's new

Nothing changes on screen, except one new page: **[Privacy](/privacy)** explains what the site measures and what it
never records. In short: which pages and features get used, which colleges people look at, and whether search finds
things. No cookies or cross-site identifiers for visitors, no session recordings, no heatmaps, and never a GPA, test
score, income, or anything else a student types about themselves. Browsers that send a Do Not Track or Global Privacy
Control signal are left out entirely.

Signed-in accounts are counted by an opaque id so we can tell whether the planning tools bring people back. The id is
never tied to an email or a name in the analytics, and signing out forgets it.

## Behind the scenes

- PostHog runs from one place, with the privacy settings fixed in code and guarded by tests: memory-only persistence,
  autocapture off, replay and surveys off, all text masked, persons only for signed-in accounts.
- Events come from a typed registry (`lib/analytics.ts`). Components call `track()` with a registered event; a list of
  denied property names (gpa, sat, act, score, income, email, name, and more) and guard tests keep anything personal
  out, and a test fails if any file talks to PostHog directly.
- Events are sent through the site's own `/ingest` path, so ordinary ad blockers don't silently blank the numbers.
- This reconciles last week's PostHog wizard install (#100): its default-settings init and inline events were replaced
  by the registry; its error reporting and server log export were kept; the environment variables it set in Vercel are
  the ones the code reads, so nothing had to change there.
- Also: sign-up events from the server, Vercel Speed Insights for Core Web Vitals, an owner setup guide with dashboard
  recipes in `specs/product/telemetry.md`, and a template for the monthly usage summary.
