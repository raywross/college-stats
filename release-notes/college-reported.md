---
title: "Newer admissions figures, straight from the colleges"
pr: 50
date: 2026-10-02
kind: feature
summary: An automated reader now collects each college's newest published admissions figures, checks them, and shows them on the profile next to the federal numbers, with the exact quote and link.
---

## What's new

- **Fresher admit rates.** Federal admissions data runs about a year behind. Many colleges post their newest class
  profile or Common Data Set much sooner. When a college has, its admissions page shows "Admit rate, Fall 2026 …
  reported by the college" with the federal figure and its year right underneath.
- **Every figure shows its evidence.** The ⓘ next to a college-reported number opens the exact sentence it came from,
  a link to the college's page or file, and the day it was read.
- **Comparisons stay fair.** Explore, Compare, ranks, medians, and the home page keep using federal data, the newest
  year every college reports. A short note on Explore and Compare says so. The newer figures appear only on profiles.
- **How it works, on the Data page.** A new section explains what is collected, the seven automatic checks a figure
  must pass, what happens when one fails, and how many colleges have newer figures right now.

## Behind the scenes

- A pipeline (`npm run sync-college-reported`) learns once where each college publishes (a stored recipe), re-reads a
  document only when it changed, extracts the figures with a fixed schema and a verbatim quote per number, and runs
  the checks: first-year and all rounds only, quote contains the number, admitted ≤ applicants ≤ …, stated rate
  matches the counts, newer than the federal year, plausible change, and agreement between documents. Failures go to
  a review queue and are never published.
- A scheduled GitHub Action runs it and opens a pull request with the changes, the review queue, and the run's cost;
  a circuit breaker stops auto-merge when too many colleges fail or too many values change at once.
- A 50-college pilot set with a hand-checked answer key and a scoring script measure hit rate and accuracy by
  selectivity tier before the schedule is turned on.
- Guards: every college-reported value must carry its document, quote, year and date, or the sync refuses to write;
  a test keeps these values out of every comparison view.
