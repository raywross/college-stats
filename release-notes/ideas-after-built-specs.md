---
title: "Roadmap: three ideas pointed at plans that had just been built"
pr: 71
date: 2026-10-04
kind: fix
summary: Three idea pages on the roadmap listed "builds on" plans that were finished minutes before the ideas landed, which tripped the site's own checks; the lists now name only plans still in progress.
---

## What was wrong

The [Ideas section](/roadmap) landed a few minutes after the Common Data Set plans and the document-reading agent
were finished and left the roadmap. Three ideas (colleges that would compete for you, cycle watch, and getting into
the major) still listed those plans under "builds on", and the check that every such link points at a live roadmap
page failed. Nothing on the site was wrong; the check caught a stale reference.

## What changed

Each of the three ideas now lists only the plans still in progress (where you stand, following colleges, the student
profile). The finished work they also rely on is noted in the registry for the day they are built.
