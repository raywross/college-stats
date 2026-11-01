# Part 7, Editors: Suggested Changes a Student Accepts, and Marks in the Draft

> Status: **built** 2026-11-01 on `feature/essay-editors`, the day it was planned (see [As built](#as-built-2026-11-01)).
> Planned 2026-11-01 (owner: "I'd like for parents and counselors to be able to make edits to a student's
> essays that the student can review and accept. Think of them as editors… something like the way Microsoft Word allows
> for markup changes and comments with a view to see with and without markup. Similar for when we do the AI review, it
> would be good to highlight the text that relates to the feedback… some kind of color underline that will give you a
> mouse over and then let you jump to the details. Maybe multiple colors, one for the AI, and then different colors for
> any of the mortal reviewers."). Part 7 of [essays](README.md). After [workspace.md](workspace.md) (the editor, the
> comment thread, versions) and [reviewer.md](reviewer.md) (the notes and their spans). Part of [product](../README.md).

## Goal
Let the adults around a student edit the way a good editor does: propose the change in the text itself, and let the
writer decide. Today a parent or counselor can only comment ("this sentence runs on"); the student has to find the
spot and make the change. After this, a parent can rewrite the sentence in their own copy and send it as a
**suggestion**; the student sees the old words struck and the new words underlined in the parent's color, and taps
Accept or Reject on each change, or on all of them at once. The words stay the student's: nothing lands in the draft
until the student accepts it, and the version list records what was accepted and from whom.

The second half is about seeing where feedback points. The reader's notes, the comments, and the suggestions each
sit on a span of the draft, but today the student finds the span by pressing "Show in the draft". After this, every
span is **marked in the field itself** with a colored underline, one color for the reader and one for each person
who has written on the draft; hovering (or tapping, on a phone) shows what is there and a tap jumps to the full note.

## What Word and Docs do, and what we take
- **Word** tracks changes inline (insertions underlined and deletions struck, in the author's color), lets the reader
  pick *All Markup*, *No Markup* (the text as it would read with every change accepted) or *Original*, and accepts or
  rejects change by change or all at once. Comments sit in a margin with lines to their spans.
- **Google Docs** has a *Suggesting* mode: the editor types and every change becomes a suggestion with an Accept and
  Reject beside it; students and counselors already know this one.

We take: suggestions as whole changes a student accepts or rejects one by one or all at once; the three ways of seeing
the text (with changes, as it would read, as it was); colors per author; a legend. We leave out: a rich-text editor,
per-character tracked typing, and comments in a margin. The editor stays a plain `<textarea>` (workspace.md "The
editor": the destination is plain text, and the field is what phones, dictation and screen readers handle), so
suggestions and marks are drawn **around** it, never inside a contenteditable.

## The two pieces

### 1. Suggestions
An editor's proposed text for the whole draft, stored once, shown as the changes between it and the text it was
written against.

**Who may suggest.** Anyone who may read the draft and isn't the student: a guardian in the household (today), a
counselor with a grant ([../counselor-portal.md](../counselor-portal.md), when it ships). The same rule as comments:
suggesting needs no `can_edit` on the membership, because a suggestion changes nothing until the student accepts it.

**How an editor suggests.** On the draft page, where a parent today sees the field read-only, a **Suggest changes**
button opens their own copy of the text in a second field, prefilled with the current draft, with the same count bar.
They edit freely (retype a sentence, move a paragraph, fix a word), add an optional note ("Tightened the opening;
your call on the last line"), and press **Send suggestions**. Under their field a live line reads "3 changes" and a
preview shows them as the student will see them. An editor with an open suggestion sees it on the page as "Waiting
for {first}" with the changes marked, and may **edit it** (which replaces the proposed text) or **withdraw** it until
the student has decided anything; once the student has accepted or rejected a change, it is the student's.

**What the student sees.** A banner above the field: "{Name} suggested 3 changes" with **Review**. Review opens
**Review changes**, a read-only rendering of the draft (paragraphs, the same type as the field) with each change
inline: deleted words struck through, inserted words underlined, both in the editor's color, and under each change
**Accept** and **Reject**. Above it, three toggles as Word names them, in plain words:

| Toggle | Shows |
|---|---|
| **With changes** (default) | The draft with every open change marked |
| **As suggested** | The text as it would read if every open change were accepted |
| **Original** | The draft as it is now, without the suggestions |

Plus **Accept all** and **Reject all** for the editor's suggestion, each asking once. With two editors' suggestions
open at the same time, the view shows one editor at a time (a chip per editor at the top, their color), so a change
never has two owners. Deciding the last change closes the suggestion; the banner goes; the version list gains a line.

**Back to writing.** **Write** returns to the field. A suggestion with changes left is still open; its banner stays;
and its still-applicable changes are also marked in the field as colored underlines on the spans they would touch
(piece 2), so the student can see them while typing.

**What accepting does.** The server applies the change to the current body (not to the text the editor saw: the
student may have kept writing), saves, and records the decision. The body changes only this way, through
`decideSuggestion`, never by the editor's write. The version list gets one version per decided suggestion
("Accepted 3 of 4 changes from Jane", source `suggested`), the first time a change is accepted and then under the
ten-minute rule, like typing.

**When the draft has changed under a change.** Every change is located in the current text by its removed words and
their neighbors (below). If the student has since rewritten that spot, the change shows as **"The draft changed
here"** with the suggested words visible and a **Copy** button; it can still be rejected, and an edit by the author
of the suggestion refreshes all of them against the current text.

**The reader's fixes.** The reader's `mechanics` notes already carry the one piece of text Quad is allowed to
propose: the corrected word ([reviewer.md](reviewer.md) "What a note is", `fix`). In Review changes the newest read's
open mechanics notes with a fix appear as the reader's suggestion, in the reader's color, with the same Accept and
Reject: Accept applies the fix at the note's span (and marks the note done); Reject marks it ignored. Nothing else
from the reader ever becomes a change; the rule "Quad never writes essay text" holds (README.md, principle 1).

### 2. Marks in the draft
Colored underlines in the field under the spans that notes, comments and open suggestions point at.

- **Colors.** The reader's notes are **amber** (the margin marks' color today). Each person who has commented or
  suggested on this draft gets one color from a fixed palette in order of first appearance (blue, violet, green,
  rose, teal, then repeating), kept for the life of the draft so Mom is always blue here. The student's own comments
  are gray. A **legend** of chips above the field names each color ("Reader's notes · Jane · Mr. Alvarez") and each
  chip toggles its marks.
- **What is marked.** Open notes of the newest read (not done or ignored), open comments with an anchor, and the
  still-applicable changes of open suggestions (as a span of the words a change would replace, or a caret-width mark
  where words would be inserted). Resolved and stale items are not marked. Two marks on the same words stack as two
  thin bands under the text.
- **Hover and tap.** Hovering a mark (a pointer) or tapping it (a touch) opens a small popover beside the span: who,
  the first line (the note's observation, the comment's first words, "Suggests: …" with the new words), and
  **Open**, which scrolls the full card into view (the note in the reader's notes, the comment in the thread, the
  change in Review changes). A tap on a mark also places the caret there, so typing continues where the student
  looked. Escape or a tap elsewhere closes the popover. The underlines themselves are decoration (`aria-hidden`);
  the notes list, the comments thread and the Review changes list stay the accessible path, each with its "Show in
  the draft" button as today.
- **How it is drawn.** A **backdrop**: a `div` behind the field with the field's exact type, padding and width (the
  mirror Notes.tsx already builds to measure a span's position), holding the text with transparent color so only the
  underlines show, and an overlay of the same geometry above the field whose marked spans alone take pointer events.
  The field keeps a transparent background. The field auto-grows and never scrolls inside itself (workspace.md), so
  the backdrop stays aligned; it re-renders on input and on resize, and a span whose words moved or vanished drops
  out until the item is re-anchored (comments and notes are anchored to a paragraph and offsets, as today).
- **Phones.** The same marks, tap for the popover; the popover is a bottom sheet with Open. The legend scrolls
  sideways in one row.

## The model
```
essay_suggestions (id, essay_id, base_version_id, author_id, author_role, proposed_body text, note text null,
                   status: open | decided | withdrawn, decisions jsonb {change_key: accepted | rejected},
                   created, updated, decided_at null)
```
- `base_version_id`: the version the editor started from. Opening Suggest changes makes sure a version of the current
  body exists (as "Read this draft" does: if the newest version differs from the body, one is saved labelled "As
  {first} read it", source `typed`). The changes are always computed from the base version's body and the proposed
  body, so they never shift as the student writes; locating them in the current text is a separate step (below).
- `decisions`: by change key; a key absent is undecided. `status` turns `decided` when every change has a decision
  (the version list's line says how many were accepted); `withdrawn` when the author withdraws before any decision.
- One open suggestion per author per draft; sending again while one is open replaces its proposed body (and clears
  nothing: decisions so far stand, and undecided changes are recomputed).
- `essay_versions.source` gains `suggested`.
- Row-level security as comments: readers of the draft read suggestions; a reader who is not the student inserts
  (`can_read_essay` and not `is_own_essay`) and updates or deletes only their own open suggestion; the student
  updates only `decisions`, `status` and `decided_at` (a trigger refuses any other column from the student, and
  refuses a change to `proposed_body` once `decisions` is non-empty); nobody else writes. The body of the draft is
  changed only by the student's own `update` on `essays`, as today, which the Server Action performs after applying
  the accepted changes. The tables are revoked from `anon`; the Data API test that no essay table is served gains this
  one.

## The changes: how they are computed, named, located and applied
All pure, in `lib/essays/diff.ts` and `lib/essays/suggestions.ts`, pinned by tests.
- **Tokens**: the text split into words and the whitespace between them (a run of non-space characters is a word;
  paragraph breaks are their own token), so a diff never splits a word and a moved paragraph break is a change.
- **Diff**: a word-level shortest-edit diff (Myers) of base tokens against proposed tokens, with adjacent edits closer
  than three unchanged words merged into one change, and a change that is only whitespace inside a paragraph dropped.
  Written in-house (about 150 lines) rather than taking a dependency; the `diff` package is the fallback if it ever
  proves slow, which a 650-word draft will not.
- **A change** is `{ key, removed: string, inserted: string, before: string, after: string }`: the words taken out
  (empty for a pure insertion), the words put in (empty for a deletion), and up to three words of context either side.
  `key` is a hash of (`removed`, `inserted`, `before`, `after`, ordinal among identical changes), so it is stable
  across recomputation and never an index that an earlier accept would shift.
- **Locating in the current text**: find `before + removed + after` in the current body (whitespace-normalized);
  failing that, `removed` alone when it occurs exactly once; failing that, for a pure insertion, `before + after`
  adjacent. Found: the change is applicable and its span is the located words. Not found: stale ("The draft changed
  here"). A change already accepted is located by its `inserted` words for the mark's sake only.
- **Applying**: replace the located span with `inserted`, normalize the text as the editor saves it, recount. Accept
  all applies in order from the end of the text to the start so earlier spans stay valid; each applied change is
  re-located first, so a student edit between two accepts never corrupts the second.
- **Rendering "With changes"**: the current body with each applicable change's located span replaced by
  `<del>removed</del><ins>inserted</ins>`; "As suggested" applies every open applicable change to a copy; "Original"
  is the current body. Stale changes are listed under the text, not drawn in it.

## Where it shows
- **The draft page** (`/advisor/essays/<id>`): the student's field gains the legend and the marks; the banner and
  Review changes when a suggestion is open; **Write** and **Review changes** as two tabs above the field when there is
  anything to review. An editor's page gains **Suggest changes**, their open suggestion's state, and the marks (they
  see the reader's notes and others' comments as today, now underlined).
- **The Essays tab** ([tab.md](tab.md)): a row with open suggestions shows "2 suggestions" beside its open-comment
  count, for the student; for an editor, "Waiting for {first}" on rows with their own open suggestion.
- **The essays move** ([moves.md](moves.md)): unchanged; its card's count line already links the tab.
- **Export and the package** ([workspace.md](workspace.md)): the current text only; suggestions are never exported.
  Importing a `.docx` still drops its tracked changes with a notice; a parent who edited in Word pastes their text
  into Suggest changes instead, and the diff does the rest.

## Rules
- The student's words, always: no change reaches the body without the student's Accept; "Accept all" is one
  deliberate tap with a confirmation naming the editor and the count. Quad itself proposes only the reader's
  corrected word, as before.
- An editor never sees a mode where typing changes the draft. Their field is always their own copy.
- Nothing about a suggestion goes to analytics: counts and roles only, never text, never a prompt's college.
- A suggestion is a reader's artifact under the household's rule: a student's drafts are never hidden from a
  guardian, and a guardian's suggestion is never hidden from the student. There is no private draft of a suggestion.
- Deleting a draft deletes its suggestions (cascade); a withdrawn suggestion is kept for thirty days then purged with
  the planner's other removals, so "I sent that yesterday" can be answered.

## Telemetry
`essay_suggestion_sent {role, changes}`, `essay_suggestion_updated {role}`, `essay_suggestion_withdrawn {role}`,
`essay_suggestion_decided {accepted, rejected, stale, all: boolean}`, `essay_fix_accepted`, `essay_mark_opened
{kind: note | comment | change, via: hover | tap | legend}`. Never text.

## Privacy and the terms
A suggestion is the editor's writing about the student's draft, like a comment; the privacy page's essays paragraph
gains one sentence saying guardians and counselors can propose changes and the student decides. The reader's fix is
unchanged from reviewer.md's terms.

## Phones and accessibility
- Review changes on a phone: the rendered text at the field's 18 px, each change's Accept and Reject as 44 px chips
  under its paragraph when tapped (tapping a marked change selects it; the chips appear below the paragraph), the
  three toggles as a segmented control, Accept all and Reject all at the bottom.
- The popover is a bottom sheet on phones and a small card beside the span on a pointer device; it is a `dialog`
  with a close button; hovering never traps focus.
- Colors never carry meaning alone: the legend names each color, each change says who suggested it, and deletions
  are struck as well as colored. Contrast of each palette color's underline against the page is at least 3:1 in both
  themes; the popover text is normal text.
- Reduced motion: no animation on the popover or the scroll to a card beyond the browser's.

## Files (planned)
- Migration `…_essay_suggestions.sql`: the table, its policies and the student's-columns trigger; `essay_versions.source`
  gains `suggested`; the purge of withdrawn suggestions joins the existing purge function.
- `lib/essays/diff.ts` (tokens, the word diff, changes with keys), `lib/essays/suggestions.ts` (locate, apply, the
  three renderings, the status rule), `lib/essays/marks.ts` (spans of every open note, comment and change → segments
  with stacked colors; the palette and the per-draft color assignment; the legend), all pure.
- `lib/essays/store.ts`: `suggestChanges(essayId, proposedBody, note)`, `updateSuggestion`, `withdrawSuggestion`,
  `decideSuggestion(suggestionId, decisions)` (applies accepted changes to the body, saves, versions), `acceptFix(noteId)`.
- `lib/essays/load.ts`: suggestions with the draft and the tab's counts; `lib/essays/tab-view.ts` the row words.
- `components/essays/Marks.tsx` (the backdrop, the overlay, the popover, the legend), `SuggestBox.tsx` (the editor's
  field, the live count of changes, the preview, send, edit, withdraw), `ReviewChanges.tsx` (the rendering, the
  toggles, Accept and Reject per change and for all, the stale list, the reader's fixes), `Editor.tsx` (the Write and
  Review changes tabs, the banner, the field's transparent background and the marks), `Notes.tsx` (hands its spans
  to the marks; "Show in the draft" stays), `Comments.tsx` (the same), the tab's rows.
- Tests: `tests/essays-diff.test.mts` (tokens, the diff on the pinned cases, merged edits, whitespace-only dropped,
  stable keys across recomputation and after an earlier accept), `tests/essays-suggestions.test.mts` (locate in an
  unchanged, shifted, and rewritten text; apply one and all from the end; the three renderings; status after the
  last decision; the reader's fix as a change), `tests/essays-marks.test.mts` (segments with overlaps, colors by
  first appearance, the legend, stale spans dropped), `tests/essays-policies.test.mts` additions in PGlite (a
  guardian inserts and edits only their own open suggestion and can't touch the body; the student decides and can't
  edit `proposed_body`; a decision freezes the proposal; a stranger sees nothing; `anon` is revoked), and the page
  tests (the student sees the banner and both tabs; an editor sees Suggest changes and never a writable field; the
  Data API serves none of it).

## Complexity
Large: a new table with its own writing rules, an in-house word diff with locate-and-apply semantics that must be
right under concurrent editing, two new views on the draft page, and a drawing technique (the backdrop and overlay)
that must line up with the field on every phone. Built in units: the pure diff and suggestions model with the
migration; the marks; Suggest changes and Review changes; the tab and the move; QA.

## Owner decisions
1. **Suggesting needs only read access** (recommended): a parent without the household's `can_edit` flag can still
   suggest, because the student decides. Say if suggestions should instead require `can_edit`.
2. **The reader's fixes as one-tap changes** (recommended): a mechanics note's corrected word appears in Review
   changes with Accept. Say if the reader should stay notes-only.
3. **Telling the student** a suggestion arrived: the banner and the tab count in this part; an email or digest line
   later with the follow-colleges digest, not here. Say if a notification belongs in this part.

## As built (2026-11-01)
Units U1 (the migration, the diff and suggestions model, the Server Actions, the reads) and U2 (the marks: the pure
model, the context, the backdrop/overlay/popover/legend) merged into `feature/essay-editors`. All three owner
decisions above were built as recommended (suggesting needs only read access; the reader's fixes are one-tap
changes; telling the student is the banner and the tab count, no email). What follows is read from the code on the
integration branch, not from the plan above; where they disagree, the code is what shipped.

**The table and its rules** (`supabase/migrations/20261101120000_essay_suggestions.sql`): `essay_suggestions` as
planned, with one change from the spec's model. The spec's `base_version_id` pointed at "a version of the current
body", made on demand by saving one labelled "As {first} read it" if the newest version didn't already match. That
version can't be made this way: the author proposing a suggestion is a guardian or counselor, and only the student's
own `update` on `essays`/`essay_versions` can insert a version. **Deviation**: the table instead carries a
`base_body text` column (≤100,000 chars) holding the exact text the editor started from; `base_version_id` is
nullable and is filled in only when the *newest existing* version's body happens to already equal the current body
at the moment of suggesting. Every change is computed from `base_body`, so "As {first} read it" is never written and
never shown in the version list.

Row rules, enforced by two triggers (not just policies, because "who changed what column" can't be expressed in a
`using`/`with check` alone): before insert, the author is always the caller (`auth.uid()`, whatever the row claims),
always `role: 'guardian'` (the counselor portal's own grant sets `counselor` later), always `status: 'open'` with
empty `decisions`; the student can never insert on their own draft (the trigger raises `essay_suggestion_own`).
Before update: **the open suggestion's author may change `proposed_body`, `note`, or withdraw it (`status →
'withdrawn'`), but only while `status = 'open'` and `decisions = '{}'` — once the student has decided even one
change, the author's own row is frozen** (`essay_suggestion_decided`); the student (`is_own_essay`) may change only
`decisions`, `status` (→ `decided`), and `decided_at`; anyone else, or any other column, is refused. No delete
policy exists: a withdrawn suggestion is kept forever, not purged. **Deviation**: the spec says a withdrawn
suggestion "is kept for thirty days then purged with the planner's other removals"; there is no existing purge
function for a thirty-day job to join (the planner's removals run through a different mechanism this part doesn't
touch), so the purge was not built and withdrawn rows are never deleted. Building it is future work, not done here.

**The diff and the locate rule** (`lib/essays/diff.ts`, `lib/essays/suggestions.ts`): a hand-written Myers word diff
over tokens (a word, a run of whitespace, or a paragraph break), adjacent edits within three unchanged words merged
into one `Change`, exactly as specified. Two details the spec left implicit, as built:
- **Locating a change in the current text matches only at word edges**: `removed`/`inserted` text is searched for as
  a substring, but a hit only counts when the character before it (if any) and the character after it (if any) are
  whitespace or the string's edge — a change whose `removed` text is "act" can never match inside "react" or
  "reaction". This is `occurrences()`'s `edge()` check in `suggestions.ts`.
- **The change's key carries no literal ordinal field the code can read back**; when two changes with the same four
  strings (`removed`, `inserted`, `before`, `after`) exist, `locateChange` needs to know which occurrence in the
  current text is "this" change's. Rather than storing the ordinal anywhere, `ordinalOf()` recomputes the key for
  ordinals `0..63` against the change's own four strings until one matches the stored key, and uses that number.
  It is a few dozen hash computations, not a lookup, and it is why `changeKey`'s inputs must stay exactly as
  specified (any change to the hash's recipe would silently break ordinal recovery for old keys).

**Versioning on accept**: the spec says a decided suggestion's acceptances get "one version ... the first time a
change is accepted and then under the ten-minute rule, like typing", with the label "Accepted 3 of 4 changes from
Jane" appearing once the suggestion is fully decided. As built, `decideSuggestion` forces a version on the *first*
accepted change of a suggestion (`forceVersion`, checked by "does `decisions` already contain an `accepted` before
this call") and separately forces one — through `saveEssay`'s existing "a version on every `mark`" rule — on the
call that completes the suggestion (`status` turning `decided`), carrying the `suggestionLabel` text. A suggestion
decided in one call where the first accept is also the last decision makes one version with the label, not two;
one decided over several calls makes one unlabelled version at the first accept and one labelled version at the
last decision, with ordinary ten-minute versions possible in between if the student kept typing.

**`acceptFix` refuses when the words moved**: the reader's `fix` replaces the text at the note's span, but only
when the words at that span in the *current* draft still read exactly as they did in the version the reader
reviewed (`spanOffsets` resolved against both the current body and the reviewed version's body, compared
character-for-character). If the student rewrote that sentence since the review ran, `acceptFix` returns "The
draft changed here" and changes nothing; the note stays open for the student to deal with by hand. This matches
the spec's general stale-change behavior, applied to the reader's one-tap fix as well as a guardian's suggestion.

**The reads** (`lib/essays/load.ts`, `lib/essays/tab-data.ts`): `readEssay` returns `suggestions` (every
non-withdrawn row, newest first, with `author_name`); `readEssays` and the tab's own read return `openSuggestions`
(open count per draft) and, for a guardian viewer, `mySuggestions` (their own newest non-withdrawn suggestion's
`open`/`decided` state per draft) — a failed or missing-table read returns no counts rather than failing the page,
as the rest of the tab's reads do.

**The marks** (`lib/essays/marks.ts`, `components/essays/{marks-context,Marks}.tsx`): built to the contract — the
backdrop/overlay pair measured off the field's mirror, colors assigned in order of first appearance (reader amber,
the student's own comments gray, everyone else blue/violet/green/rose/teal repeating), the popover and the legend.
No deviation from the plan found in this read of the code.

### Suggest changes and Review changes (U3)
- **The editor's box** (`components/essays/SuggestBox.tsx`, shown only when the viewer can't write): **Suggest changes**
  opens the editor's own copy of the draft in a second field with the count bar, a note (up to 2,000 characters), the
  live line "{n} changes", a preview of the changes, and **Send suggestions**. Unsent text is kept in this browser
  (`quad.essay.<id>.suggest.<userId>`) and cleared on send; Cancel asks "Discard what you've changed here?" when the
  text differs. With their own open suggestion the box reads "Waiting for {first}" with the changes marked, plus
  **Edit your suggestions** and **Withdraw** (asks first); both disappear once the student has decided anything.
- **The student's page** (`Editor.tsx`): when any suggestion is open, or the newest read has an open mechanics note with
  a fix, two tabs sit above the field, **Write** and **Review changes** (with a count), and a banner reads "{Name}
  suggested 3 changes" per editor ("A parent" / "A counselor" when the name is unknown); the count is the suggestion's
  total, and Review changes shows what is left. The field stays mounted while reviewing. A decision flushes the pending
  autosave, calls `decideSuggestion`, swaps in the returned body and `updated` with no conflict prompt, and refreshes
  when a change was applied or the status turned decided.
- **Review changes** (`components/essays/ReviewChanges.tsx`, helpers in `lib/essays/review-view.ts`): a chip per editor,
  oldest suggestion first, the reader's fixes last as "Reader's notes"; **With changes** / **As suggested** / **Original**;
  each change one element (`id="change-<key>"`) with **Accept** and **Reject** inline on a pointer device and under its
  paragraph after a tap on a phone; **Accept all** / **Reject all** confirm inline ("Accept all 3 changes from Jane?"):
  Accept all takes only the changes that still fit, Reject all every undecided one, stale included. Stale changes are
  cards under the text: "The draft changed here", the suggested words, **Copy**, Reject. Taps are optimistic.
- **The reader's fixes**: the newest read's open mechanics notes with a `fix` are the reader's changes; Accept calls
  `acceptFix` (from the end of the text to the start), Reject marks the note ignored through the review route. The
  "As suggested" view for fixes applies them at the notes' spans (a fix has no context words, so the general locator
  is not used). A small context (`components/essays/fixes-context.tsx`) hands the fixes from the notes panel to the
  Editor and a note's new state back.
- **Marks for changes**: the student sees every open suggestion's changes underlined in Write; an editor sees only
  their own ("You"), since only those have a card for Open to reach. Open on a change mark switches to Review changes
  and scrolls to the change.
- **Not verified in a signed-in browser** before the PR (no test account in the build): the real Server Action round
  trips, the version list refreshing after a decision, Copy, and the phone tap-to-select flow on a touch device; the
  owner's first pass on the dev site covers these.
