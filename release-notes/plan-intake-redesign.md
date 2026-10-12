---
title: "Plan: a two-minute setup and a calmer plan page"
pr: 132
date: 2026-10-11
kind: improvement
summary: Plan now starts with a short four-step setup (grades, test, AP courses, review), groups your colleges under Reach, Target, and Likely, opens the calendar on the next eight weeks, and shows parents their child's plan first.
---

## What's new

**A four-step setup.** The first time you open Plan, a short guide asks for your grades, your test, and your AP
courses, then shows them back to you before saving. It takes about two minutes, and the ✎ next to your numbers
opens it again to change anything.

- **GPA on any scale.** Type your GPA the way your transcript shows it. The site works out whether it's a 4.0,
  weighted 5.0, or 100-point scale (over 100 is fine), and you can change it if it guesses wrong.
- **One test, and a goal.** Pick SAT or ACT (or neither), add your best score, and optionally the score you're
  aiming for. The Scores tab then says how many colleges that score would move up a group.
- **AP courses in a few taps.** Search ("calc", "apush") or tap a popular course. If you took it, add the exam
  score; if not, pick when you'll take it.

**A calmer plan page.** Above the tabs you now see only your numbers and what's due next. Your colleges sit under
Reach, Target, and Likely headings. On a computer, a side column shows Next up, the coming weeks, and at most one
suggestion.

**The calendar starts with the next eight weeks**, as a dated list. "Full year" still shows the whole school year.

**Parents see their child's plan first.** Switch between children with the name pills at the top. A "Your part"
line shows the one task that's yours. A younger child's plan says there's nothing due this year until they pick
rounds.

## Behind the scenes

Reach, Target, and Likely now always come from Quad's estimate, so there is no longer a way to change a college's
group by hand. The target score and AP course timing are saved with the rest of the student's profile. Built in
five parts on separate branches, checked in a browser on a phone and a computer, and merged together.
