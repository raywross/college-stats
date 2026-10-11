# College Data Failures (research list)

> Status: **built** 2026-10-10 (branch `feat/college-data-failures`). Asked for by the owner on 2026-10-10: "start
> building a list of schools where we've failed, with a reason code of some kind and add that to a table in the DB.
> We can use that to research later." Part of [college-reported-data.md](college-reported-data.md).

A list of the colleges where the college-reported pipeline didn't get to published figures, with one row per college
and reason. It is for research (which colleges to look up by hand, which pipeline step to fix next), not for the site:
nothing on the site reads it.

## How it is built
- **`npm run college-failures`** (`scripts/college-failures.mts`, logic in `scripts/lib/college-failures.mts`) reads
  the pipeline's committed state and writes **`data/college-failures.json`**. No network, no API key. Inputs:
  `data/college-sources.json` (recipes: sources, `discovery.tried`), `data/review-queue.json` (held values),
  `data/college-docs.json` (the archive manifest), `data/cds-records/` (which documents were read),
  `data/reference/blocked-hosts.json`, `data/schools.json` (name, the `reported` block, the federal admissions year),
  and the previous `data/college-failures.json` (for `first_seen`).
- **The data workflow** (`.github/workflows/college-reported.yml`) runs it after `merge-reported` and `build-trends`
  in both the run and the collect jobs, so every data PR carries an updated file.
- **`npm run publish-college-failures`** (`scripts/publish-college-failures.mts`) loads the file into the Supabase
  table `college_data_failures` after each successful production deploy (the `college-failures` job of
  `.github/workflows/publish-changes.yml`, same trigger and `PROD_SUPABASE_*` secrets as the change log). Rows in the
  file are upserted with `resolved_at` cleared; rows still open in the table but gone from the file get `resolved_at`
  set. Nothing is deleted. Without the table (migration not applied) it warns and exits 0; `--dry-run` counts only.
- The generation date (`generated`, `last_seen`, a new row's `first_seen`) is the newest `updated` date of the state
  files, so regenerating unchanged state changes nothing. `--date` overrides it.

## Which colleges are listed
A college is listed when its recipe shows the pipeline tried it (a discovery attempt or a source) and:
- it has **no `reported` block** in `data/schools.json`: every reason found at every stage is listed (a college can
  have several, e.g. `edition_too_old` and `never_read`); or
- it **has a `reported` block** but the review queue holds values from its newest edition, or a source of it failed
  to fetch: only those review-queue reasons are listed.

Review-queue items from an edition older than the college's newest archived CDS are ignored (superseded). A college
the pipeline never tried isn't listed.

## Columns
| Column | Meaning |
|---|---|
| `unit_id`, `name` | The college (IPEDS unit id), its name from `data/schools.json` |
| `reason_code` | One of the codes below. Primary key: (`unit_id`, `reason_code`) |
| `stage` | Where it failed: `discovery`, `fetch`, `read`, or `checks` |
| `detail` | Short text, in the pipeline's words where it has them (≤ 300 characters) |
| `url` | The document or link concerned, when there is one |
| `edition` | The CDS edition (`2025-26`) or the term a class profile describes (`Fall 2025`), when known |
| `checks` | `failed_checks` only: the check ids that held values, most frequent first |
| `last_run` | Date of the newest pipeline evidence for the row (attempt, fetch, archive, or review-queue date) |
| `run` | The pipeline run id, when the evidence names one (review-queue rows) |
| `first_seen`, `last_seen` | First and newest generation of the file that listed the row; `first_seen` is kept across regenerations |
| `resolved_at` | Table only: set when the row left the file; cleared if it comes back |
| `loaded_at` | Table only: when the load last wrote the row |

## Reason codes
| Code | Stage | Meaning | Example (from the first file) |
|---|---|---|---|
| `no_document_found` | discovery | Discovery ran (free probes, and the paid steps the college's tier allows) and found no CDS or class profile | University of Alabama at Birmingham: "tried probe-sitemap, probe-host, probe-crawl; nothing found" |
| `class_profile_only` | discovery | Only a class profile was found, no Common Data Set | Connecticut College's admission statistics page |
| `class_profile_no_figures` | read | Only a class profile, and reading it gave no admissions figures | Auburn University's incoming-students page |
| `robots_disallowed` | fetch | robots.txt refuses the page; `url` is the refused document or share link | Colorado School of Mines' `CDS23.pdf` |
| `host_blocked` | fetch | Bot protection or a 401/403/405/429 on the college's host(s): every candidate host refused (discovery), a source's host is in `blocked-hosts.json`, or the college is listed there | American University: "every candidate host refuses us: www.american.edu" |
| `unreachable` | fetch | HTTP 404/5xx, a failed fetch, or a share link answering an error | Arkansas State's `cds-2025-2026.pdf`: "HTTP 404" |
| `edition_too_old` | checks | The newest CDS (or the term a class profile names) is older than the federal admissions year we already show | Emporia State: newest CDS 2017-18; federal fall 2024 |
| `not_newer` | checks | The same year as the federal figures, so nothing newer to publish | Florida State: "entering term 2024 isn't newer than the federal admissions year 2024" |
| `edition_unknown` | read | A document was archived but its year couldn't be detected (or a class profile names no term) | University of Arkansas' `cds25-26v2.pdf` |
| `never_read` | fetch or read | Found but never fetched, archived but never read, a scanned PDF (nothing reads it yet), or its batch request failed | University of Alaska Fairbanks' 2020-21 CDS |
| `failed_checks` | checks | Values held in the review queue; `checks` names the checks (parts-sum, federal-disagrees, number-on-line, …) | The University of Alabama: "122 value(s) held; failed checks: number-on-line ×75, parts-sum ×40, …" |
| `read_no_values` | read | *Added from the data:* a CDS was read, nothing was held, and still nothing published (a partial CDS) | Eastern Connecticut State's two-page `cds-2025-26a.pdf` (section A only) |
| `malformed_url` | discovery | A URL that doesn't parse stopped discovery ("URI malformed", "Invalid URL") | San Diego State: "discovery: URI malformed" |
| `discovery_error` | discovery | Any other discovery error, e.g. an aborted request | Albany State: sitemap "no complete answer in 60 s; aborted" |

The codes are a fixed set: `REASON_CODES` in `scripts/lib/college-failures.mts` and the table's check constraint
list the same codes (a test keeps them in step). A new code needs both, plus a migration that replaces the check.

## Counts in the first file (2026-10-10)
2,115 rows for 1,871 colleges: `no_document_found` 1,419; `failed_checks` 202; `host_blocked` 176;
`class_profile_no_figures` 73; `never_read` 48; `edition_unknown` 47; `malformed_url` 36; `robots_disallowed` 30;
`unreachable` 30; `class_profile_only` 24; `edition_too_old` 15; `not_newer` 9; `discovery_error` 5;
`read_no_values` 1.

## The table
`supabase/migrations/20261010140000_college_data_failures.sql`: `public.college_data_failures`, the columns above,
primary key (`unit_id`, `reason_code`), indexes on `reason_code` (and on open rows by `reason_code`). Row-level
security is on with no policies, and `anon`/`authenticated` hold no privileges: only the secret key (service role)
reads or writes it. Query it in the SQL Editor or with the secret key.

## Queries
```sql
-- Colleges blocked by robots.txt, with the CDS link they refused
select unit_id, name, url, detail
from college_data_failures
where reason_code = 'robots_disallowed' and resolved_at is null
  and (url ilike '%cds%' or url ilike '%common%data%set%')
order by name;

-- Open failures by reason
select reason_code, count(*) from college_data_failures where resolved_at is null group by 1 order by 2 desc;

-- Colleges whose values failed the federal comparison
select unit_id, name, edition, detail
from college_data_failures
where reason_code = 'failed_checks' and resolved_at is null and 'federal-disagrees' = any(checks);

-- What got fixed in the last month
select unit_id, name, reason_code, resolved_at
from college_data_failures
where resolved_at > now() - interval '30 days' order by resolved_at desc;
```
The same questions work on the file: `jq '.rows[] | select(.reason_code == "robots_disallowed")' data/college-failures.json`.

## Tests
`tests/college-failures.test.mts`: the classifier on hand-made state (one college per reason code, plus a published
college listed only for held values, one with nothing held, and one never tried); queue checks mapped to codes;
`first_seen` kept across regenerations; the load's upserts, resolved rows, a row that comes back, and a dry run (fake
client); the migration as text (RLS on, no policy, no grant to anon/authenticated, every code in the check) and
against PGlite (the service role writes; anon and authenticated are refused).

## Owner steps
- Apply `supabase/migrations/20261010140000_college_data_failures.sql` in the dev project's SQL Editor. Until then the
  load warns and exits 0 after each deploy. The `PROD_SUPABASE_URL`/`PROD_SUPABASE_SECRET_KEY` secrets the change log
  already uses cover the load (they point at dev while the site is pre-release).
- The first deploy after the migration loads every row (the backfill); or run the workflow by hand with
  `what: college-failures`.
