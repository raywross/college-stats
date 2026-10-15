---
title: "Visit calendars from a second college system"
pr: 162
date: 2026-10-15
kind: improvement
summary: Quad now reads the visit calendars of colleges on the Element451 system too, starting with twenty, and has a reader ready for TargetX colleges that waits on a question of permission.
---

## What's new

Most colleges publish their visit calendars through one of a few systems. Quad has read the largest of them since
this week; it now reads a second one, **Element451**, used by about fifty colleges. The first twenty are live:
Otterbein, Chowan, Claflin, Georgia Gwinnett, Bethune-Cookman, the University of St Francis, and others, about 500
upcoming tours, sessions, open houses, and online sessions between them, each with its place and a sign-up link to the
college's own page. The rest of the Element451 colleges follow as their calendars are confirmed.

A reader for a third system, **TargetX**, used by about seventy colleges, is built and tested but switched off:
those colleges' sites ask automated readers to stay out, and Quad does what a site asks. Whether to ask those
colleges for their calendars another way is an open question, noted in the plan.

## Behind the scenes

Every reader now plugs into the same nightly pipeline, with the same safeguards: a calendar page that changes shape
is noticed rather than read as a mass cancellation, a night when many calendars fail marks nothing as gone, and the
administrators' card shows how each night went. The Element451 reader needs one request per college per night. The
details, including three places where the live calendars differed from the research, are in
[the spec](../specs/product/visit-events.md), under "Round 3".
