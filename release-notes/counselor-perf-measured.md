---
title: What the counselor speed-up measured, and what is next
pr: 225
date: 2026-11-08
kind: plans
summary: After the counselor speed-up shipped, the same pages were timed again on the live site; the caseload and a student's page open in under half a second, and the logs now point at the plan's own reads as the next thing to fix.
---

## What's new

Nothing on the site changes in this note; it records what the speed-up did. Signed in as a counselor, the caseload
now answers in about a third of a second and a student's page in about a fifth, down from about a second each. The
plan's page is a third of its old size.

## Behind the scenes

The serving-architecture spec gains the measured table, the production timing lines behind it, and the next targets
the logs make plain: the plan page still makes its database reads in four or five rounds, the essay page in seven,
and a cold server instance spends about a second loading the college data before it can answer anything.
