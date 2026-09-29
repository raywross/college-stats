---
title: Median debt chart fixes
pr: 24
date: 2026-09-29
kind: fix
summary: The median debt chart no longer breaks under "All years", and its last point now matches the headline above it.
---

## What was wrong

Two bugs in the profile's **Over time → Outcomes → Median debt at graduation** chart:

1. **Broken drawing under "All years".** Median debt goes back to 1997, but the inflation table starts in 2000. The
   national band couldn't convert the earlier years and drew invalid shapes, with 18 errors on the page.
2. **The line and the headline disagreed.** The series ends in 2020–21, but the line was converted to later dollars, so
   it ended near $23,000 under a "$19,500 · 2020–21" headline.

## What changed

- After inflation, the chart now starts at 2000–01. With "As reported", it still starts at 1997.
- A chart whose data ends early is shown in its own last year's dollars, and the note says so: "After inflation, in
  2020–21 dollars." Every other money chart ends in the latest year, so nothing else changes.

Checked on six profiles with "All years" on, plus Explore and Compare: no errors.
