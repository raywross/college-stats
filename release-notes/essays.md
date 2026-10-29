---
title: "Essays: the prompts, a workspace, and a reader's notes"
pr: 184
date: 2026-10-29
kind: feature
summary: Quad Advisor gains a place to write every application essay, with each college's own prompts and limits, versions, comments from parents, Word round trips, and a reader's notes that never rewrite a word.
---

## What's new

- **Your essays, in one place.** Quad Advisor has a new section, Your essays, with a plain editor built for a phone
  first: a count against each prompt's limit, autosave, versions you can go back to, and one draft reused across the
  colleges that ask the same thing. The personal essay and each college's supplements sit side by side.
- **What each college asks.** When a college publishes its essay and short-answer prompts, Quad reads them from the
  college's own page, word for word with the limit and whether each is required, and shows them on the college's
  "What it takes to apply" card with a link to the page. Your list says how many essays and short answers it adds up
  to. Colleges are added as their pages are read; none are on file yet today.
- **Word and Google Docs round trips.** Download a draft or a whole college's package as a Word file or plain text,
  work on it anywhere, and upload or paste it back. An import never replaces what's there: it arrives as a new
  version you compare and keep. The package page has a copy button for every field, because the application is
  still submitted in the college's or the platform's own form.
- **Parents read and comment.** A parent in the household sees every draft and every version and can leave a
  comment, on a passage or in general. Only the student edits.
- **A reader's notes, when you ask.** Read this draft returns a reader's observations and questions: a typo, a
  run-on, a sentence that doesn't answer the prompt, an essay that repeats the activities list, a "why us" that
  fits any college. The reader knows the prompt, what the student is trying to show, and what the college says it
  looks for. It never writes a sentence for you, never grades, and never guesses at a decision. Its guidance is
  distilled from admissions offices and university writing centers, and it is still being reviewed; expect it to
  improve.

## Behind the scenes

- A new reader for the college-reported engine (`scripts/lib/essay-prompts/`) finds a college's essay page, reads
  it once with a model into a checked record (every prompt and quote must appear on the page; a missing or stale
  cycle holds the record for review), and merges it as a cited `essays` block with one lineage record per college.
  The platforms' own prompts are a reference file.
- New tables with row-level security: only the student's own account writes a draft; guardians in the household
  read and write comments; the public Data API never serves them. Reviews and their notes are written only through
  one database function that enforces the daily and per-cycle caps.
- The reviewer runs on the server only, with a cached system block built from a rubric and a guidance corpus of
  54 institutional sources, a JSON schema for its notes, and a guard that drops any note offering wording, grading,
  or predicting. An evaluation harness with thirty fixture drafts runs from a hand-dispatched workflow.
