---
title: The Roadmap
pr: 20
date: 2026-09-29
kind: feature
summary: A public roadmap lists every planned feature with a complexity rating, and each full spec is readable on the site.
---

## What's new

- **[/roadmap](/roadmap)** lists every planned spec (22 at launch), grouped by wave, each with a one-line summary, a
  complexity rating (Small, Medium, Large, or Extra large, with a reason), its status, its source, and what it depends
  on.
- **Each spec has its own page**, with a summary panel, a contents list, tables that scroll in place on phones, and
  previous and next links.
- Linked from the footer.

## Behind the scenes

- The pages are built from the markdown specs in the repository, so editing a spec updates its page on the next
  deploy. Links between specs stay on the site; other links go to GitHub.
- A test requires every spec marked planned to be on the roadmap, and every link and anchor to resolve.
