---
title: "Visit events: Sundays no longer look broken"
pr: 213
date: 2026-11-01
kind: fix
summary: The weekly retry of colleges whose visit calendars can't be reached had been counted as a mass failure every Sunday, which stopped that night's cleanup of events that had gone away and turned the admin card red; the retries are now counted on their own.
---

## What's new

Nothing families see changes directly, but the visit-events feed now tidies itself on Sundays too. Each week the
nightly reader tries again the several hundred colleges whose calendars it couldn't reach before. Those tries all fell
on the same night, and when they failed again, as expected, the run counted them as a mass failure: a safety rule
built to catch a broken calendar format then held back the night's cleanup of events that had vanished, and the
admin console's Visit events card went red every Sunday.

The retries are now counted on their own. A calendar already known to be unreachable failing again says nothing
about the others, so it no longer counts toward the safety rule, while a fresh failure among the healthy colleges
still does. The card says how many of a night's failures were these retries.

## Behind the scenes

`runSync` records `hosts_retried` and `retries_failed` on each run (a small migration adds the two columns) and
measures the 20% miss-withholding guard over the hosts that were not already unreachable. Tests cover retries left
out of the guard, a retry that answers, and fresh failures still tripping it.
