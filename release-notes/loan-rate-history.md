---
title: Borrowing over time
pr: 29
date: 2026-09-29
kind: data
summary: A new chart shows how the share of students with a federal loan changed since 2008–09, and Explore can sort by the 10-year change.
---

## What's new

- **Over time → Aid**: an "Undergrads with a federal loan" chart from 2008–09, with the national middle-50% band. The
  median college's share fell about 12 points over 10 years.
- **Explore**: a "Borrow, then → now" column in the 10-year changes view, and a "Borrowing change" sort. Colleges with
  fewer than 300 undergraduates are left out.

## Fixed

A browser warning in Explore's 10-year changes table, introduced in the [previous release](loans-and-repayment.md).

## Behind the scenes

- The history rebuild only added the new series; nothing else changed.
- Six colleges (the four service academies and two small colleges) reported 0% years ago and have no current rate, so
  their lines correctly end early. Every college that reports the newest year must still match its profile exactly.
