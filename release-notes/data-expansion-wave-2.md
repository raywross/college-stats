---
title: "Where students come from, what happens to them, and what colleges spend"
pr: 41
date: 2026-10-02
kind: data
summary: Five new kinds of federal data on every college. Where first-years come from, 8-year results for every student who starts, graduation rates for Pell recipients and by race, spending and endowment per student, and full-time faculty share and pay.
---

## What's new

- **Where first-years come from** (Profile → Students): the share from the college's own state, from other states,
  and from abroad, the top five home states, and a state map. "Known for" adds "Draws students nationally" and, where
  most students come from one other state, "Most students are from {state}". Explore can sort by first-years from
  other states and filter to colleges that draw nationally (half or more from other states).
- **Everyone who starts here, 8 years later** (Profile → Cost & outcomes): what happened to every student who
  started, including transfer and part-time students the usual graduation rate leaves out. It shows who earned a
  credential, who is still enrolled, and who went on to another college, with a switch between students who started
  in college here and students who transferred in. Explore has an 8-year completion column and sort.
- **Do lower-income students finish?** (Profile → Cost & outcomes): the 6-year graduation rate for Pell Grant
  recipients next to students with no need-based federal aid, with the gap in points, and the rate by race and
  ethnicity. Groups under 30 students aren't shown. Explore can sort by the Pell graduation gap and how it changed
  over 10 years, and filter to gaps under 5 points. "Known for" adds "Pell students graduate at the same rate".
- **Spending and endowment** (Profile → Academics): instruction spending and endowment per student, compared only
  with colleges that report on the same accounting form, so public and private colleges are never ranked together.
  "Known for" adds "Big endowment per student" (top 5% of its sector).
- **Faculty** (Profile → Academics): the share of faculty who are full-time and the average salary. Explore can sort
  and filter by full-time share.
- **Compare** has rows for all of these, and **Over time** charts how each one changed, most for 10 to 20 years.
- New glossary terms explain each measure, including adjusted cohort, transfer-out, GASB vs. FASB accounting, and
  9-month equated salary.

## Behind the scenes

- **Sources:** all federal.
  - Fall Enrollment part C (fall 2024)
  - Outcome Measures (students who entered in fall 2016)
  - Graduation Rates by Pell and loan status (entered fall 2018)
  - College Scorecard graduation by race
  - Finance (fiscal 2023–24)
  - Salaries (fall 2024)
  - College Scorecard full-time faculty share
- No existing value changed.
- **Detail file:** home-state counts are too big for the main dataset, so each college now has a detail file with
  its own checks. Majors will use it next.
- **Edge cases, kept as reported or treated as unreported:**
  - Colleges report residence every other fall, so its history has a point every two years.
  - About 20 colleges report Pell gaps over 40 points, which usually means students were sorted into groups
    inconsistently. They're shown with a caution but not ranked.
  - Three colleges reported $0 of instruction spending; that's treated as not reported.
  - The 8-year results show where students enrolled, not whether they finished there, so "Known for" says "go on to
    another college".
- **Wave 2 is complete:** residence, outcome measures, graduation by group, finances, and faculty join
  student-to-faculty ratio, campus profile, and campus services. Metro area stays deferred. Next on the
  [roadmap](/roadmap): majors and earnings by major.
