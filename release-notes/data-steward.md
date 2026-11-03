---
title: "Behind the scenes: the Data Steward"
pr: 214
date: 2026-11-01
kind: infra
summary: The Data Steward, a new helper behind the console, reads the figures our checks hold back, groups them by cause, checks each cause against the college's own document, and proposes fixes that a person approves before anything changes on the site.
---

## What's new

Nothing changes on the site by itself. Behind the console door, Quad's editors get a new way to work through the
21,000 college-reported figures our checks have held back: the **Data Steward** groups them into causes, reads the
colleges' own documents to see which values are right and which were misread, and writes proposals with the evidence
attached: the page, the line, and what it says. An editor approves, declines, or asks a question; approved rows become
the same corrections, holds and re-reads the console already makes by hand, cited to the document, and the next
publish carries them. Values the Steward can't prove stay held.

## Behind the scenes

- **Issues, Proposals, To do, Decisions, Audits** join the Data section of the console, and every college's page gains
  a Review tab listing what is pending for it with what visitors see today beside what is proposed.
- **The Steward runs in GitHub Actions** after each college-reported run and weekly for an audit of values that passed
  the checks, on a budget the script enforces ($5 after a run, $20 when started by hand, $40 a week). It can write
  only its own documents; approving is a person's act, logged.
- **Documents a person has to fetch** (a site that blocks us, a link that moved) land on the To do list with the page to
  open and why a machine couldn't, instead of sitting in the queue.
- Still to come: automating the code change for a rule the Steward finds wrong across many colleges; today that
  analysis is approved in the console and the fix is written in a session.
