---
title: "College figures publish as soon as they pass their checks"
pr: 0
date: 2026-10-03
kind: improvement
summary: Figures that pass their checks now publish on their own, a few checks learned from the first live runs, and discovery is tighter and faster.
---

## What's new

- **Whatever passes, publishes.** A run no longer waits for a person because some colleges couldn't be read. The
  figures that passed every check go live once the automated checks finish; the ones that didn't wait in the review
  queue. The only hold left is for a run in which many already-published figures suddenly change, which would point
  to a reading error rather than new data.
- **Rounded rates are accepted.** A college that prints its admit rate as "42%" is no longer rejected because its
  counts work out to 42.43%.

## Behind the scenes

- The circuit breaker keeps only its change-share trigger (more than a quarter of already-published values changing
  in one run). Its failure-share trigger fired in both live runs on blocked sites and rounding and never on a real
  problem.
- Auto-merge is on by default for manual runs as well as scheduled ones.
- The rate check allows 0.5 points for a whole-percent rate, 0.1 for one decimal, 0.05 for two.
- When discovery returns last year's Common Data Set link, next year's URLs are tried beside it.
- The document reader's output limit doubled (a long PDF hit it); discovery uses fewer, smaller page reads and is
  cut off after six minutes per college; run summaries now break out cache reads and web searches.
- Measured on the first ten-college run: 26.5 minutes and $1.93, with 4 of 10 colleges publishing. Details in
  `specs/college-reported-round-2.md`, "Round 2.1".
