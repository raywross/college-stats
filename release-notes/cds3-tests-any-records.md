---
title: "College data updates can pass their checks"
pr: 70
date: 2026-10-04
kind: infra
summary: "The automatic checks no longer assume the site has Common Data Set records for exactly four colleges, so updates that add colleges can be reviewed and published."
---

## What's new

Nothing changes on the site. Each update from the agent that reads colleges' Common Data Sets runs the site's
automatic checks before it can publish. Some of those checks expected exactly the four colleges the site started with,
so every update that added colleges failed them. They now check what must always be true, however many colleges
there are.

## Behind the scenes

Eight tests were pinned to the four foundation records and to empty pipeline state files. They now check that the four
first colleges are still there, that every college with a Common Data Set block has a record, and that a call already
read at the current version is never due again. Verified against both the current data and a ten-college run's data.
