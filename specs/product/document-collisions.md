# Document Collisions: Two Files, One Edition, the Admin Chooses

> Status: **built** 2026-11-08 (see [As built](#as-built)). Written 2026-11-08 after a Steward refile collided with a
> document already on file. Part of [product](README.md); builds on the console of
> [admin-redesign.md](admin-redesign.md) and the Steward of [data-steward.md](data-steward.md), and on
> `scripts/drop-document.mts` (a document dropped from a college: its record, manifest entry, queue items, and its URL
> listed so discovery never fetches it again).

## The incident

On 2026-11-08 the owner approved a Steward refile from the Inbox: move UC Santa Cruz's (110714) Google Drive copy of
its CDS (sha `f38e8289ef`, filed 2025-26 by assumption, pulled 2026-10-26, 367 of 1,105 items read, every one with a
check failure) to 2024-25. The apply refused ("110714 already has a 2024-25 document": the official PDF, sha
`420859b8b6`, pulled 2026-10-19, 63 failures) and closed a **held** change, which stopped every publish. Nobody could
see the two files side by side or choose one.

The owner's words: "on a record collision like this it would show the admin the data differences, and then let the
admin choose which file to read. It should provide details of when each file was pulled and its source because that
would be foundational to the decision."

## What a collision is

A **collision** is either:

1. a college record with two or more documents claiming one edition, or
2. a Steward refile whose target edition already has a document on the record (the proposed file and the one already
   there).

Either way the admin sees the two files side by side and keeps one. The other is **dropped** (drop-document): out of
the record, its manifest entry and queue items gone, its address listed under the recipe's `dropped` so discovery never
fetches it again. The bytes stay in the archive. The kept file stays exactly as it is (it is not refiled).

## The facts of a file

Every file is described by the same facts, first and in plain words, because the owner said they decide it:

| Fact | From |
|---|---|
| **Pulled** (the date) and **from** (the host; the full address and the final address after redirects under Details) | the record's `retrieved`, `url`, `final_url` |
| **Filed as** an edition, **by**: stated (the cover, an item's text, the workbook, the file name), assumed, or by a person | the manifest's `edition_from` (`cover`, `items`, `workbook`, `url` → stated; `assumed`; `manual`; anything else unknown) |
| **What it says about itself**: "the cover says 2024-2025", or "states no edition" | an edition-mismatch failure's detail on any item |
| **Read by** (Sonnet, Haiku, Opus, the workbook or form reader), **on** (the date), **how** (batch, interactive, deterministic) | the record's `reads` (the newest read) |
| Items read (a value was read: passed or failed) of the template's items, and how many carry a check failure | the record's `items` |
| Pages and size | the manifest's `pages` and `bytes` |

One sentence carries them: "Pulled 2026-10-26 from drive.google.com (the full address under Details); filed as 2025-26
by assumption; read by Sonnet on 2026-10-26: 367 of 1,105 items, 367 with check failures."

## The college page's Documents panel

`/admin/data/colleges/<unit>#documents` lists one card per document, newest edition first, each with its sentence and
a Details fold (the full address, the final address, the sha, pages, size, each read).

When the record has a collision, or the page was opened with `?compare=<shaA>,<shaB>` (any two of the record's
documents, by sha or a prefix of it), a **"Two files claim 2024-25"** block (or "Compare two files" when the two are
filed under different editions, as a refile collision is) comes first:

- The two files side by side from `md`, stacked below it: each one's facts first.
- **What differs**: a table of the items both files read with different values (Item · File A · File B), sorted by
  section then code, items named with `codeLabel` ("C1, applications"), values formatted as the Review page formats
  them (a percent item as a percent). How many items agree is one sentence. The items only one file read are counted,
  and listed under Details.
- Under each file, **Keep this file**: a typed confirmation (`keep`, `CONFIRM_KEEP` in `lib/admin/console.ts`; a sheet
  on phones) whose sentence says what happens: "The other file (pulled 2026-10-19 from www.ucsc.edu) is dropped from
  this college: its 63 queue items go, its address is listed so discovery won't fetch it again. The kept file stays as
  it is."

A refile collision's link opens the proposed file against the one already in the edition.

## Keep this file (the Server Action)

`keepDocumentAction` (`app/admin/data/colleges/[unit]/actions.ts`): `requireAdmin()` first, then the typed word
checked again, then the work in `lib/admin/keep-document.ts` (`keepDocument(deps, form)`, tested with fakes):

1. Refuse without the word, without two different files, or when either file isn't on the college's record.
2. Log `review.keep_file` (`admin_note_ops`) before writing anything; a log that fails stops the action.
3. Open one change set (kind pipeline, source `keep-document`) on the data store and, in it: drop the other file
   (`dropDocument`, why = "Kept <keptSha10> (<host>, pulled <date>); the admin chose it over this file on <today>");
   decline every Steward refile proposal that names either file and is still open, asked, approved, or failed
   (`setProposalStatus`, with a note); settle the collision finding (`collision|<unit>|<edition>`, status left with the
   reason). Close it applied. It reaches the site at the next publish.
4. Revalidate the college page.

The console writes the data store directly here (the store library with the server's `SUPABASE_URL` and
`SUPABASE_SECRET_KEY`, as `dataProjectEnv` reads them), because a drop touches four collections in one change set and
no `admin_data_*` function does that.

## The Steward side

- **The writer** refuses a refile row whose target edition already has a document on the record, naming both files,
  and leaves a **collision finding** in its place: `steward.issues` key `collision|<unit>|<edition>`, kind `collision`
  ("Two files"), one line per file with its facts, `href` the compare link and `action` "Choose the file". The system
  prompt tells the Steward that when the edition is taken it leaves the finding rather than a refile.
- **The apply job** checks every refile row before writing anything: a refile that would collide is an `ApplyRefused`
  whose message carries the compare link, so `runApply` closes its (empty) change set applied, never held, and marks
  the proposal `failed` with that message.

## The Inbox and the proposal page

- A `failed` proposal is severity 1: "Choose the file" to the compare link when its `failed_reason` carries one, else
  "See why it failed" to the proposal page.
- A held change whose summary's `refused` (or held reason) carries a compare link opens it with "Choose the file"; one
  that names a collision without a link ("110714 already has a 2024-25 document") opens its proposal.
- A collision finding the Steward left (not one it settled) is severity 2, "Choose the file". The Inbox never scans
  every record for collisions.
- The proposal page shows "Apply failed: <reason>" with the link as a button; for a failed refile without a link in its
  reason, the page works the link out from the record.

## Help

`documents`, `document-collision`, `keep-file`, `pulled-from`, `filed-by`, door Data.

## As built

Built 2026-11-08 on `feature/document-collisions-view`, on top of the drop tool (`scripts/drop-document.mts`,
`Recipe.dropped`, `setProposalStatus`, proposal status `failed`).

- **The comparison** `lib/admin/document-compare.ts` (pure): `documentFacts(doc, manifestEntry?, template?)`
  (`DocumentFacts`; `itemsTotal` is the template's item count when one is given, 1,105 today), `filedByOf()`,
  `factsSentence()`, `filedWords()`, `sizeWords()`, `readerName()`, `hostOf()`, `cdsValueWords()` (the Review page's
  `valueWords` with the template's type: a percent item as a percent, a currency item in dollars),
  `compareDocuments(a, b, template?)` (`Comparison`: `agree`, `differ`, `onlyA`, `onlyB`, `failuresA`, `failuresB`;
  values compared as numbers within rounding, text without case or spacing), `collisions(record)`,
  `findDocument(record, sha)` (a prefix of 6 or more), `refileCollision(record, sha, toEdition)`,
  `compareHref(unit, a, b)` (each sha cut to 10, `LINK_SHA`), `compareLinkIn(text)`, `parseCompare(query)`,
  `collisionNamedIn(text)`, `collisionHref(proposal, readRecord)`, `collisionIssueKey(unit, edition)`,
  `keepSentence(other, n)`, `CHOOSE_THE_FILE`. The "items read" count is items with a value read (passed or failed).
- **Reads** `lib/admin/document-reads.ts`: `readCollegeDocuments(client, unit)` (the record, its manifest entries,
  and the review-queue items per file, read by the `<unit>|` key prefix), `readRecord()`, and
  `readCollisionIssues()` (`steward.issues` by the `collision|` prefix).
- **The panel** `components/admin/DocumentsPanel.tsx` (`DocumentsPanel`, `pairToCompare`). The college page reads
  `?compare=` and the record; with a collision or a compare link the panel comes first in the main column, otherwise
  after the estimate's inputs. A compare link to a file the record doesn't hold shows the cards only. When more than
  two files claim one edition, the two newest pulls are compared and the sentence says how many more claim it (the
  others can be compared with a link). The table is a `ResponsiveTable`; the "only one file read it" lists sit under
  one `<details>`.
- **Keep this file** `lib/admin/keep-document.ts` (`keepDocument(deps, form)`, `keepWhy()`, `namesFile()`,
  `KEEP_SOURCE`, `KEEP_COLLECTIONS`, `LIVE_REFILE`) and `keepDocumentAction` in `app/admin/data/colleges/[unit]/actions.ts`.
  **It writes the data store directly**: `supabaseStore()` with `dataProjectEnv(process.env)` (the server's
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, or `DATA_SUPABASE_*`), importing `dropDocument`, `setProposalStatus` and the
  store from `scripts/` (the first console code to do so; no `admin_data_*` function covers a drop). For `next build`
  the import graph must not read files when it loads: `recordBody` moved from `college-reported/state.mts` (which pulls
  in `bundled.mts` and its `import.meta.dirname`) to `college-reported/records.mts`, re-exported from `state.mts`. Without those
  variables the action refuses with nothing changed. The log row is `review.keep_file` (`admin_note_ops`, the only
  log function that takes a free action name; its pattern allows `review.*`), and a failure logs `review.failed`. The
  declined proposals' `decided_by` is the admin's user id.
- **The Steward.** `IssueKind` gains `collision` ("Two files"); `IssueDoc` gains optional `href` and `action`, which
  `writeIssue` keeps. `StewardWriter.refileClash()` writes the finding (status `waiting`, one line per file, the
  official file first) and its message is the row's refusal. The model's `write_issue` tool doesn't offer the kind:
  only the writer writes it. One prompt line; the dry-run answers recorded under the old prompt were re-keyed to the
  new requests (`tests/fixtures/steward/answers/`, same responses). The apply job checks every refile row before
  writing; the drop-document unit's "breaks part way" test now shows the collision refused (its set applied) and a
  real break (a file the record doesn't hold) held.
- **The Inbox and pages.** `InboxInput.collisions` (optional), `InboxHeldChange.summary` (read with the held changes),
  kind `collision`. A failed proposal's row is titled "Apply failed: <summary>" and dated by its decision. The
  proposal page shows an alert with the reason and **Choose the file** for a failed proposal, and for any refile still
  in play that would collide (worked out from the record, so the 2026-11-08 proposal, still `approved`, shows it too).
  Findings lists collision findings in their own panel (`components/admin/steward/CollisionFindings.tsx`).
- **Tests** `tests/document-collisions.test.mts` over `tests/fixtures/document-collisions/ucsc-record.json`.
- **Left:** the change the incident closed held is still held in the dev store (its message predates the link, so the
  Inbox opens its proposal, whose page links the comparison); once the owner keeps a file, releasing that held change
  is a separate step on Changes. No migration was needed.
