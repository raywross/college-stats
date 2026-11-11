---
title: A college's two admissions documents are compared only when they count the same pool
pr: 245
date: 2026-11-10
kind: fix
summary: A regular-decision-only summary is no longer held against a college's whole-cycle Common Data Set, and stated rates are compared at the precision they were printed, so a college like Vanderbilt is not flagged for a disagreement that isn't one.
---

## What's new

Nothing changes on a college page today. Colleges whose admissions figures were held because two of their own
documents seemed to disagree will come back on the next nightly read where the "disagreement" was really two
different pools or a rounded percentage.

## Behind the scenes

Vanderbilt's college-reported data was marked Failing. The nightly read had compared its Common Data Set, which
counts the whole admissions cycle (48,196 applicants, 2,593 admitted), with its "regular decision summary" blog post,
which counts only the regular-decision round (43,322 and 1,411). Both documents are right. The check compared any two
documents for the same entering term and ignored the scope the reader had already recorded.

Check 7 now compares two sources only when their term, cohort, and scope all match, and compares acceptance rates at
the precision they were printed (a profile that says "4%" agrees with anything from 3.5% to 4.5%), the same rule the
stated-rate check already used. Six colleges were in this cluster; the Data Steward had not reached it because it
works the largest clusters first and this one was six items among 27,000.
