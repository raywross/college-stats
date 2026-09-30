---
title: "Student-to-faculty ratio, and a new Academics section"
pr: 38
date: 2026-09-30
kind: data
summary: Profiles show each college's student-to-faculty ratio against every other college and how it has changed since 2009, and Explore can sort and filter by it.
---

## What's new

- **Profile → Overview**: the student-to-faculty ratio, such as "5 to 1", and how it compares with other colleges.
- **Profile → Academics**: a new section with where the college sits among all colleges, and a reminder that the
  ratio isn't average class size. Class sizes, faculty, and majors will join it.
- **"Known for"**: "Very small student-faculty ratio" for the colleges with the fewest students per faculty member
  nationally (the lowest 5%).
- **Explore**: sort by fewest students per faculty member, and filter to 8, 10, 12, or 15 or fewer.
- **Compare**: a row for the ratio.
- **Over time**: a new Academics group charts the ratio year by year, against the national middle half.

## Behind the scenes

- From the federal Fall Enrollment survey, fall 2024, with history back to fall 2009. No existing value changed.
- Colleges compute the ratio themselves, so small changes can come from how they count faculty.
- Over time now shows small numbers' changes as "9 → 8" instead of a percent, which also fixes the percent shown for
  very small applicant pools.
- Fixed: the profile's section links hid "Campus life" for some colleges that have sports or programs data but no
  housing data.
- Third of the eight wave 2 specs on the [roadmap](/roadmap):
  [student-faculty-ratio.md](../specs/data-expansion/student-faculty-ratio.md).
