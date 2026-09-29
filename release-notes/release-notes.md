---
title: Release notes
pr: 31
date: 2026-09-29
kind: feature
summary: This page, which lists every change to the site with a short summary and a full page of notes for each.
---

## What's new

- **[Release notes](/release-notes)** list every change to the site, newest first and grouped by day. Each entry shows
  its kind (New feature, Improvement, Data, Fix, Plans, or Behind the scenes), a one-sentence summary, and a link to
  its full notes.
- **Each release has its own page**, with what changed, the details behind it, a link to the pull request on GitHub,
  and links to the releases before and after it.
- Notes go back to the first release of Quad.
- Linked from the footer, and from the More menu on phones.

## Behind the scenes

- Each note is a markdown file in `release-notes/`, one per pull request.
- Every pull request now has to add its own note. An automated check fails without one, so the page stays complete.

How to write a note: [release-notes.md](../specs/release-notes.md).
