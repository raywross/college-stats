# Release Notes

> Status: **built** 2026-09-29.

## What it is
`/release-notes` lists every change merged into `main`, newest first, grouped by day: each with its kind, PR number,
title, and a one-sentence summary. `/release-notes/{slug}` shows one release's full notes, with a link to its pull
request and older/newer links. One markdown file per PR in `release-notes/` is the single source.

## Writing a note (every PR)
Every PR adds `release-notes/<slug>.md`, where the slug is the branch name without its prefix
(`feature/loan-rate-history` → `loan-rate-history.md`):

```markdown
---
title: "Borrowing over time"
pr: 29
date: 2026-09-29
kind: data
summary: One plain-language sentence for the index: what changed for someone using the site.
---

## What's new

…
```

- **Frontmatter** (all required, nothing else allowed): `title`; `pr`, the PR's number; `date`, the day it merges
  (YYYY-MM-DD; update it if the merge slips); `kind`, one of `feature` (New feature), `improvement`, `data`, `fix`,
  `plans` (specs for coming work), or `infra` (Behind the scenes); and `summary`. Quote a title that contains a colon.
- **Body**: no `#` heading (the page shows the title). Lead with what a reader of the site gets, in plain language:
  `## What's new` (or `## What changed` / `## What was wrong` for fixes and infra), then `## Behind the scenes` for
  data and implementation detail. Keep numbers with their year, as on the site. Draw on the PR description, but write
  for readers of the site, not for reviewers: leave out test counts and review notes.
- **Links**: another note by file name (`[next release](loan-rate-history.md)`) stays on the site; a spec by relative
  path (`../specs/x.md`) becomes its roadmap page when it's planned, or a GitHub link otherwise; site pages by path
  (`/roadmap`).
- **The PR number** isn't known until the PR exists: open the PR, then commit the note with its number and push.

## Files
| File | Role |
|---|---|
| `release-notes/*.md` | One note per merged PR |
| `lib/release-notes.ts` | Pure: kinds and their labels, `parseReleaseNote` (throws on any bad field), note-to-note links, sorting, dates, and `releaseNoteProblem` for the PR check |
| `lib/release-notes-docs.ts` | Server-only loader: reads the folder and renders a note with the roadmap's markdown renderer (`lib/roadmap-render.ts`) |
| `app/release-notes/page.tsx` | Index: count, the kinds with their counts, then one list per day (the day heading is sticky on desktop) |
| `app/release-notes/[slug]/page.tsx` | One note: kind, date, PR link, title, summary, contents list on desktop, the body, older/newer |
| `components/release-notes/KindTag.tsx` | A kind's colored dot and label |
| `scripts/check-release-note.mts` | The PR check (below) |

## Guards
- **`tests/release-notes.test.mts`** (in `npm run verify`): every note parses, PR numbers are unique, notes sort
  newest first, links to other notes, roadmap pages, and site pages all resolve, and the PR check's rules hold. Each
  was confirmed to fail when broken (a duplicate PR number, a link to a missing note).
- **The `release-note` job in `.github/workflows/verify.yml`** (pull requests only): the PR must add or change a note
  whose `pr` is its own number, and every note it touches must parse. Run it locally with
  `PR_NUMBER=<n> node scripts/check-release-note.mts` after committing the note.
- **Static**: `generateStaticParams` + `dynamicParams = false`, and `next.config.ts` traces `release-notes/*.md` into
  both routes. A bad note fails the build as well as the tests.

## Where it's linked
Desktop: footer ("Release notes: what's new"). Phones: the tab bar's More sheet, after Roadmap ([mobile.md](mobile.md)).
The index links to the [roadmap](roadmap.md) for what's coming.

## History
Notes for PRs #1–#30 were written from their PR descriptions on 2026-09-29. #10 was closed without merging, so it
has none.
