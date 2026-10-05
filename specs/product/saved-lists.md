# Saved Lists: Reach, Target, Likely

> Status: **built** 2026-10-05 on `feature/accounts` ([below](#built-2026-10-05)). Standing (chances) and
> tier limits come with [chances-and-fit.md](chances-and-fit.md) and [commercialization.md](commercialization.md).
> Part of [product](README.md).

## Goal
A student keeps the colleges they're considering, sorts them into **Reach / Target / Likely**, tracks where each
application stands, and keeps notes and deadlines. A guardian sees the list. The list feeds Compare ("compare my
Targets"), the net price estimator ("what would I pay at each"), and the award-letter analyzer.

"Likely" rather than "Safety": counselors have moved to it because no college is safe when it is unaffordable or
when it rejects over-qualified applicants it expects to lose ("yield protection"). The glossary explains the terms.

## Research (2026-10-02)
- Scoir, Naviance, and Common App all keep a list with a category and a status; Scoir's exported outcomes carry
  app type (ED/EA/RD), outcome, waitlist/deferred flags, and "enrolling", which is the vocabulary families and
  counselors already use. The same fields make a list exportable to and importable from those tools
  ([scattergrams.md](scattergrams.md#import)).
- The idea document's Plus tier caps lists at 20 colleges. Counselors typically recommend 8–12 applications with a
  balance across categories, so the free tier can be generous on **one** list and still leave room for Plus
  ([commercialization.md](commercialization.md#feature-map)).

## Model
```
lists      (id, student_id, name, is_default, created)
list_items (list_id, unit_id, category: reach | target | likely | unsorted, status, round: ed | ed2 | ea | rea | rd | rolling | null,
            position, added_by, added_at, decision_date, enrolling bool)
list_notes (item_id, author_id, body, private bool, created)
```
- `status`: `considering → applying → applied → decided` where `decided` carries an `outcome`: `admitted`,
  `denied`, `waitlisted`, `deferred` (deferred returns to `applied` for the regular round). The outcome vocabulary
  matches Scoir's so later pooling ([scattergrams.md](scattergrams.md#self-reported-outcomes)) is lossless.
- One **default list** per student; more lists are a Plus feature (e.g. "Nursing programs", "Mom's suggestions").
- Compare keeps working without a list; "Add to list" appears next to "Compare" on cards, rows, and profiles. The
  compare tray gains "Save these to my list".
- Every college on a list is followed automatically, so the student gets an email when its data changes
  ([follow-colleges.md](follow-colleges.md#model)).

## Display
- `/me/list` (default) and `/me/lists/{id}`: a table grouped by category with a balance line ("3 Reach · 4 Target ·
  1 Likely: counselors suggest 2–3 Likely"), each row with crest, admit rate, the student's standing
  ([chances-and-fit.md](chances-and-fit.md)) when the profile has numbers, average cost, the chosen round and its
  deadline, status, and notes count. Drag to re-sort; category chips to move.
- **Deadlines** come from the college's own data when the site has it: the regular round's closing date (and priority
  date, when one exists) from CDS C14 via [cds-application-logistics.md](../data-expansion/cds-application-logistics.md)
  (`reported.admissions_logistics`); early-round deadlines from C21/C22 via
  [cds-admissions.md](../data-expansion/cds-admissions.md); application fee from
  [housing-and-policies.md](../data-expansion/housing-and-policies.md). Otherwise the student types one. A
  "Next 30 days" strip at the top of `/me` shows whichever round's deadline is still ahead for an applying or
  considering student, and the housing deposit's due date (C17) once the status is `admitted`. These are display
  sources, not new list columns.
- **Compare all** (up to 4 free, 10 with Plus: [comparison.md](../comparison.md) today caps at 4 for layout reasons,
  so the 10-college view is the table view only).
- **Guardian view:** the same page read-only unless `can_edit`, with "Added by" attribution and private notes hidden.
- **Share:** a read-only link (`/l/{token}`) the student can turn on and off, showing the list without notes or
  standing; for grandparents, friends, a coach. Revocable.
- **Export:** CSV (the Scoir-compatible columns) and a one-page PDF ("My list" with category, cost, deadlines) via
  the same PDF renderer the counselor portal will use.
- Phones: rows reuse `SchoolRow` ([mobile.md](../mobile.md#patterns)); category is a swipe action.

## Rules
- A list is the student's. Guardians and counselors see it under the grants in
  [accounts.md](accounts.md#privacy-model); edits are attributed.
- Outcomes are self-reported and private. They feed nothing public unless the student opts into pooling later.
- Never rank or sort colleges by the student's standing in a way that reads as a verdict; the category is the
  student's choice, with the site's suggestion shown beside it ("Suggested: Target, because …").

## Files (planned)
- `lib/lists.ts` (server actions and queries), `app/me/list/`, `components/lists/`, migration `…_lists.sql` with
  policies, `tests/lists.test.mts` (status transitions, balance line, CSV round-trip).

## Open questions
1. Should statuses and outcomes be a Plus feature or free? Recommendation: free; they are the raw material for the
   pooled scattergrams that make the paid tiers valuable later.
2. Import from Common App or Scoir for a single student: no public API exists; CSV paste is enough for v1.

## Built (2026-10-05)

- **Migration**: `supabase/migrations/20261005150000_lists.sql` — `lists` (one `is_default` per student, a partial
  unique index), `list_items` (category/status/outcome/round/position/added_by/decision_date/deadline
  override/enrolling), `list_notes` (`private` hidden from everyone but its author, including a guardian). RLS uses
  `can_read_student`/`can_edit_student` from the accounts migration, so a guardian with edit access manages a
  student's lists exactly like the student does. A trigger on `list_items` insert/delete keeps `follows` in step
  (adds a `list` follow for the student's own user, upgrades nothing, never downgrades `manual`, removes a `list`
  follow only when the college is on none of that student's lists; a managed student has no user and so no
  follows). The share link reuses the invitation pattern (SHA-256 hash only; `set_list_share`/`list_share_preview`),
  and the anon preview function returns only `unit_id`, `category`, and `round` — never notes, status, or outcome.
- **Policy tests**: `tests/lists-policies.test.mts` — owner read/write, a view-only guardian reads but can't edit, an
  outsider sees nothing, private notes are author-only (including hidden from an editing guardian), the default
  list can't be deleted, every follow-trigger case from the brief, the share function's redaction, and a guard case
  that drops the notes policy and shows the leak the other test is checking for.
- **`lib/list-rules.ts`** (pure): category/status/outcome/round types, `applyOutcome` (deferred → back to `applied`
  with no outcome), the balance line with counselor guidance, `deadlineFor` (prefers the college's own CDS dates for
  the chosen round, else the student's typed override, else nothing), `upcomingDeadlines`, and Scoir-compatible CSV
  export/import (`toCsv`/`parseCsv`, tolerant of a header-less paste and unrecognized category/round/status text).
  `lib/lists.ts` is the Server Actions/queries layer on top, all through the signed-in user's own session.
- **Pages**: `/me/list` (creates the default list lazily, then redirects to it), `/me/lists/[id]` (grouped by
  category, status/round/outcome pickers, notes with a private toggle, a "Next 30 days" strip, CSV export download
  and paste-import, the share toggle, "Compare these" for the first four colleges, a print stylesheet via Tailwind's
  `print:` variant), `/l/[token]` (public, read-only, `noindex`).
- **"Add to list"** next to Compare on the profile hero (`app/schools/[id]/page.tsx`), Explore's `SchoolCard`,
  `SchoolRow`, and `SchoolTable`, and the compare tray's "Save these to my list". `components/lists/AddToListButton.tsx`
  is a client component calling Server Actions directly (`addToMyDefaultList`/`removeFromMyLists`/`isOnAnyList`), so
  the pages around it stay static; signed out, it opens a `SignInPrompt` with `next` set to the current path.
- Registered `lists` in `ACCOUNT_EXPORTERS` (`lib/account-export.ts`), added `/l/:path*` to `proxy.ts`'s matcher
  (`/me/:path*` already covered `/me/list` and `/me/lists`), and a "My list" link in `ACCOUNT_MENU_LINKS`.
- Glossary: `reach-school`, `target-school`, `likely-school` (explaining "Likely" over "Safety"), `regular-decision`,
  `rolling-admission` (`early-decision`/`early-action`/`restrictive-early-action` already existed).

### Deviations from the spec

- **No standing/chances column.** "Chances and fit" isn't built yet (owner decision for this build); rows show
  admit rate and average cost (cited) instead of a personal standing number.
- **No PDF.** Export is CSV plus a print stylesheet (`print:` Tailwind classes hiding controls), per the owner's
  decision to skip a PDF renderer for this build.
- **Reordering is buttons, not drag-and-drop** (move up/move down per row), noted in the spec rather than built as
  drag-and-drop, to keep the build inside this unit's scope.
- **No tier cap.** Extra lists beyond the default are unrestricted (commercialization isn't built yet), matching the
  owner's decision for this build.
- **Deadlines**: only the regular round (`reported.admissions_logistics.regular_closing`) and early rounds
  (`reported.admission_profile.early_decision`/`early_action`) resolve from the college's own data; rolling has no
  fixed date and always falls back to the student's own note. Housing-deposit and reply-by dates from the same
  spec section aren't surfaced on this page (they belong to the "admitted" status elsewhere, left for a later pass).
- **Compare these** takes the list's first four colleges rather than offering a picker, to stay within Compare's
  existing four-college cap.

### Owner setup

- Apply `supabase/migrations/20261005150000_lists.sql` in the Supabase SQL Editor (dev first, then prod), after
  `20261005120000_accounts.sql`, `20261005125000_households.sql`, and `20261005140000_follows.sql`.
- No new environment variables or dashboard settings beyond what accounts/households/follows already need.
