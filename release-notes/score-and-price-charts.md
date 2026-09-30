---
title: Clearer test score bars and a full-price column for net price
pr: 35
date: 2026-09-30
kind: improvement
summary: Test score bars zoom in on the range that matters and label the 25th and 75th percentiles, and the net price chart now shows what families without grants pay.
---

## What's new

- **Test score bars zoom in.** A selective college's SAT range used to be a sliver on a 400–1600 bar. Each bar now
  uses the tightest of three axes that fits the college: 1000–1600, 800–1600, or 400–1600 for the SAT, and 18–36,
  12–36, or 1–36 for the ACT. Section scores work the same way. The small bars in the page header now show where
  their axis starts and ends.
- **25th and 75th percentiles are labeled.** The ends of each bar now show the actual scores, for example "25th 1500"
  and "75th 1570".
- **"What families at each income level pay" shows the full picture.** The five income columns are averages for
  students who got federal aid. A new "No grants" column shows the full sticker price that students without grants
  pay. Each income column is drawn up to the full price. The solid part is what families paid, and the shaded part
  is what grants covered.
- **Years are spelled out.** The chart uses the latest release of each figure. Fine print under it names both years
  and says when they differ.

## Behind the scenes

The axis choice lives in one helper (`lib/score-scale.ts`) with its own tests. The axes come in fixed steps rather
than a separate minimum for each college, so colleges on the same axis can be compared directly.
