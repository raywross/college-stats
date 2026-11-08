---
title: Faster for counselors, and a lighter plan for everyone
pr: 224
date: 2026-11-08
kind: improvement
summary: The caseload, a student's page, and the plan stop waiting on the database row by row, each counselor page becomes one round trip, and the plan no longer carries every citation on every view.
---

## What's new

Counselors should feel the caseload open, a student's page open, and the plan and its tabs switch noticeably
faster. Nothing on the screen changes except one small thing: the ⓘ beside a figure on the plan now says "Loading
the source…" for a moment before it shows where the figure came from.

## Behind the scenes

We timed the counselor's pages on the live site and traced each second (the write-up is in the serving-architecture
spec). Four causes, four fixes:

- **The database checked who may see each row, one row at a time, at a few milliseconds a row.** The checks now
  ask once per query for the set of students the person may see, and every table below a list asks the list's own
  rule. A test boots the database before and after and shows thirteen different people see exactly the same rows.
- **The account check that starts every signed-in page read every student and profile the person could see.** It
  now starts from the person's own memberships and grants, and leaves the profiles to the pages that need them.
- **Each counselor page made five database round trips in a row.** The caseload and the student page now make one
  each, started together with the sign-in check.
- **The plan carried about 900 KB of citation details on every view and every tab switch.** It now carries a small
  reference per figure and fetches the detail when the ⓘ opens; the print view keeps everything. Most of the weight
  turned out to be each college's whole data history riding along in a field nothing on the page read.

Also: every counselor page and the essay page now log their timing in production, so the next slow spot shows up in
the logs instead of in someone's patience.
