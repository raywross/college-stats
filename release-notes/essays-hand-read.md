---
title: "Essay questions read from the application, live the moment they're entered"
pr: 199
date: 2026-10-30
kind: feature
summary: For colleges that print their essay questions only inside the application, a person can now read them from the form and enter them on the admin console; they show on the Essays tab at once, marked "from the application form, read by hand".
---

## What's new

Some colleges, Florida among them, never publish their essay questions on their own site; the questions exist only
inside the application. Until now their card said so and left the student to add each question by hand.

Now a person with an application account can read a college's questions from the form and enter them once, on the
admin console. The moment they're saved they appear on every family's Essays tab for that college, in the prompt
picker, in the package, and in the essays move on Next steps, each marked **"From the application form, read by hand
on {date}"** with a link to the application's home page. A college's own published page still wins over a hand read.

The college's public page catches up overnight: a nightly job writes the hand-read questions into the dataset the
way every other fact arrives, with its citation, so the "What it takes to apply" card shows them the next day.

For a college we still have nothing for, the line now says why: "{College} doesn't publish its questions on its
site; they're inside the application. Add each one here as you meet it."

## Behind the scenes

The console's new Essays section lists the colleges on families' lists whose questions are missing, most-listed
first, and opens a form per college: the cycle, which application it was read in, the date and the reader's initials,
a paste box that splits the questions into rows, and the usual fields per question, checked before anything is saved.
Saves go to a table only admins can write, through logged functions; the advisor overlays that table on the dataset
at request time with one cached query. A nightly export mirrors the rows into the repository and opens the usual data
pull request, so the static pages, the lineage checks, and the citation trail stay as they were. Tests cover the rules,
the policies, and a real-data proof on Florida that lineage passes and re-merging is stable.
