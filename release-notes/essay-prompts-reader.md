---
title: "Essay prompts: a better reader before the first colleges land"
pr: 187
date: 2026-10-29
kind: fix
summary: The reader that collects colleges' essay prompts no longer mistakes the Common App's site for a college's page, accepts pages that print no year, and understands "answer four of the eight".
---

## What's new

- **"Choose 4 of 8."** Some colleges, the University of California campuses among them, list more prompts than
  you answer. The college's card now says so ("Choose 4 of 8 essays (350 words)"), the prompts fold says how many
  to answer, and your list's count adds the four you'll write, not all eight.
- **More colleges will appear.** Most colleges' essay pages don't print the application year. The first collection
  run set those aside; now Quad takes the open cycle for them and notes that it did, so the pages can be checked
  with a glance rather than held back.

## Behind the scenes

- The reader never treats a shared application platform's page (the Common App, the Coalition on Scoir,
  ApplyTexas, Cal State Apply and others) as a college's own essay page: not as a starting point, not after a
  redirect, and never in the list the link picker sees. The first run had recorded twelve colleges from the Common
  App's homepage.
- A record whose page names no cycle is marked `cycle_assumed`, listed in the data PR under "Cycle assumed", and
  its lineage record quotes the sentence the prompts were read from. A record with neither a cycle quote nor the
  mark is still held.
- The block gains `essays.choose` (how many of how many, with the sentence that says so); the checks require the
  count to match the prompts listed and refuse a prompt marked required under it. Each new rule has a test that
  plants the violation.
