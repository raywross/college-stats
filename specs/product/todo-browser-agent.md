# Working the To do List with Claude in Chrome

> Status: **proposed** 2026-11-08 from the owner's question after the admin redesign (#226, #229): the To do tab "says
> it's only things that a person can do … couldn't we have something that would leverage the Claude extension to
> agentically go through the items and fix them?" Extends [data-steward.md](data-steward.md)
> "[Documents a person has to fetch](data-steward.md#documents-a-person-has-to-fetch)". Nothing here is built; the
> [decisions](#decisions-for-the-owner) at the end are the owner's. Part of [product](README.md).

## The short answer
Yes, and most of it needs no new plumbing. Claude in Chrome acts in the owner's own Chrome, signed in to the console
as the admin, so it can open `/admin/steward/todo`, open each row's landing page, find the document, and press the
same **Found**, **No document published** and **Done** the owner presses today. What it cannot do is also clear:
it does not sign in anywhere, does not solve a CAPTCHA, cannot pick a file in Chrome's native file dialog, and cannot
read a PDF's bytes. Those limits, plus one wiring gap in the console found while reading the code, shape the plan:

1. **A playbook** the extension follows (no code).
2. **The console meets the agent halfway** (small code), including wiring **Found** into the next run, which is not
   wired today.
3. **The file route** for hosts that block crawlers, which waits on the document archive.

## What the list is today
`/admin/steward/todo` (`app/admin/steward/todo/page.tsx`, `components/admin/steward/TodoTable.tsx`) lists one row per
document a machine could not get: kind, subject, edition, the landing page, the host, **why** a machine couldn't
(`robots-path`, `robots-host`, `challenge`, `bot-check`, `viewer`, `js-only`, `terms`, `login`, `not-found`,
`no-document`), reach, demand, status, and every attempt. Rows are generated from `reported.failures`, the review
queue's `unreachable` and `not-a-url` items and `directories.blocked`, merged with the `steward.todo` documents
(`lib/admin/steward-reads.ts readTodo`). As of 2026-11-01 the engines held 964 discovery and 242 fetch failures.

Three actions (`lib/admin/steward-actions.ts`): **Found** stores the address as `document_url`, sets `status: found`
and `route: person`, and tells the admin "The next run of this college fetches it." **No document published** and
**Done** close the row.

**The wiring gap.** Nothing in the college-reported pipeline reads `steward.todo`. Discovery's step 0
(`scripts/lib/college-reported/probe.mts knownStep`) reads the owner's list, `data/reference/cds-urls.json`, and the
only way a document from a blocked host enters the archive is `npm run archive-doc` on a file a person downloaded.
So a row marked Found today is a note to a person, not an instruction to the next run. Any agent that works the list
needs this closed first, or its Found rows go nowhere.

**The blocked-host rule still holds.** The pipeline never fetches a blocked host another way and never changes user
agents (`scripts/lib/college-reported/blocked.mts`). For a `robots-host`, `challenge` or `bot-check` row, an address
alone can never be enough: the bytes have to come through a person's browser. That is step 3.

## What Claude in Chrome can and cannot do here
| Can | Cannot |
|---|---|
| Open the console as the signed-in admin, read the table, follow the landing page, fill the Found sheet and press Save | Sign in to a college site, a member portal or Google Workspace it is not already signed in to |
| Read the rendered page, including lists a page's own JavaScript builds (`js-only`) | Solve a CAPTCHA or any bot check that asks it to prove it is a person (its own rules, and ours) |
| Search a site for a moved document (`not-found`), browse a Google Drive folder (`viewer`), judge whether a college publishes a CDS at all (`no-document`) | Pick a file in the operating system's file dialog, so it cannot upload a download through a form |
| Open a PDF in Chrome's viewer and read its cover to confirm edition and kind, well enough to write a note | Hand us the PDF's bytes; the console cannot `fetch()` another origin's file from the browser either (CORS) |
| Record a GIF of what it did | Work unattended for hours: it is interactive, a row at a time, a minute or two each |

So the extension is a good fit for the **finding** half of every row and the **closing** half of rows on open hosts,
and no fit at all for logins. The list is sorted highest reach first, so the first page is the one that matters.

### By reason
| Why | What the agent does | What closes the row |
|---|---|---|
| `js-only`, `not-found`, `viewer` (a file, not a folder) | Finds the address on the rendered page or in the folder | Found; the next run fetches it (after step 2 wires Found in; Drive share links already rewrite to direct downloads in `probe.mts`) |
| `no-document` | Browses the site (institutional research, admissions, "data" and "facts" pages, a site search for "Common Data Set") | No document published, with where it looked in the note; or Found when it was there after all |
| `robots-path`, `robots-host` | Opens the document the page links, as a person would | **Decision 1.** Found is enough for `robots-path` once the run may fetch a person-confirmed address; `robots-host` needs the file route |
| `challenge`, `bot-check` | A real Chrome usually passes Cloudflare's interstitial by itself; the agent proceeds only when no CAPTCHA appears (**Decision 2**) | The address helps a person; the file route closes it |
| `login`, `terms` | Nothing. The row is `ask`: a partnership or a data request | A person |

## Step 1: the playbook (no code)
A skill the owner adds to Claude, the way `/connect` already ships a skill for the public API
([assistants.md](assistants.md)): `.claude/skills/work-todo/SKILL.md` in this repository, and the same text behind a
"For an agent" link on the To do page's help. It says:

- **Where**: `/admin/steward/todo`, highest reach first, one page at a time; stop after a batch (20 to 30 rows) and
  report what it did.
- **Order per row**: read why; skip `login` and `terms`; open the landing page in a new tab; find the document for the
  **kind and edition the row names**; open it and read the cover; then one of Found (the address, and a note starting
  `Claude in Chrome:` with the edition it read), No document published (where it looked), or leave the row with a
  note when unsure.
- **Rules** (the same as the crawlers', in the spec's words): only public links; no sign-in, no challenge or CAPTCHA,
  nothing the page doesn't link; a page that says the document is for counselors, members or staff is `ask`; never
  change what a row already says without a reason in the note.
- **Report**: a short list at the end: rows closed by kind, rows skipped and why, anything that looked like a policy
  question (a new terms page, a login where there was none).

This alone turns the list from "the owner, some evening" into "a batch of thirty while the owner watches", with the
console's existing audit log (`steward.*`, before and after) as the record.

## Step 2: the console meets the agent halfway (small code)
Each of these is a day or less and helps a person too.

1. **Wire Found into the run.** Discovery step 0 reads the college's `steward.todo` rows with `status: found` beside
   `cds-urls.json`, and a found address on an open host is fetched by the next run; when that fetch succeeds the row
   becomes Done with the attempt recorded. A found address on a blocked host is not fetched (the rule above); the row
   instead says "we need the file" and keeps the address for step 3. The Found sheet's sentence becomes true.
2. **Verify at the moment of Found.** When the admin (or agent) saves Found, the server tries the address once itself
   through `PoliteHttp` (robots honored, honest user agent, 50 MB cap) and sniffs the bytes (`archive-doc.mts
   sniffType`). Three outcomes, shown in the row: *archived* (Done at once), *blocked here, address kept* (the file
   route), *not a document* (HTML back: the agent pasted a viewer page; the row stays Found with that note). This
   is the check the agent cannot make for itself.
3. **One row, one page.** `/admin/steward/todo/[key]` with everything the row knows, the landing page, the edition
   wanted, the previous attempts in words, and the three actions, so the agent (and a phone) work one screen with no
   table to scroll. The table's Subject links it.
4. **An agent view.** `?agent=1` hides `login` and `terms` rows and the closed ones, and caps the page at the batch
   size, so the agent's first read is exactly its work.
5. **Say who.** Attempts and notes written while the agent works carry `route: "agent"`; the Steward's weekly jobs
   audit ([data-steward.md](data-steward.md) Audits) counts the agent's rows, Found-then-archived against Found-then-
   wrong, so the owner sees how often to trust it.

## Step 3: the file route (waits on the archive)
For hosts that block crawlers, the document itself has to travel through the owner's browser. Three ways, in order of
how little they ask of the owner:

1. **Download in Chrome, archive from the desk.** The agent presses Download; the files land in Downloads. A Claude
   Code session on the owner's machine runs `npm run archive-doc` over them (it already sniffs type and edition and
   matches the college). Two agents, one handoff, no new code; it needs the owner's checkout and `.env.local`.
2. **An Upload action on the row.** The console accepts the file and writes it to the archive like a fetch would.
   This is the spec's "upload is the route to scale" and needs prerequisite 1 of data-steward.md: `COLLEGE_DOCS_REPO`
   set, so the archive outlives the Actions cache. The agent cannot pick the file itself; the owner drops it, or
   Claude's desktop computer use does.
3. **A direct-download rewrite** for the viewers we meet most (Drive, Box, SharePoint links): already partly in
   `probe.mts`; the agent's notes will show which services recur.

## What this does not do
- It does not touch the Steward's own runs, proposals or holds: the agent works one list, through the console's
  existing actions and their audit log.
- It does not make the crawlers do anything new: no blocked host is fetched by a machine, no user agent changes.
- It does not run unattended. A nightly agent in a headless browser is a different proposal, with a different answer
  to the robots question.

## Decisions for the owner
1. **May an agent acting in the owner's own browser open a document that robots.txt disallows to crawlers?**
   [data-steward.md](data-steward.md) already says a person may and marks it "still needs the owner's confirmation";
   an agent in that browser is the same action with a different hand. Recommend **yes for `robots-path`** (the page
   links the document; the rule is about crawlers) and **ask for `robots-host`** (the host refuses machines as a
   policy; prefer the archive copy or a request to the college).
2. **Challenge pages.** Recommend: proceed when Chrome passes an interstitial on its own; stop at anything that asks
   the agent to prove it is a person, and say so in the note.
3. **Who presses Found.** Recommend the agent presses it directly on open hosts, because step 2's verify-on-Found
   checks the bytes; for blocked hosts it records the address and the row waits for the file.
4. **Build order.** Recommend step 1 now (a skill file and a help link), step 2 next (items 1 and 2 first, since they
   fix a gap a person feels too), step 3 after `COLLEGE_DOCS_REPO`.
