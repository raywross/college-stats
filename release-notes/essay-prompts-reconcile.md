---
title: "Essay prompts: colleges that share a page now agree"
pr: 193
date: 2026-10-29
kind: fix
summary: Colleges whose prompts live on one shared page take the same reading of it, transfer and graduate pages are never mistaken for first-year ones, and a hold now says when an earlier reading stays on file.
---

## What's new

- **The University of California campuses agree.** All nine share one page of personal insight questions, and the
  earlier runs sometimes read it differently for different campuses, so a few were set aside. After a run, a campus
  set aside on a page another campus passed on now takes that same reading. The same goes for any colleges that
  share a page.
- **First-year prompts only.** A transfer or graduate essays page is never taken for a college's first-year prompts;
  one college's transfer essays had slipped through in the last run.

## Behind the scenes

- The collection run keeps every college's outcome until all workers finish, then `reconcileHeld` rebuilds a held
  record from a passing record with the same page bytes (this run's or a committed one), with the college's own
  prompt ids, and re-checks it. The data PR lists who took whose read.
- URLs with a transfer or graduate segment are never fetched and such links score zero in discovery.
- When a re-read is held, the earlier passing record stays on file (a hold can be the model's noise), and the data
  PR's held table now says so with the record's date. Each change has a test.
