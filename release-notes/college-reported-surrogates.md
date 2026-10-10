---
title: "Fix: data updates no longer stop on a page with an unusual character"
pr: 112
date: 2026-10-10
kind: fix
summary: The automated college data update no longer stops when a college's web page has an unusual character (such as an emoji cut off mid-symbol), so one odd page can no longer block an entire update.
---

## What's new

- The data update that reads colleges' own Common Data Set pages no longer stops the whole run over one page's text
  containing an unusual character, such as an emoji that was cut off partway through. That had spent nothing and
  exited immediately; now the run reads the page safely and moves on.

## Behind the scenes

- Some college pages' link text or body text contains a character made of a surrogate pair (most emoji are). A
  length limit on that text could cut the pair in half, leaving one unpaired half. `JSON.stringify` turns that into
  an escape sequence the API's own JSON parser rejects outright ("no low surrogate in string"), failing the request
  before anything is spent.
- Every request leaving the pipeline — batched picker, extraction, and escalation calls, and interactive discovery
  and extraction calls — now passes through a small pure helper that makes every string in the request well-formed
  (`String.prototype.toWellFormed()`, with a manual fallback) immediately before it's sent, so an unpaired surrogate
  from anywhere upstream can never reach the API as broken JSON.
- Covered by a new test (`tests/cds-batch.test.mts`) that reproduces the exact cut (a 120-character link-text slice
  landing mid-emoji) and checks the fake API receives only well-formed strings; confirmed to fail without the fix.
