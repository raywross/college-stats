---
title: Why the counselor's pages feel slow, measured
pr: 223
date: 2026-11-08
kind: plans
summary: A measured account of where the time goes when a counselor opens the caseload, a student, a plan, or an essay, and the list of fixes in the order they will pay off.
---

## What's new

Nothing on the site changes yet. We timed the counselor's pages on the live site, traced where each second goes,
and wrote down the fixes in the order they will help most. Opening the caseload takes about a second, a student's
page most of a second even when the student has nothing on file yet, and a plan or an essay about the same again.

## Behind the scenes

Four causes, all in the serving-architecture spec with the numbers: the database checks who may see each row one
row at a time, at a few milliseconds a row; the account check that starts every signed-in page reads every student
and profile the person can see; each counselor page makes five database round trips in a row, each one a hop to
another region; and the plan carries about 900 KB of citation details on every view and every tab switch. The
backlog's new Platform item lists the fixes.
