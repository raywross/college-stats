---
title: "The prompts reader finds the colleges that do publish their essays"
pr: 198
date: 2026-10-30
kind: fix
summary: Harvard, Dartmouth, Villanova and others publish their supplemental essay prompts, but the reader had recorded them as "inside the application"; a link filter that matched "graduate" inside "undergraduate" was the cause, and the reader now follows one more link and refuses graduate schools' pages.
---

## What's new

Several colleges that print their supplemental essay prompts on their own admissions sites were showing on the
Essays tab as "asks its questions inside the application". Villanova, Harvard and Dartmouth are the clearest. On the
next data run their prompts will appear, quoted from their own pages as every other college's are.

Colleges that truly keep their questions inside the application, such as Florida, Boston University, George
Washington and Delaware, read the same as before. Washington turns out to ask only the Common App's own essay, and
will say so.

## Behind the scenes

The link filter that keeps the reader away from blog posts and graduate programs matched the word "graduate" inside
"undergraduate", so every link under an undergraduate-admission path was thrown out; at Villanova the law school's page
was the only one left. The reader now refuses graduate and professional schools' pages outright, follows one more link
when a page mentions the supplement but prints no prompt, takes a start page that prints its prompts further down, and
holds for a person any "inside the application" reading whose own quote counts the questions or describes the Common
App's essay. Eighteen new tests cover the rules; the reader's version is bumped so the next run re-reads every college.
Cornell, whose prompts live on eight per-school pages, is left for a later reader.
