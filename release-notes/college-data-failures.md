---
title: "A list of colleges whose own figures we couldn't get"
pr: 116
date: 2026-10-10
kind: infra
summary: "We now keep a list of every college whose own published figures we couldn't read yet, with the reason, so we can look into them and fix the gaps."
---

## What's new

Nothing changes on the site. For many colleges we show figures they published themselves, such as a newer admission
rate from their Common Data Set. For the rest, we now keep a list of where it went wrong and why: no document found,
the college's site blocks automated visitors, a link that no longer works, a document too old to be newer than the
federal figures, or figures that didn't pass our checks. We will use it to decide which colleges to look up by hand
and which steps to improve next.

## Behind the scenes

- `npm run college-failures` builds `data/college-failures.json` from the data pipeline's own files: one row per
  college and reason, from a fixed set of 14 reason codes, with the stage (finding, fetching, reading, or checking),
  a short detail, the link, the edition, and when the row was first and last seen. The first list has 2,115 rows for
  1,871 colleges.
- Every data update rebuilds the list, and after each production deploy it is loaded into a new database table that
  only the service key can read. Rows that drop off the list are marked resolved, not deleted.
- See `specs/college-data-failures.md` for the reason codes and example queries.
