---
title: The event calendar opens on its filters, and "Near me" means near you
pr: 240
date: 2026-11-09
kind: improvement
summary: A college's event calendar now starts with the kind filters and one list, and the "Near me" filter shows the admissions visits within your radius of home or school, not wherever the college happens to be going.
---

## What's new

- **One list, filters first.** A college's event calendar used to open with two short columns, "Next on campus" and
  "Near you", above a longer list headed "Everything on the calendar". The columns had no filters and the list did. The
  page now opens straight into the filters and the list.
- **"Near me" is measured from you.** The filter once labeled "Near you" showed every high school and college fair
  the college's admissions officers visit, anywhere in the country, so a student on Long Island looking at a Texas
  college saw Texas high schools under "Near you". It is now **Near me** and shows only the visits within your alert
  radius of your home or high school, with the miles on each row and a line saying what it measures from. The select
  beside it starts at "Within 30 miles" and lists the states the college visits; pick one to see that state's visits at
  any distance.
- If your account has neither a home nor a located high school yet, Near me shows the whole travel calendar and asks
  for one.

## Behind the scenes

The chip's rows come from a pure `chipEvents` helper in `lib/visit-events/view.ts`, tested in
`tests/visit-events-read.test.mts`; the calendar reads the viewer's visit-alert radius alongside the measuring point.
