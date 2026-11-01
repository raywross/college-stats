---
title: "Jobs: see at a glance whether anything failed"
pr: 210
date: 2026-11-01
kind: improvement
summary: The console's Jobs page now opens with a line naming any job whose last run failed, and offers an All jobs view that lists every job in one table with failures first.
---

## What's new

The Jobs page in the admin console starts with the answer to the question you came for: which jobs, if any, failed
their last run, each named and linked, in red, or a plain "No job failed its last run." Under it, the counts of last
runs by state: failed, running, never recorded, nothing to do, succeeded.

Two tabs then offer the list two ways. **By schedule** is the view from before: the scheduled jobs by next run, then
the ones a person starts by hand. **All jobs** puts every job in one table, worst first, so the failures sit at the
top. In either view a job whose last run failed is tinted red.

## Behind the scenes

One word now describes any job's last run, whether it was a Vercel cron run recorded in the database or a GitHub
workflow run, and the same word drives the status line, the counts, the sort, and the tint. The views are plain
links (`?view=all`), so each is its own URL. Tests render the page with failures present and check the names, the
counts, the order, and the tinted rows.
