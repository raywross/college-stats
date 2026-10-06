---
title: High schools
pr: 89
date: 2026-10-06
kind: feature
summary: A page for every U.S. high school, public and private, with AP and dual-enrollment access, graduation and college-going rates, and how each compares with its state.
---

## What's new

- **A page for every high school.** About 27,800 public and 7,600 private high schools, each at
  `/high-schools/…`. You'll see the school's district, grades, enrollment and student-to-teacher ratio, and how
  each figure compares with the median public high school in its state.
- **Rigor.** How many AP courses a school offers, the share of students taking one, IB, and dual enrollment, from
  the federal Civil Rights Data Collection.
- **Outcomes.** The four-year graduation rate for every public high school with one, from the U.S. Department of
  Education. Small schools often have a range instead of a single number, and we show it that way. Seven states add
  their own report-card figures: California, Texas, New York, Florida, Illinois, South Carolina and Connecticut.
  Depending on the state, that means the share of graduates who go on to college, test proficiency, chronic absence,
  AP pass rates, and (in South Carolina and Connecticut) college enrollment and persistence from the National
  Student Clearinghouse.
- **The school's own profile, where we have it.** Roslyn High School (New York) is the first. Its page shows the
  grading scale and course weights, mean SAT and ACT, its AP courses, and the 144 colleges that admitted members of
  the Class of 2026, each linked to its college page. Where the profile is newer than the federal or state figure
  (graduation rate, college-going rate, AP results, enrollment), the school's figure is the one shown, and its ⓘ
  says what it replaced.
- **Search** by name and state at **High schools** in the menu.
- **Your high school on your profile.** On **Me**, the high school field now searches this list. A typed name still
  works when your school isn't listed.
- Every figure has its source and year in its ⓘ. Counts under five are never shown; the page says "fewer than 5"
  instead. There are no grades, ranks or scores, only descriptions and the state comparison.

## Behind the scenes

- A new high school dataset with its own sync (`npm run sync-high-schools`, `npm run sync-hs-states`), field-level
  lineage, validators, and a Supabase table searched by name. NCES CCD 2024–25, CRDC 2023–24, the 2023–24 Private
  School Survey, and ED Data Express graduation rates (Class of 2021, the newest school-level file published).
- Each state report-card adapter reads that state's own published files and maps its school ids to NCES ids.
- A pilot for reading schools' own profile PDFs (grading scale, GPA spread, where graduates enroll). Its discovery
  and matching have run; extraction runs from a GitHub workflow where the API key lives, once this ships.
