---
title: "More colleges' own Common Data Sets can be read"
pr: 99999
date: 2026-10-10
kind: improvement
summary: Our reader now opens a college's published Common Data Set file even when the college's site asks automated readers to stay away, so more colleges can show figures from their own report.
---

## What's new

- **More colleges' own Common Data Sets can now be read.** Some colleges post their Common Data Set (the standard
  report of admissions, enrollment, and costs) on a part of their site that tells automated readers to keep out.
  That left about 20 colleges, including Boston College, Stanford, the University of Washington, Kenyon, and UNC
  Wilmington, without figures from their own report even though we knew exactly where it was. The Common Data Set is
  public data, so we now read that file anyway. Their figures arrive with the next update.
- **Nothing else changed.** We still respect those instructions for every other page on a college's site, including
  class profiles and the pages we browse to find documents. We still say who we are, still wait between requests, and
  still stop at once when a site turns us away or puts up a bot check.

## Behind the scenes

- Owner decision (2026-10-10): "We're safe to ignore the robots.txt for the purpose of pulling a CDS file. It's public
  data per the law." It's recorded in `specs/college-reported-data.md` under "Decisions".
- `PoliteHttp.get` takes `{ cdsDocument: true }`, which only the read of a recipe source of kind `cds` passes. For that
  request robots.txt's Allow and Disallow rules aren't consulted, and the log says "fetched anyway". Its Crawl-delay,
  the one-second gap per host, and the user agent stay the same. A 401, 403, 429, or challenge answer is recorded for
  the blocked-hosts list and never retried.
- New tests: a disallowed CDS file is fetched and read; a disallowed class profile and index page are still skipped;
  a CDS file answering 403 gets one request and goes to the review queue.
