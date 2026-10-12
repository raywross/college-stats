---
title: "High school data publishes in smaller steps"
pr: 137
date: 2026-10-12
kind: fix
summary: The step that publishes high school data to the site now writes in smaller batches and waits out a database timeout instead of failing, so the AP course lists from College Board reach every page.
---

## What's new

- **Nothing visible, once it has run.** The first publish after the AP course lists were added failed because each
  school's record got bigger and a batch of 500 no longer fit the database's time limit. Batches are 200 now, and a
  step that times out is retried after a pause rather than failing the whole publish.
