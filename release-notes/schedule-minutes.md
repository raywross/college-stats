---
title: The college-reported job's schedule fires again
pr: 250
date: 2026-11-12
kind: fix
summary: The job that reads what colleges report had not run on its schedule since early October; its crons now sit on minutes GitHub does not drop.
---

## What's new
Nothing on the site changes today. The job that finds and reads each college's Common Data Set, class profile and
announcements had not started on its own since October 3; every run in that time was started by hand. From now on it
runs on its schedule again, so new figures reach college profiles without anyone pressing a button.

## Behind the scenes
All of the job's schedules sat on the top of the hour, the minute GitHub delays and drops scheduled runs most, and
the housekeeping schedule that finishes open batches shared that minute with them. The weekly schedule never fired
once in six weeks, and the housekeeping one fired a handful of times a day instead of every half hour. The schedules
now sit at 13:17 and at :07 and :37, a test keeps them apart, and the admin Jobs pages say "Every 30 minutes, at :07
and :37" for the offset one.
