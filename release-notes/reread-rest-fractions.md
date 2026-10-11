---
title: "Re-reading Common Data Sets that print rates as fractions"
pr: 0
date: 2026-10-11
kind: infra
summary: Common Data Sets that print graduation rates as fractions, such as 0.945, are being re-read so those rates are stored correctly.
---

## What's new

**Rates printed as fractions are read correctly.** Some colleges, including Yale and Colorado School of Mines, print
graduation rates as fractions (0.945) instead of percents (94.5%). Those documents are being re-read from saved copies
so the rates come out right.

## Behind the scenes

The model read for the rest of each Common Data Set (after the admissions section) and the fillable-form reader both
get a new version number, which marks every document they read as due for a fresh read from the archive. The data
workflow gains a "reextract" option to run that re-read without downloading anything.
