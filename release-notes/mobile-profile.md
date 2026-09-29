---
title: Shorter school profiles on phones
pr: 21
date: 2026-09-29
kind: improvement
summary: Deep dives on phone profiles fold behind Show buttons, cutting a profile's length by almost a third.
---

## What's new

On phones, each profile section keeps its headline answer visible and folds the deep dives behind a dashed "Show …"
button with a one-line hint:

| Section | Still visible | Folded |
|---|---|---|
| Admissions | Funnel, yield, acceptance rate | The 100-square graphic |
| Cost & outcomes | What students pay, price by income, debt, earnings, graduation | Who gets aid, cost vs. earnings map |
| Over time | Takeaway, controls, topic headers | Each topic's charts |
| How it ranks | Four distribution strips | Admissions map |
| Similar | Swipe rail | Full sources list |

Harvard's profile on a phone went from **14,730 to 10,505 pixels** tall. Tablets and desktop are unchanged.

## Behind the scenes

- Folded content stays in the page and is hidden with CSS, so nothing jumps on load and citations stay in place.
- Overview tiles pack densely, so the wide 10-year tile no longer leaves single tiles stranded.
- Charts that start hidden now measure themselves correctly when shown.
