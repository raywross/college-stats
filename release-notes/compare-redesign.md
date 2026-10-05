---
title: "Comparing colleges the way profiles work: an overview and a page per topic"
pr: 84
date: 2026-10-05
kind: improvement
summary: Compare now opens with the biggest differences and a card per topic, each with a bar per college and a one-sentence takeaway, and every topic has its own page; the full table is one tap away with a differences-only switch.
---

## What's new

Compare two to four colleges and you land on a **short overview**: the school chips and a row of topic pills at the
top, the biggest differences and the radar as before, then a card for getting in, students and campus, academics,
cost and aid, outcomes, and how each has changed. Each card compares two or three figures with a bar per college
and says in one sentence what stands out: "Ohio State costs about $17.6K less a year than Harvard on average;
Harvard's grants cover the largest share of its price." Tap a card for **its own page** with everything the old
comparison showed for that topic, and more: men's and women's admit rates, where students come from, campus chips,
sticker prices side by side, graduation by group. The year-by-year material (the ten-year direction and Then & now)
now sits together on one Over time page.

**All the numbers** is its own page: every row for every college, grouped by topic, with a sticky header, and a
"Differences only" switch that hides rows where the colleges match. Links keep working: every page carries the same
`?ids=` you share today, and the topic pills match the ones on college profiles, so the two read as one map.

For three colleges the overview is about 2,500 pixels on a desktop instead of 10,000, and about 3,700 on a phone
instead of 15,300. Nothing was removed, and every number keeps its ⓘ citation.

## Behind the scenes

Built from [compare-redesign.md](../specs/compare-redesign.md) the way the profile redesign was: a shared foundation
(the topic registry, the table rows grouped by topic, the header's pills, the page frame, the table page) and then
one unit per page, the cards and their sentences, a measurement mode (`npm run measure-profile -- --compare a,b,c`)
that checks each page against the spec's height budgets, a pilot at three widths, and the specs rewritten as built.
A test proves the grouped table still holds exactly the rows the old page did, and the card sentences are tested on
fixture colleges, including ones that report little. Ten subagents built the units on their own branches.
