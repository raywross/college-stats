---
title: The plan and the essay page stop waiting in line
pr: 227
date: 2026-11-08
kind: improvement
summary: The plan makes its database reads in two rounds instead of four, an essay opens in one round instead of seven with its notes already there, and the header's account check is a single call.
---

## What's new

The plan and its tabs, and opening an essay, should feel quicker for everyone who is signed in: a student, a
parent, or a counselor. The notes panel on an essay no longer loads a moment after the page does; it arrives with it.
Nothing on the screen changes.

## Behind the scenes

The production timing lines turned on in the last release showed where the time went. The plan asked the database
four questions in a row before it could render; now it asks everything it can at once and only the estimate's
high-school lookups wait, and only for the profile. An essay's page asked seven questions in a row and then the
browser asked an eighth for the notes; now one database function returns the draft, its versions, comments,
suggestions, reviews, and the colleges on the student's list together. The header's account check is one call too.

We also measured the second a cold server spends loading the college data: nearly all of it is parsing one 36 MB
file, half of which is the citation history behind every figure. Splitting that history into its own file at publish
time is the next item on the list.
