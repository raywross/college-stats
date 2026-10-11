---
title: "Plans: how Quad's estimate is built, kept with the plans until launch"
pr: 118
date: 2026-10-10
kind: plans
summary: The detailed plan for how Quad's Reach, Target, or Likely estimate is worked out now sits beside the other plans, ready to build, and moves somewhere private at launch.
---

## What changed

Nothing on the site changes. The plans for Quad's estimate now include the detailed method again, so the estimate
can be built from them. On the site, the estimate will still show only what kinds of information it uses and what it
concluded, never how the pieces are combined.

## Behind the scenes

The method lives in `specs/chances/method/` until launch, when it moves to a private repository through a short
checklist in the [estimate plan](../specs/chances/estimate.md). The estimate runs only on the server either way.
