---
title: "A new home for the college data, phase 2"
pr: 203
date: 2026-10-31
kind: infra
summary: Every data pipeline now writes to the database instead of committing files, Quad's editors review and undo changes in the console, and a publish refreshes the site without a code change; the switch to serving from snapshots is a setting away.
---

## What's new

Nothing on the site yet: the pages keep reading the files in the deploy until the switch is turned. Behind the
console door, Quad's editors can now see every batch of data changes a pipeline produced, hold or undo one, and
settle the values the pipelines held for a person, without a pull request.

## Behind the scenes

- **The pipelines write layers.** College-reported figures, identity (sites, social accounts, brand colors), campus
  directories and the campus-life pilot, essay prompts, the Common App and Coalition memberships, the year-by-year
  history, the high-school data and the IPEDS/Scorecard base each write their own layer into the database as
  versioned documents, one change set per run. No data workflow commits a file or opens a pull request; each asks
  the publisher for a snapshot when it finishes cleanly, and a run that fails or trips its own checks is held for a
  person.
- **The publisher finishes the job.** It loads the failure and high-school tables when their layer changed, derives
  each college's trends from the history layer, and after moving the pointer waits, revalidates the site, and calls
  a deploy hook so the deploy carries the new snapshot bundled (cold starts download nothing).
- **The console.** Change sets (with a before-and-after view of any document, Hold, Publish anyway, Revert), Holds
  (Accept the value writes an edit, Reject, Re-run discovery), and the retirement of the console's file-committing
  path through GitHub.
- **Retired**: the publish-changes workflow (its jobs are publisher steps) and the nightly export of hand-read essay
  prompts (the publisher reads the table).
- **On the development project**: past and removed visit events were archived to the repository and the table
  compacted; every layer was imported; the first snapshot was published and served to a local copy of the site.
