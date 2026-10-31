# Part 3, Change sets: runs, holds, review, revert, and admin edits

> Part of [the data platform](README.md). Code: `lib/data-platform/change-sets.ts` (pure helpers), `lib/admin/data-*.ts`
> (console reads and actions), `app/admin/data/**`, `lib/data-platform/edits.ts` (the live overlay).

## A run, start to finish
1. The pipeline opens a change set (`data_open_change_set(kind 'pipeline', source, run_ref)`) and writes its layer
   documents as it goes (`data_write_documents`), one call per college or per batch, so a cancelled run keeps what it
   finished (today's "state files written after every college").
2. At the end it computes its breaker exactly as today (`circuitBreakerV3` for college-reported; the essays run's
   held-share; identity's due check), and closes the set `applied` or `held` with the breaker's sentence.
3. It sends `repository_dispatch: publish-snapshot`. The publisher publishes when nothing since the last snapshot is
   held; otherwise it stops and the console shows the hold.
4. The run's PR body of today becomes the change set's **summary** (counts, cost, the held table, the blocked hosts),
   stored in `summary` and shown in the console; the release note becomes an entry the publisher writes to
   `release-notes` only when a person asks for one from the console ("Write a release note"), since routine data
   refreshes no longer need a PR.

## Holds and review
There are two kinds of hold, kept distinct because they mean different things:
- **A held change set**: the run as a whole looked wrong (breaker tripped, stopped early, a person held it). Nothing
  from it is published until an admin chooses **Publish anyway** (`admin_data_unhold`) or **Revert**
  (`admin_data_revert`). The console shows the summary, the documents touched (with a before/after view of any one),
  and the reason.
- **Held items**: today's review-queue items and the essay reader's held records; the run itself is fine but these
  values need a person. They are documents (`reported.review_queue`, `essays.held`) and never reach the composed
  college until resolved. The console's **Holds** list replaces the GitHub-App review queue: *Accept the value*
  writes a **field edit** (source `quad-edit`, note "Accepted from the review queue: {document}"); *Reject* resolves
  the item (`admin_data_resolve_review`); *Re-run discovery* dispatches the workflow as today. No PR is made.

## Revert
`admin_data_revert(change_set)` writes a new change set of kind `revert` whose documents are, for every document the
original touched, the version just before it (or a deletion when the original created it). It refuses when a later
change set touched the same document (the console offers to revert that one first, newest first), so history stays a
straight line. The next publish carries it. Reverting a `publish` is **Point back here** on an older snapshot
([publish.md](publish.md)): instant, no rebuild, and the next publish from current layers supersedes it unless the
offending change set is also reverted. The console says this on the button.

## Admin edits
Owner, 2026-10-31: any registered value, no source or quote asked for.
- **Where**: `/admin/colleges/[unit]` gains an **Edit** mode listing every registered leaf path that has a value or
  could (grouped by topic as the registry's `topic` groups them), showing the current value, its source as the
  citation would say it, and an input typed from the registry (number, text, boolean, enum from the field's known
  values, date). Arrays and objects (a prompt list, a program row) get a JSON editor with the schema's shape shown.
- **What a save does**: `admin_data_edit(unit, path, value, note)` validates the path is registered and not `computed`
  or `hidden`, and the value's type; writes the edit and a change set of kind `edit`; logs `data.edit` with before and
  after. The page re-renders with the edit **live** at once (below). The next snapshot bakes it in.
- **Lineage**: the composed college gets `lineage[path] = {source: "quad-edit", method: "edited", retrieved:
  <date>, note?}`. A new `SourceKey` `quad-edit` ("Quad's editors") joins `SOURCE_VINTAGE` with vintage `null`;
  `validateSchool` accepts `edited` as a method and requires only `retrieved`. The citation popover reads "Edited by
  Quad on October 31, 2026" plus the note, and the sources list on a page says "Some values edited by Quad".
  Derived fields recompute from the edited input as they do from any input.
- **Precedence**: an edit beats every pipeline layer for its path until released. A pipeline's newer value for an
  edited path is kept in the layer (history) and the console marks the edit "a newer pipeline value exists:
  {value} from {source}, {date}", with **Release** to let it through.
- **The live overlay** (`lib/data-platform/edits.ts`): one cached query per request for the unreleased edits of the
  colleges on the page (the essays overlay's pattern: `cache()`, fail open to the snapshot), applied by
  `withEdits(school, edits)`. It is used by the college pages, Compare, the advisor, and the Data API's single-college
  route; Explore and the search index wait for the snapshot (a facet count one minute old is fine).
- **History and revert**: the field's edit rows, newest first, each with who, when, value, note; **Revert to this**
  re-saves that row's value as a new edit; **Release** clears all edits for the path.
- **Reference documents** (the release calendar, aid policies, guaranteed admission, state laws, platform prompts, the
  essay guidance text): `/admin/data/reference/[name]` edits the whole document (a JSON or text editor with the
  validator the document already has), through `admin_data_set_reference`; versions are the document's versions.

## The console: `/admin/data`
| Screen | Shows | Actions |
|---|---|---|
| **Overview** | The snapshot each environment serves (from the `x-quad-snapshot` header of a fetch to each site), the last publish, change sets since (count, sources), holds | Publish now |
| **Change sets** | List (newest first; status chips), each with summary, documents touched by collection, a before/after view of one document, cost, run link | Hold, Publish anyway, Revert, Write a release note |
| **Holds** | Review items and held essay records, most-listed college first (today's queue ordering), with the document link and the value | Accept the value (an edit), Reject, Re-run discovery |
| **Snapshots** | List with created, change sets, colleges, bytes, status; the current one marked | Point back here, Download manifest |
| **Reference** | The reference documents and their versions | Edit, Revert to version |
| **Colleges** (existing page) | The college's composed values and sources; **Edit** mode | Edit, Release, Revert to this |

Reads use the admin's session (`adminSupabase()`); the tables' select policies are open, the console header is sent
anyway. Actions go through `withAdmin` and `callAdminRpc` like Operations. Everything the console sends to GitHub
(dispatching the publisher) is logged before sending, as `ops.dispatch` is.

## Telemetry
Server events, never values: `data_publish {snapshot, change_sets, ms}`, `data_change_set_closed {source, status}`,
`data_edit {path_topic}`, `data_revert {kind}`, `data_point_back`.

## As built, phase 2 (2026-10-31)
The console's Change sets, Holds and Snapshots screens exist (`app/admin/data/**`; pure helpers in
`lib/admin/change-set-view.ts`). Differences from the plan:
- **Revert** refuses when a later set touched a document; the console turns the function's message into "Change set
  #N changed X after this one. Revert #N first". **Publish anyway** is `admin_data_unhold` plus a forced publish
  dispatch, logged first. **Write a release note** shows the note's text with a Copy button; the console no longer
  commits anything, so a person pastes it into a code PR when a routine refresh deserves one.
- **Holds** lists open review items and held essay records most-listed college first. **Accept the value** writes
  one field edit per value through `admin_data_edit` (today's `acceptPlan` mapping: the three C1 totals with the
  derived rate and year, or a test-submission share) with the note "Accepted from the review queue: {document}",
  then resolves the item `accepted`; if an edit fails it stops before any item is marked. Each held essay links to its
  hand-read form. **Re-run discovery** dispatches as before.
- `lib/reported.ts`'s `resolved` is `"rejected" | "accepted"`; `enqueueItems` keeps both out.
- The queue is read from the store, paged by key, cached per instance and re-read after a write or five minutes.
- Not built: the `data_revert` and other telemetry events in this part (the console logs every action to `admin_log`
  instead); the admin field editor and the live edits overlay are phase 3.
