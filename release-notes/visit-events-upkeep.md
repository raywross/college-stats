---
title: "Visit events that keep themselves current"
pr: 161
date: 2026-10-15
kind: improvement
summary: The nightly visit-calendar read now finds more colleges, keeps what it knows when a calendar page changes shape, and shows administrators how each night went.
---

## What's new

The visit calendars Quad reads every night now look after themselves, so what a family sees stays true without anyone
checking behind the scenes.

- **More colleges.** Quad now finds a college's calendar even when its visit page links it indirectly, and looks
  again every week for colleges that have moved to the same system. The first pass added 59 colleges, among them
  Juilliard, St. Olaf, Elmira, Gallaudet, UMass Dartmouth, and Wofford: about 30,000 more upcoming events.
- **No false alarms.** If a college's calendar page changes shape, Quad notices that it can no longer read it and
  keeps what it already knew rather than concluding that every event was cancelled. A night when many calendars fail
  at once is treated as Quad's problem, not the colleges', and nothing is marked as gone.
- **Calendars that go quiet** are checked less often, and ones that stop answering are retried on a schedule, so the
  nightly read spends its time on calendars that are live.

## Behind the scenes

The administrators' console gains a Visit events card: the last week of nightly runs, how many calendars answered,
failed, or collapsed, what changed, and the result of the data check that follows each run, in red when something
needs a look. The nightly read can also be started by hand from the console. Details, including the few colleges
whose calendars can't yet be read, are in [the spec](../specs/product/visit-events.md), under "Keeping it running".
