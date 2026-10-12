---
title: "Where the students went, which colleges are really online, and which states gain first-years"
pr: 139
date: 2026-10-12
kind: feature
summary: A seventh national trend study follows undergraduates to the biggest campuses and research universities over ten years and asks what the pandemic did; every college now shows how much of it is online; each state's page shows the first-years it gains from and loses to other states.
---

## What's new

**[Where the students went](/trends/where-students-go)**, Study 7 of the national trends. The site's other studies tell
the story college by college (half of colleges are smaller than ten years ago). This one follows the students: what share
of all campus-based undergraduates attend each kind of college, then and now.

- About a third of campus-based undergraduates now attend a college with 20,000 or more students, up from under a third
  ten years ago, and research universities' share rose by more than five points. Colleges outside the research tiers lost
  a sixth of their students.
- The pandemic is treated as a question inside the ten years: the page splits the decade into before, pandemic, and
  after, and shows each group's pace of change in each period, so you can see what sped up and what has (and hasn't)
  reversed since the low point. The "after" period is two falls long today and the page says so.
- The Midwest lost share; the Sun Belt gained. The copy says this follows where 18-year-olds live and sends you to the
  state pages rather than ranking states.
- Price moved with enrollment, not against it: the colleges that cut what students pay the most lost the most students.
  A Colleges / Students switch shows both views, and the students view shows that the real fall in price is a
  post-2021 inflation story.
- Online-first colleges, for-profits, and campuses that merged are set aside, and the page shows why first: without
  that cut, online growth at a few colleges would hide the loss at private campuses.

**How much of each college is online.** Every profile's Students page now says what share of undergraduates take every
course online (and how many take some), from the federal distance-education counts. Explore has a Campus-based /
Mostly online filter, and cards for mostly-online colleges carry a chip. The rule that keeps online colleges out of the
"grew the most" lists and campus-based trends is now a stored, yearly measure rather than a hand-reviewed list, so it
updates with each federal release. A college counts as online-first when more than half of its undergraduates take every
course online; the pandemic falls of 2020 and 2021 are read at fall 2019.

**First-years crossing state lines**, on [every state's page](/trends/states): how many first-years the state's colleges
enroll from other states, how many of its residents start college elsewhere, the net, and the five colleges taking the
most of the inflow. The state map has a sixth measure, net first-year inflow, and the table three new columns. Only
campus-based colleges count on both sides, so a state with one huge online university no longer looks like a magnet.

**[Shrinking colleges](/trends/shrinking-colleges)** gains a "Campus-based only" switch, so you can see the size and
for-profit rows without online growth in them.

## Behind the scenes

- New IPEDS file family, `EF{Y}A_DIST` (fall 2012 on): two stored fields and one history series, cited like every other
  figure. The sync checks that every row adds up and that the undergraduate count agrees with the enrollment figure.
- The reviewed `online-first.json` list was retired after the stored rule reproduced it exactly (110 of 110 colleges).
  Growth lists and campus-based panels now check both ends of a window, because a college that went online-first inside
  the window grew by going online.
- Study 7 classifies size and selectivity as of the window's start, a stated departure from the hub's "today's
  classification" rule, and its test flags any group whose pace flips sign once the after period reaches four falls.
- State flows are summed from the per-college home-state tables for the newest even fall; a test checks that every
  state's inflow adds up to every other state's outflow.
