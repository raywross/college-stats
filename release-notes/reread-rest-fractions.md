---
title: "Graduation rates printed as fractions read correctly"
pr: 131
date: 2026-10-11
kind: data
summary: Graduation rates that colleges print as fractions, such as 0.945, are now stored correctly, and five more colleges show graduation rates by group.
---

## What's new

**Rates printed as fractions are read correctly.** Some colleges, including Yale, Georgia, and Vassar, print graduation
rates as fractions (0.945) instead of percents (94.5%). Those had been read as a fraction of a percent and held back.
They're now corrected, and five more colleges show graduation rates for Pell, loan, and other students: Georgia,
Vassar, Pratt, St. Mary's College of Maryland, and Eastern Oregon.

## Behind the scenes

A one-time script corrected 128 saved values in 24 documents, using the number printed in each value's own quote, with
no new downloads or model calls; the two documents whose quote doesn't print the exact number were left as they were.
A free re-check then passed 310 graduation values. The data workflow also gains a "reextract" option for re-reading a
call from saved copies after a future schema change.
