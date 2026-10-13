---
title: "231 more colleges' Common Data Sets are on our reading list"
pr: 142
date: 2026-10-13
kind: data
summary: We found the published Common Data Set of 231 more colleges through the open archive at collegedata.fyi, so their own newest figures can follow in the next updates.
---

## What's new

- **231 more colleges' own reports are now on our reading list.** A Common Data Set is the standard report a college
  publishes each year about its admissions, enrollment, costs, and aid. Our reader had not found one for these
  colleges, mostly because the file sits on a Google Drive or on a page our search never reached. The open archive at
  [collegedata.fyi](https://www.collegedata.fyi) had already found them, so we added each link to our list. Colleges
  on it include UC Irvine, UC Davis, UC Santa Barbara, NYU, Ohio State, Arizona State, Cal Poly, Penn, Brown,
  Princeton, Johns Hopkins, Notre Dame, Tulane, and Caltech.
- **The figures themselves still come from each college's file.** We read every report ourselves, so each number on
  the site keeps its quote from the document and a link to the original. Nothing is copied from another site. Their
  figures arrive with the next updates, a batch at a time.

## Behind the scenes

- `data/reference/cds-urls.json` (the owner's list, step 0 of discovery) gains 231 entries, each with the edition and
  format collegedata.fyi recorded and our own failure reason in `note`. Google Drive links are written in the
  `drive.google.com/uc?export=download` form that `rewriteShareLink` produces; the pipeline decides the format from
  the bytes, not the URL.
- 98 are 2025-26 filings, 131 are 2024-25, and 2 are 2026-27. A 2024-25 filing is not newer than federal admissions
  data (fall 2024), so those colleges gain only the blocks without a federal counterpart: GPA, aid, cost, and the
  graduation grid.
- Left out: links with expiring Google Sheets or Box tokens, documents their site could not extract, and one HTML
  listing page. The evaluation itself is in the memory note `collegedata-fyi.md`.
