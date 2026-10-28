# Part 2, The Workspace: Drafts, Versions, and the Round Trip With Docs and Word

> Status: **planned** 2026-10-28. Part 2 of [essays](README.md). After [prompts.md](prompts.md) (for the prompt picker;
> the Common App's main essay works without it). Builds on the advisor's guides
> ([../../planner/v3/now.md](../../planner/v3/now.md#the-guide-pattern)), the story guide
> ([../../planner/v3/guides/your-story.md](../../planner/v3/guides/your-story.md)), and the planner's tables
> ([../../planner/model.md](../../planner/model.md)). Part of [product](../README.md).

## Goal
One place for every essay a student writes for college: a draft per prompt, counted against its limit, saved as they
type on any device, kept in versions, reused where several colleges ask the same thing, moved to and from Google Docs
and Word without losing anything, shared with a parent or counselor when the student wants a reader, and handed back
as a package to paste into the real form. The owner's bar: "something really usable for students to work across
desktop and mobile devices."

## Research (2026-10-28)
- **Where students write today.** Google Docs on a Chromebook or laptop, Notes or Docs on a phone, Word where a
  school issues Office. Counselors review in Docs comments. The form itself is where the final text is pasted, and
  the form strips formatting: the Common App's essay field keeps paragraph breaks and little else, and counts words
  by whitespace. So an essay is plain text with paragraphs; anything richer is lost at the end anyway.
- **What goes wrong.** The wrong version pasted; a draft that fit 650 words in Docs that reads 653 in the form (a
  smart-quote or a line break counted differently); a "why us" written for one college pasted into another with the
  name unchanged; a draft that lived only on one device; a parent "helping" in the student's document.
- **Round trips.** Docs and Word both open `.docx`; a phone's share sheet sends a `.docx` or `.txt` to a web page's
  file picker; Google Drive's API lets an app create and read back the documents it created, under the `drive.file`
  scope, which covers only files the app made and needs no restricted-scope review.

## The editor
Plain text, by design, because the destination is plain text.
- **One field**, full width, large type (18 px on phones, never under 16 px so iOS doesn't zoom), auto-growing, no
  toolbar; paragraph breaks are the only structure. Smart quotes and dashes are left as typed and normalized on
  export the way the forms read them.
- **The count bar**, sticky at the bottom on phones and beside the field on desktop: words or characters as the
  prompt's limit counts them (the Common App's whitespace rule), "412 of 650", amber from 95%, red over; a prompt
  with no limit shows words alone. The count rule is one pure function with the forms' examples pinned in tests.
- **Autosave**: to the browser at once (a local draft per essay, so nothing is lost offline or on a dropped
  connection), to the server one second after typing stops; the server copy wins on a conflict only by the student's
  choice ("You edited this on another device; keep which?"). A draft reaches every device the student signs in on.
- **Versions**: every save after a pause of ten minutes, every import, every "mark a version" becomes a version with
  its source (typed, pasted, uploaded, from Docs) and its count; the student can open any version read-only and
  restore it. Nothing is ever overwritten silently.
- **Focus mode**: the field and the count only; the prompt a tap away above it; dictation and the keyboard's own
  tools work because it is a text field, not a custom editor. Undo is the browser's.
- **Reading the prompt**: the prompt, its limit, the college, and the deadline sit in the heading; "what this
  college says it looks for" (from [prompts.md](prompts.md)'s page) in a fold.
- Dark mode, Dynamic Type on the phone, VoiceOver: a labeled text field, a live region for the count at thresholds.
- The implementation is a `<textarea>` with the site's styles, not a rich-text library: it is the one control every
  phone keyboard, screen reader, and dictation feature already handles, and the forms want its output.

## The model
```
essays          (id, student_id, prompt_ref, title, body text, count_kind, count, limit_max, status, kind, base_id null,
                 created, updated)
essay_versions  (id, essay_id, body, count, source: typed|pasted|uploaded|docs|restored, label, created)
essay_links     (essay_id, prompt_ref)              -- one draft serving several prompts (the same "why us" for two colleges)
essay_shares    (essay_id, user_id, role: parent|counselor, can_comment, created, revoked)
essay_comments  (id, essay_id, version_id, author_id, anchor {paragraph, start, end} null, body, created, resolved)
essay_docs      (essay_id, provider: google, file_id, last_pulled, last_pushed)   -- phase 2
```
- `prompt_ref` is `platform:common_app:main`, `platform:coalition:<n>`, `college:<unit_id>:<cycle>:<n>` (from
  [prompts.md](prompts.md)), or `free` (a draft with no prompt yet).
- `base_id` marks a variant: a "why us" draft copied from a base draft for another college keeps the link, so the
  workspace can show "3 colleges use a version of this" and warn when the base changed after the variant was made.
- `status`: `draft`, `ready`, `submitted` (the student says so; it also marks the plan's apply card).
- Row-level security as the planner's: the student owns every row; a guardian or counselor reads through
  `essay_shares` only; the Data API never serves these tables.
- **Privacy rule.** A draft is the student's. The story text is student-only today (owner, 2026-10-16), and essays
  follow it: a parent sees a draft when the student shares it, per essay, and can comment but not edit; the student
  can revoke. The parent's plan shows counts ("4 drafts, 2 ready") without text. This is the one place the household's
  "parents see everything" default does not apply, because the essay is the student's voice and the colleges say so.

## Reuse
- **One draft, many prompts.** From a draft, "Use for another college" picks a prompt of the same kind and either
  links the draft (identical text expected, as for the main essay) or makes a **variant** (a copy with the base
  remembered) for prompts that differ in limit or wording. The college name in a variant is checked against the
  college it's for: a "why us" that names Duke on the Wake Forest draft gets a red line before anything else does.
- **The main essay** is one draft linked to every Common App college on the plan; its count uses the Common App's
  650-word limit.

## The round trip
Phase 1, no accounts with anyone else:
- **Download** a draft as `.docx` (one heading, the prompt in gray, the text; generated server-side with the `docx`
  library), `.txt`, or copy to the clipboard. **Download the package** for a college: every essay and short answer in
  prompt order, each under its prompt and limit, as `.docx` and `.pdf`, with the activities list in the Common App's
  shape ([../../planner/applications.md](../../planner/applications.md)) at the end.
- **Upload** a `.docx` or `.txt` (the file picker on desktop; the share sheet on a phone sends a Docs or Word file
  to the browser), read server-side (`mammoth` for `.docx`, text only), and saved as a **new version** with source
  `uploaded`, never over the current text; the student compares and keeps one. **Paste** does the same from the
  clipboard, which is how Notes and phone Docs come across.
- Normalization on import: Windows line endings, non-breaking spaces, and Word's smart punctuation are left in the
  text but counted as the forms count them; a `.docx` comment or tracked change is dropped with a notice.

Phase 2, after Google sign-in ships ([../../backlog.md](../../backlog.md) "Platform"):
- **Open in Google Docs**: creates a Doc from the draft in the student's own Drive (scope `drive.file`: the app sees
  only files it created), named "Quad · Wake Forest · Why us", and remembers it. **Pull from Docs** reads it back as a
  new version; **Push to Docs** writes the current text to it. Never automatic in either direction: a sync is a tap,
  and the version list shows each one.
- The Google OAuth client is the sign-in's; `drive.file` is a non-sensitive scope, so no verification audit beyond
  the sign-in's own.
- Word: no API round trip (OneDrive's needs a Microsoft app and consent screens for a smaller gain); the `.docx`
  download and upload cover it, and Word on iPad shares a `.docx` straight to the browser.

## Where it lives
- **`/advisor/essays`**: the list: drafts grouped by college with status and counts, the main essay first, "Write a
  new one" with the prompt picker (every prompt from the plan's colleges, the platforms' own, or free). The parent's
  version lists what is shared.
- **`/advisor/essays/<id>`**: the editor, the version list, share, download, upload, "use for another college", and
  the reviewer's notes ([reviewer.md](reviewer.md)).
- **`/advisor/essays/package/<unit_id>`**: the package page: everything for one college, with copy buttons per
  field and the download; a checklist beside it ("paste the main essay", "answer the short questions in the form",
  "re-read the limit in the form").
- **Reached from**: a **Write your essays** move on Now from the summer before senior year (the summer's writing,
  ranked 78 in [ranking.md](../../planner/record/ranking.md)); the apply card on each college's row; the story guide
  ("start from your story"); the count on the Colleges tab.
- **Phones**: the list is rows; the editor is the field and the count bar; the package page is cards with copy
  buttons; no sideways scroll ([../../mobile.md](../../mobile.md)).

## Rules
- Quad never writes essay text: no templates with blanks, no "generate a first draft", no sample essays in the
  editor. The prompt page's own advice is shown as the college's words, cited.
- An import or a pull never overwrites the current text; it makes a version the student picks.
- Nothing about an essay is sent to analytics: counts of drafts, versions, imports, and shares only, never a word
  of text, never a prompt's college in a property.
- Submission happens in the form, by the student; the package page says so in its first line.

## Telemetry
`essay_created {prompt_kind}`, `essay_saved_version {source}`, `essay_exported {format}`, `essay_imported {format}`,
`essay_shared {role}`, `essay_package_opened`; never text, never a title.

## Files (planned)
- Migration `…_essays.sql` (the tables, RLS, the per-student limit of 200 drafts), `lib/essays/{count,normalize,
  docx,variants}.ts` (pure), `lib/essays/store.ts` (Server Actions on the planner's `ready(capability)` pattern,
  capability `advisor.essays`), `app/advisor/essays/**`, `components/essays/{Editor,CountBar,VersionList,
  PromptPicker,Package,ShareSheet}.tsx`, `tests/essays-*.test.mts` (the count rule against the forms' examples; the
  normalizer; a `.docx` round trip byte-for-byte on text; RLS: a parent can't read an unshared draft; a variant warns
  when its base changed; the package's order).
- Phase 2: `lib/essays/google-docs.ts`, the Drive scope on the Google OAuth client, `essay_docs`.

## Complexity
Large: a new set of tables with their own sharing model, an editor that must be right on phones, file generation and
parsing, and later a Drive integration.

## Open questions
1. Should counselors (the portal, once built) see drafts by default for students they advise? Recommendation: no;
   the student shares, as with parents; the portal shows counts.
2. A `.pdf` of the package is for the family's printer; is a printable one-page "what's left to write" list more
   useful? Build both if the package page is cheap, else the package only.
3. Should the main essay's count warn at the Common App's 250-word minimum as well as the 650 maximum? Yes; the form
   enforces both.
