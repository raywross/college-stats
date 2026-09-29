---
title: "Trends over time, part 2: scores, students, outcomes, Explore, and Compare"
pr: 14
date: 2026-09-28
kind: feature
summary: History for test scores, students, and graduation joins every profile, and 10-year changes come to Explore and Compare.
---

## What's new

**More history on each profile:**

- **Test scores**: SAT and ACT middle-50% ranges against the median college. The line breaks at the new SAT in fall
  2017, and years when scores weren't required are shaded.
- **Students**: undergraduate enrollment back to 1996, and race and ethnicity from fall 2010.
- **Outcomes**: graduation within six years by the class that *entered* each year, and median debt.
- **"Since" lines** with small sparklines under the Admissions, Students, and Cost takeaways.

**A third Home fact:** 66% of colleges required the SAT or ACT in fall 2019, and 5% did in fall 2024.

**Across colleges:**

- **Explore**: a "Show 10-year changes" switch adds sortable columns for cost, acceptance rate, and applicants.
  Colleges too small for a meaningful change are left out.
- **Compare**: a "Then & now" chart for cost, acceptance rate, applicants, or undergraduates.
- **Profiles**: at most one trend highlight, for colleges in the national top 5%, such as "Applications doubled since
  fall 2014".

## Behind the scenes

- Every college now has history. A new `trends` summary in the dataset holds each college's 10-year changes, and a
  test checks it against the history files.
- The cross-check against the Urban Institute now covers graduation rates, and it fails if a check finds nothing to
  compare. That is how an off-by-one year was caught.
- Fallbacks for outages: cached federal files, and a saved inflation table when the BLS daily limit is hit.
