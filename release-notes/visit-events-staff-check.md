---
title: "The visit-events check stops failing on graduate hosts"
pr: 212
date: 2026-11-01
kind: fix
summary: The nightly visit-events job had failed since October 28 because a few colleges' graduate-admissions calendars looked like a classifier problem; the check now fails only on real housekeeping noise and reports graduate-heavy hosts as a warning.
---

## What's new

Nothing changes on the site: the visit events families see were never affected. The nightly job that reads colleges'
visit calendars had been marked failed every night since October 28, because its data check treats a calendar that
is mostly "staff" rows as a sign the title rules went wrong. The calendars tripping it were graduate-admissions ones
(Clarkson, Lehman, Detroit Mercy, UNCG) whose rows are graduate events the site hides on purpose. The check now tells
the two cases apart: it fails only when a college's own housekeeping rows (shipping, pickups, filled slots) pass the
line, and reports a graduate-heavy host as a warning that names the titles.

## Behind the scenes

`staffReason(title)` says why a row is staff, logistics or non-admissions, and the check measures the failure rule on
the logistics share alone. Two graduate-only hosts found by discovery on October 14 were turned off on dev and their
stored events removed; the two shared undergraduate-and-graduate hosts stay on. Tests cover the reason per title, a
failing logistics host, a warning graduate host, and a mixed one.
