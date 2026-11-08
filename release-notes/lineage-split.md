---
title: A faster first answer from a cold server
pr: 228
date: 2026-11-08
kind: infra
summary: The citation records behind every figure leave the main college file and load per college on first use, so a server instance that has just started answers in about half the time.
---

## What's new

Nothing on the screen changes. The ⓘ beside a figure still shows where it came from, and every page cites what it
cited before. What changes is the pause a visitor hits when their request lands on a server instance that has just
started: that pause is about half what it was once the next data publish goes out.

## Behind the scenes

The college data ships as one 36 MB file, and the whole file had to be parsed before a cold server could answer
anything. Half of it was each college's citation records, which no first request of a counselor, an essay, or the
header ever reads, and which a college page or the plan needs for only a few colleges. The publisher now writes those
records to their own file, the build fans them out one small file per college, and each college loads its own records
the first time anything asks, in well under a millisecond. The check for a newer data snapshot also now finishes
after the response goes out instead of being cut off with it.
