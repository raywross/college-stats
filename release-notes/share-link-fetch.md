---
title: "Common Data Sets shared through Box or Google Drive can now be read"
pr: 143
date: 2026-10-13
kind: fix
summary: Our reader now downloads a college's Common Data Set when it is shared through Box, Google Drive, or SharePoint, starting with UT Austin's 2025–26 report.
---

## What's new

- **More colleges' own reports can be read.** Some colleges post their Common Data Set (the standard yearly report of
  admissions, enrollment, and costs) through a file-sharing service such as Box or Google Drive. Following one of those
  links opens a viewer page, not the file, and our reader had been saving that empty viewer page instead of the
  report. It now asks for the file itself. UT Austin's 2025–26 report is the first one fixed, which will add its
  admit count and acceptance rate for fall 2025. Georgetown, Mount Holyoke, Binghamton, Notre Dame, and Tulane had the
  same problem.
- **Problems like this no longer go unnoticed.** When a college's report can't be downloaded, it now shows on our
  list of colleges to look into, even if a news release already gave us some of its figures.

## Behind the scenes

- `acquireSource` in `scripts/lib/college-reported/phases.mts` fetches every CDS on a share host at its direct-download
  form (`rewriteShareLink`), whichever discovery step found it. The recipe and manifest keep the link the college
  publishes. An HTML document archived earlier for that link is ignored.
- An answer that isn't a PDF or Excel file is not archived. The source is queued `unreachable` with a note to
  download it by hand and run `archive-doc`.
- A CDS that fails to fetch is queued even when a class profile published, so `college-failures` lists it. Those
  fetch-only items are replaced by the next fetch of that college's sources.
- New tests in `tests/cds-pipeline.test.mts`. Tested on UT Austin's live Box link: the direct form returned the
  2025–26 PDF. The decision is recorded in `specs/college-reported-round-3.md`, Decision 8.
