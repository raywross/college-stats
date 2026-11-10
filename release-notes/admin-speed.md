---
title: The admin console gets fast
pr: 243
date: 2026-11-10
kind: improvement
summary: The admin console stops reading its 22,000-item review queue whole, reads the snapshot small, shares reads between the badge and the Inbox, streams the Inbox in panels, and takes GitHub off the page's path.
---

## What's new

Nothing changes for visitors. For the console's admins, every page is quicker and the Inbox paints its frame at
once and fills in panel by panel.

## Behind the scenes

The review (`specs/product/admin-speed.md`) found five causes, and this build removes four of them:

- **The review queue is never read whole by a page.** The queue's 21,977 open items used to be read in 22
  sequential pages (2.6 s, 12 MB) whenever an instance's cache was cold, and twice per Inbox load; the check that
  decided whether the cache was still good scanned the whole document table. A read model, `review_items`, now
  mirrors the queue's documents through a trigger, so the console counts, filters, and reads one college's items in
  SQL, and the Findings clusters get every item in one round trip. The documents stay the write path and the
  version history.
- **The snapshot row is read small.** Every console page read a 446 KB row to show one badge; it now reads a few
  columns, and the Size shown on Published versions comes from a computed field in Postgres.
- **The Inbox streams, and shares its reads.** The shell renders first; "Needs you", "The Steward did", and "How
  things are" each stream in. The badge in the rail and the Inbox read each source once per request.
- **GitHub is off the response path.** The jobs' last runs come from a per-instance memo refreshed in the
  background.
- **Fewer round trips.** The college page reads in 2 waves instead of 7, a person in 5 instead of 12, a student in 6
  instead of about 16, a household in 3 instead of 5. Every admin route now logs a timing line, so the next review
  measures instead of estimating.

Two migrations (dev first, then prod): `20261110120000_admin_speed.sql` (the index, the read model and its trigger,
the two read functions) and `20261110130000_snapshot_bytes.sql` (the computed size). Both are additive and the code
falls back without them. The fifth cause, the database's compute size and the visit-events sync's single-row writes,
is wave 3 of the spec, left for later with the owner.
