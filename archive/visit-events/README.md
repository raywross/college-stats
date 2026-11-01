# Visit events archive

Rows archived out of the live `visit_events` table so the database fits its plan (owner, 2026-10-31: "archive the old
data and store it in git in case we need it later and then delete it"). The table held 405,778 events of which
150,521 had either already started or had been removed from the college's calendar (`removed_at` set); those are
here. The 255,257 live, upcoming events stayed in the table. Public college calendar facts, no personal data.

| File | What |
|---|---|
| `visit-events-archive-2026-10-31.ndjson.gz` | One `visit_events` row per line as JSON, every column, 150,521 lines, gzipped |
| `restore-visit-events.mjs` | Puts the rows back: `SUPABASE_DB_URL=postgres://… node restore-visit-events.mjs visit-events-archive-2026-10-31.ndjson.gz` (needs `npm i postgres`). Rows already present are left alone |

Why these and not a date cutoff: the daily sync keeps every upcoming event it has seen, so nearly nothing was "old"
by `starts_at`; the archivable rows are the ones the site would never show again. The sync should prune the same way
on a schedule (a follow-up for the visit-events feature); until it does, a new archive file can be added here with its
date.
