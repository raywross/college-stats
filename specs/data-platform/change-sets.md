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

## As built, phase 3 (2026-10-31)

### The Edit page
`/admin/colleges/[unit]/edit` (behind `requireAdmin()`; 404 for an unknown unit): a page titled "Edit {college}", with
a back link to the admin college page and a link to the public profile. The admin college page's header carries an
**Edit** link beside "Public profile". The page lists every editable registry path — every `lib/fields.ts` path except
`unit_id` and anything `editProblem` refuses (unregistered, `computed`, or `hidden`); `name` *is* editable, since a
rename is a real correction — grouped by topic in the registry's order, each group a disclosure open by default on
desktop and closed on phones (a search box filters rows by label or path, client-side, and opens every group a match
is in). Each row shows the value as it's shown on the site, its citation exactly as the ⓘ popover would word it, a
chip when the value shown is a live edit, the "newer pipeline value" marker when one applies, and a typed input with
an optional note (500 characters) and **Save**; an edited row also gets **Release** and a **History** disclosure with
**Revert to this**.

### The input's kind
The registry carries no value type, so the editor infers one from the college's current value at the path: a number,
a three-way boolean (true / false / none), a date (a string matching `YYYY-MM-DD`), text, or JSON for an array or
object. A string becomes a **select** instead of free text when every college together has at most 12 distinct
values at that path and some repeat (a category, not prose). When this college has no value, the kind comes from the
type most colleges have at the path (one pass over every college, computed once per request and reused across rows).
A `notify.unit === "percent"` field shows the number as a share, with the hint "a share, 0 to 1: 0.42 is 42%", and
accepts a typed percent sign ("42%" saves 0.42) as well as a bare share.

A submitted value is parsed by its row's kind and refused in plain words when it doesn't fit ("Enter a number", "Not
valid JSON", "Pick true, false or none", "Enter a share from 0 to 1: 0.42 is 42%"). An empty box is refused unless the
"Clear this value" box is ticked, which saves `null` whatever the box holds. The boolean select's "none" choice
already means null, so it needs no separate Clear box.

### Stored derived fields
A registry entry with a stored `derived` formula (e.g. `admissions.acceptance_rate`, computed from counts at sync
time and stored like any other field) is not recomputed by either the publisher or the live overlay when one of its
inputs is edited — editing `admissions.admitted` does not move the stored rate. Such a row shows "Derived:
{formula}. Editing an input does not recompute it; set this value too if it should change" under it, and the input's
own row names the stored derived fields that read it ("Stored derived field reading this: Acceptance rate. Editing
this does not recompute it"), so an admin remembers to set the dependent value too.

### The "a newer pipeline value exists" marker
For an edited path, the editor fetches the snapshot the instance currently serves `edits.json` (built by the
publisher, F4) and looks for this college and path's entry. If that entry's `pipeline` is non-null, its value differs
(deep equality) from the edit's, and its lineage's `retrieved` day is after the edit's day, the row shows "A newer
pipeline value exists: {value} from {source}, {date}" beside **Release**. The marker is simply absent when
`edits.json` doesn't exist yet for the served snapshot (a 404, or a dataset built before F4 shipped), when the fetch
fails, when the path had no pipeline value (`pipeline: null`), when the values agree, or when the pipeline's lineage
has no date at all (nothing proves it's newer).

### Release
**Release** calls `admin_data_release_edit`, which releases **every** unreleased edit of that unit and path, not just
the one shown (there is at most one live edit per path in practice, but the function doesn't assume it). The page's
copy: "Lets the pipelines' value show again." The pipelines' value returns on the page immediately (the live overlay
has nothing left to apply at that path) and is baked into the next published snapshot.

### History and Revert to this
The field's **History** disclosure lists every edit of the path, newest first, each with who made it (the editor's
`profiles.display_name`, or "an admin" when that lookup fails or the name is unset), when, the value, the note, and a
status: **Live** (the edit the overlay currently serves), **Released** (superseded by a release), or **Replaced**
(superseded by a later edit of the same path). **Revert to this** on any row calls `admin_data_edit` again with that
row's value and the fixed note "Reverted to the edit of {date}" — a revert is a new edit, never a rewrite of history.

### Showing it at once
After a successful Save, Release, or Revert to this, the action forgets this instance's live-edits memo
(`forgetLiveEdits`) and revalidates `/schools/{unit}` and `/admin/colleges/{unit}` (both `"layout"`, so every topic
page under each path picks it up), then calls `refresh()` so the editor's own rows catch up. Nothing else is
revalidated.

### The reference editor
`/admin/data/reference` lists every whole-document reference: the eleven names in `REFERENCE_FILES`
(`scripts/lib/data-platform/layers.mts`: `aid-policies`, `aliases-curated`, `application-cycle`,
`guaranteed-admission`, `major-admission`, `state-laws`, `organizations`, `common-app-trends`,
`excluded-campuses`, `essay-guidance/guidance`, `zcta-centroids`) plus the release calendar (`base.release_calendar`,
key `calendar`) — each with a one-line description, its collection, current version, when it last changed, and a link
to the change set that wrote it. `/admin/data/reference/[name]` edits one: a `{text}` document (the essay guidance
markdown, the ZCTA centroids CSV) is unwrapped into a plain textarea and re-wrapped as `{text}` on save; every other
document is a two-space JSON textarea, exactly as stored. Before **Save document** reaches the database, the body is
checked by the document's own validator when `lib/` has one:

| Document | Validator |
|---|---|
| `aid-policies` | `validateAidPolicies` |
| `state-laws` | `validateStateLaws` |
| `guaranteed-admission` | `validateGuaranteed` |
| `major-admission` | `validateMajorAdmission` |
| `application-cycle` | `validateCycleFile` |
| `common-app-trends` | `validateCommonAppTrends` |
| `organizations` | `organizationsProblems` |
| `aliases-curated` | `aliasTableProblems`, after `buildAliasRow` turns each row into the shape it checks |
| `essay-guidance/guidance` | `missingSections(parseGuidance(text))` |
| the release calendar, and every other document | none yet — only the generic rule that the body parses to a JSON object or array |

A problem refuses the save in plain words before any call reaches `admin_data_set_reference`. The **Versions** panel
lists every version from `data_document_versions` (version, when, change set, deleted flag); **Revert to version
{n}** requires typing "revert" and resends that version's body through the same function with the note "Reverted to
version {n}" — it does not run the body back through the validator (an older version was presumably valid when it
was current, and a validator can tighten over time). The essay guidance document's name has a "/" in it, which the
list and edit links percent-encode into one route segment (`/admin/data/reference/essay-guidance%2Fguidance`); the
page decodes it back before reading.

### The live overlay
`lib/data-platform/live-edits.ts` applies where the contract named: `lib/profile-data.ts` (the college page and every
topic page under it), `lib/compare-data.ts` (Compare), `app/api/v1/schools/[id]/route.ts` and
`.../lineage/route.ts` (the Data API's single-college and lineage endpoints), and the MCP server's one-college tools
(`get_college`, `get_lineage`, `fetch`) through `McpToolContext.liveSchool`. **It does not reach the advisor**: a
check of `lib/planner/context.ts` and `lib/chances/snapshot-deps.ts` found no single choke point where every planner
college read passes through one function, so the advisor still reads the published snapshot, as the contract allowed
when no such point exists. Explore, the search index, the home page, trends, and the `/api/v1/schools` list wait for
the snapshot, by design.

The overlay reads every unreleased row of `data_field_edits` from PostgREST
(`${SUPABASE_URL}/rest/v1/data_field_edits?select=id,unit_id,path,value,note,created_at&released_at=is.null&order=id`)
with the publishable key, over `node:http(s)` — never `fetch`, since Next patches `fetch` and an uncacheable fetch
during the college page's static render would make that page dynamic. A 3-second timeout; one read per request
(React `cache()`) and at most one every 30 seconds per server instance (a module-level memo), so a burst of API calls
or a cold instance's static regeneration costs at most one database read. It fails open: an HTTP error, a timeout, a
network error, or a body that isn't a list of rows all serve no edits (the snapshot's own values), logged at most
once a minute per failure kind. Without `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` set, nothing is read and every
school passes through unchanged — the overlay never throws.

### Citations
Because `meta.sources` doesn't carry `quad-edit` until the next publish adds it, `sourceInfo()` falls back to
`quadEditSource()` ("Quad's editors", publisher "Quad") so an edit cites correctly before that publish. An edited
value's ⓘ popover reads "Edited by Quad on {Month D, YYYY}." followed by the editor's note, if there is one, with no
year (`citesYear` returns false for the `quad-edit` source: an edit is dated by the day it was made, not a release).
A section's source line reads "Edited by Quad" (linked to `/data#edits`, no year) in place of a dataset name. A
profile's bottom "Sources for this profile" list adds one line, "Some values edited by Quad," with a short
explanation and a link to `/data#edits`, whenever any field shown on the profile is an edit; the edited sources
themselves are left out of the numbered dataset list (an edit isn't a dataset with a year to group by). `/data#edits`
is one paragraph on `/data`, under "The datasets": "Edited by Quad: where a source's value is missing or wrong, Quad's
editors can set it by hand. The value's ⓘ says so, with the day of the edit, and a newer release replaces it only
once an editor lets it." The Data API's `GET /schools/{id}/lineage` serves the overlaid school, so an edited field's
lineage reads `{ source: "quad-edit", method: "edited", ... }` with no year, and a note when the edit had one.
