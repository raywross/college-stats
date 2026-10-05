---
title: A set way to build each part of the roadmap
pr: 79
date: 2026-10-04
kind: infra
summary: Each section of the roadmap is now built from a written plan, split into pieces that are built side by side and checked together.
---

## What's new

Nothing changes on the site itself. Larger features, such as the national trends pages coming next, now follow one
written method: read every plan for the section, decide the shared pieces first, build the rest side by side, and
check everything together before it reaches the site.

## Behind the scenes

A project skill (`.claude/skills/build-roadmap-section/SKILL.md`) and a line in `CLAUDE.md` describe the method:
a shared brief, units of work on `feature/<section>-<unit>` branches each run by a subagent with a model suited to
the unit, merges into one `feature/<section>` branch, a full rebuild and verify, and one pull request.
