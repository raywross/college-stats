---
title: "Fix: graduation rates by Pell status from colleges' own reports"
pr: 123
date: 2026-10-11
kind: fix
summary: Fourteen more colleges now show graduation rates by Pell Grant status for the class that entered in fall 2019, from their own Common Data Sets, because our checks now compare each college's figures with the matching federal class.
---

## What's new

Fourteen more colleges, including Vanderbilt, William & Mary, the University of Illinois, Michigan, and UNC, now show
how many Pell Grant recipients, subsidized-loan borrowers, and other students graduated within six years for the
class that entered in fall 2019. That class is one year newer than the federal data, and the figures come from each
college's own Common Data Set. Where we show it, the ⓘ still gives the federal figure for the class before.

## Behind the scenes

We check every figure a college reports against federal data before we show it. For graduation rates, those checks
compared the wrong things:

- **The wrong class.** A Common Data Set reports two entering classes. Which one matches federal data depends on the
  year of the report, and the checks always used the same one. A college's 2024–25 report was compared with a class one
  year off, and older reports were compared with classes up to eight years off.
- **The wrong students.** The federal figure we compared with counts every first-time student. The Common Data Set
  counts only students working toward a bachelor's degree. At about 500 colleges with associate or certificate
  students, the two never match. We now keep the federal figure for bachelor's students too, and compare with that.
- **A newer class held to an older one.** When a college's older class matched federal data to the student, its newer
  class was still sent for review if it was very different from the older one. Classes do change from year to year.
  Iowa State's group with subsidized loans went from 1,604 students to 986.
- **Rates printed as decimals.** Some colleges print a 94.5% graduation rate as "0.945". We read that as 0.945%.

The checks still catch a college whose own report disagrees with what it told the federal government. They still
catch a table read with its columns swapped, and a jump with no older class to confirm it. Those go to review, as
before. In our test runs, about 1,700 of the 4,000 graduation figures held for review now pass. About 25 more
colleges' fall 2019 classes will appear once their reports are checked again.
