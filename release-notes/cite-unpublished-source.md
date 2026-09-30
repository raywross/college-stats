---
title: "Fix: new data sources no longer break a site update"
pr: 37
date: 2026-09-30
kind: fix
summary: A site update that adds a new data source no longer fails when it goes live before that source's data does, which is what held back the sports and programs release.
---

## What's new

- The sports, ROTC, and campus programs release (#36) is now live. Its first attempt to go live failed and left the
  previous version of the site in place; nothing visitors saw was broken.

## Behind the scenes

- A site update and its data are published at the same time. When the new code was built before the new data finished
  publishing, it looked for the new source's citation details, didn't find them, and the build stopped.
- Now a citation whose source is still being published shows a brief placeholder, and pages refresh once the data
  lands. The checks that guard the data itself are unchanged: data missing a source is still never published.
