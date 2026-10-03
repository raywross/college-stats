---
title: "College figures are saved as each college is read"
pr: 0
date: 2026-10-03
kind: infra
summary: The agent that collects colleges' newer admissions figures now saves its work after every college, shows live progress and cost, and stops cleanly when its spending limit is reached.
---

## What's new

Nothing changes on the site itself. This makes the agent behind "Newer figures from colleges" safer to run:
figures it has already collected are no longer lost if a run is interrupted.

## Behind the scenes

- After every college, the agent saves the figures, the review queue, and a progress summary, instead of only at the
  end. A run that fails, runs out of budget, or is cancelled keeps everything it finished, and still opens a pull
  request for review.
- Each college adds a progress line with the run's cost so far, visible live in the GitHub Actions log.
- When the Anthropic account's spending limit or credit runs out, the run stops at once instead of failing every
  remaining college, and the next run picks up where it left off.
- The run's files are also kept as a downloadable artifact on the Actions run.
