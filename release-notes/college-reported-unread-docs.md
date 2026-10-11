---
title: "College data: reading documents we had already found"
pr: 108
date: 2026-10-10
kind: fix
summary: Common Data Sets and class profiles we had already found for about 200 colleges now get read, so more of their own figures can appear on their pages.
---

## What's new

- About 200 colleges had a Common Data Set or class profile that we had found and saved but never read, so none of
  their figures showed up. Yale's 2025–26 Common Data Set was one of them.
- From the next data update, those files get read. More colleges can then show figures they published themselves,
  such as GPA, Greek life, application deadlines, and financial aid, next to the federal numbers. As before, each
  figure appears only after it passes our checks.

## Behind the scenes

- The full data run on October 5, 2026 found and saved about 310 documents but hit its time limit before reading
  them. Later runs saw that these documents hadn't changed and skipped them as "unchanged", so they were never read.
  When the saved copy was missing, nothing downloaded them again.
- Now a saved document counts as unchanged only after it has been read. A document that was never read is read from
  the saved copy, or downloaded again if that copy is missing. Documents that were already read are still skipped, so
  routine runs cost no more.
- Data runs now also rebuild the national trend pages after merging new figures, so their data pull requests pass
  the site's checks without a manual fix.
- See [the round-3 pipeline spec](../specs/college-reported-round-3.md) for the details.
