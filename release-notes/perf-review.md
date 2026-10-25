---
title: "Faster first paint: the header knows you at once, college pages served from the cache"
pr: 176
date: 2026-10-25
kind: improvement
summary: "Sign in" or your avatar appears with the page instead of seconds later, every college overview comes straight from the cache again, and the review behind both is written up.
---

## What's new

- **The header stops waiting.** "Sign in", or your avatar when you're signed in, now appears with the page. Before,
  the corner stayed blank while the browser asked the server who you were, which could take a couple of seconds on a
  quiet site.
- **College pages load faster.** A college's overview is served from the cache again like its topic tabs, instead of
  being rebuilt for every visitor. Its **Event calendar** has its own address (`/schools/<id>/events`); older links
  still land there.

## Behind the scenes

- The server now sets a plain `quad_signed_in` cookie beside the session cookies (and clears it with them), so the
  header can tell signed in from signed out before anything is fetched. It carries no identity and the server never
  reads it. The name and avatar letter still come from `/api/me`, now remembered per tab for five minutes instead of
  asked on every page.
- The overview had quietly become a per-request render: its calendar button read the session and the page took a
  query parameter. Both moved to the new route; `next build` lists the overview as prerendered again.
- The header's logo no longer prefetches the home page's payload (58 KB) on every page.
- The measurements (TTFB and Lighthouse on the live site, the shared JavaScript, Vercel's and Supabase's regions) and
  the remaining items in order of gain are in `specs/serving-architecture.md`, "Follow-up (2026-10-25)".
