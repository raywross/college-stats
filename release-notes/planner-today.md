---
title: "Pretend today: walk a plan through its seasons in one sitting"
pr: 217
date: 2026-11-05
kind: infra
summary: A testing switch lets an admin set the day the planner thinks it is, so every season, move, and deadline can be checked months ahead without waiting; it never applies to the live site.
---

## What's new

Nothing changes for families. This is a switch for testing Quad itself.

## Behind the scenes

On the admin settings page, **Pretend today is** takes a day. While it's set, every plan opens as if it were that day: the season, the next steps, the dates on the grid and the calendar, the counselor's caseload, and the dates a plan writes down when someone marks a college applied or decided. A banner above the plan says the date is pretend, with a link to change it back. The live site ignores the setting entirely, so no real student's deadlines can move. Scheduled emails keep the real calendar.
