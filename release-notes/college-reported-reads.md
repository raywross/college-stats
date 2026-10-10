---
title: Reading the college documents we found
pr: 114
date: 2026-10-10
kind: fix
summary: Common Data Sets that don't print their year on the cover, class profiles posted as PDFs, and colleges whose sites have one odd link are now read instead of skipped.
---

## What was wrong

When the site looks for a college's newest admissions figures, it finds the college's own documents and reads them.
Some it found were never read:

- **Common Data Sets with no year on the cover.** Marquette's 2025–26 Common Data Set prints "2025-2026" on its cover
  but the words "Common Data Set" are a picture, so the year wasn't recognized and the file was set aside. About 50
  colleges' files were in the same spot, most with the year only in the file name.
- **Class profiles posted as PDFs** were read as if they were web pages, so nothing useful came out of them.
- **One odd link on a college's site** (Western Carolina's home page has a template placeholder for a link) stopped
  the search for that college's documents entirely. 38 colleges were affected.
- **A mistyped link.** For Santa Clara, the search returned the right page and a link to its 2025–26 Common Data Set
  with one folder name wrong, so the file was never downloaded.

## What changed

- The year now comes from the cover even when only the years are printed, or from the file name
  (`cds-2025-2026_final.pdf`). A file that states its year nowhere is read once under the current year, and its
  figures are published only if the file's own text confirms that year; otherwise they wait for a person to check.
- PDF class profiles are read page by page, like other PDFs, and ones read the old way are read again.
- Links the search suggests are checked before they count: a page that doesn't exist is dropped and the search keeps
  going, and a mistyped Common Data Set link is replaced by the same year's link on the college's own list of files.
- An unreadable link is read as written instead of stopping the search.

These colleges are picked up by the next run.

## Behind the scenes

Georgia Tech's published fall 2025 figures came from a class-profile PDF read the old way; the numbers aren't in that
file's text, so they should be checked by hand. The fixes are described in
[the round 3 spec](../specs/college-reported-round-3.md), and `scripts/college-reported-rerun-ids.mts` lists the
colleges to run again by reason.
