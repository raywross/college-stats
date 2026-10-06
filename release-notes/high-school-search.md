---
title: High school search works again
pr: 91
date: 2026-10-06
kind: fix
summary: Searching for a high school, on the High schools page and in your profile, returned no results; it now finds schools right away.
---

## What's fixed

Searching for a high school by name came back empty on the live site, both on **High schools** and in the high
school picker on **Me**. School pages themselves were fine. Search now answers in a fraction of a second.

## Behind the scenes

The database search read the whole high school table on every call. When that table wasn't in memory, it took
longer than the site's three-second limit for public queries, so the site showed no results. The search now uses
its name index on every call. A test checks that it stays that way.
