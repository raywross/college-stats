---
title: A plan for telling parents, students, and counselors about Quad
pr: 236
date: 2026-11-09
kind: plans
summary: Four planned specs describe how Quad will reach families and counselors, how it will know what worked without tracking anyone, and how search engines will find its pages.
---

## What's new

Nothing on the site changes today. Four new entries on the [roadmap](/roadmap) describe how Quad plans to reach
people, and what it will and won't do along the way:

- **The plan.** Three audiences, each with its own season and message: parents of 10th and 11th graders, students
  doing their own research, and the counselors and consultants who use Quad's portal free. Search engines are the main
  road, since every college page here answers questions people actually type. Paid ads are small, seasonal tests on
  Google and Meta only at first, judged by their measured cost, with other channels added later only if those two earn
  it. An ad reaches someone because of what they searched or watched, never because of who a platform thinks they
  are; ads that students may see carry no price and ask only that they look and invite a parent.
- **Measuring without tracking.** When you follow one of Quad's own links, a 30-day cookie remembers only the link's
  name, so Quad can count which campaign brought a sign-up. It holds no identifier, isn't shared with anyone, and is
  removed when you sign up. No ad pixels, no Meta or Google tags, no retargeting. The privacy page will say all of
  this.
- **Findable pages.** A sitemap, proper titles and descriptions on every page, a preview image when a college page
  is shared in a text, and structured data for search engines. The words of those titles and descriptions will be
  editable by Quad's admins without a code change.
- **The rules stay.** No percentage chances in any ad, no "boost your chances", and nothing about Quad's estimate's
  method anywhere in marketing.

## Behind the scenes

- `specs/product/marketing/`: `plan.md`, `measurement.md`, `seo.md`, `console.md`, with an index.
- The console gains a planned fifth door, Growth: campaigns and their `/go/{code}` links with QR codes, the Google and
  Meta campaigns themselves (written from the college data, launched after a dry run, paused and re-budgeted from a
  phone, synced hourly, with a spending ceiling and alerts by email and text), editable landing pages, the Search
  screen (templates, crawler switches, Search Console numbers, indexing), lifecycle emails and a double-opt-in
  newsletter for adults, and spend with cost per trial. PostHog's Query API is pulled daily into the site's own tables
  by a job the Steward reviews like every other.
- Four build waves; the first two (sitemap, robots, metadata, Open Graph, structured data, attribution, the overview,
  the landing pages, then the ad platforms) are due before the January 2027 push, and the fourth waits for Stripe and
  the trial.
- Registered in `lib/roadmap.ts` (four entries in the business group) and noted in the telemetry registry.
