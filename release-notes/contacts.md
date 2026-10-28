---
title: "Real addresses to write to"
pr: 181
date: 2026-10-28
kind: improvement
summary: The privacy page, the Data page, and the advisor page now name an email address for the question at hand, and replying to any email from Quad reaches a person.
---

## What's new

- **Questions about your data** go to privacy@usequad.app, named on the privacy page beside support@usequad.app
  for account help.
- **Corrections and marks.** A college that wants its mark taken down, or anyone who spots a wrong figure, writes to
  data@usequad.app from the Data page; the request form on our public repository stays as a second route.
- **Counselors** write to hello@usequad.app from the advisor page.
- **Replies work.** Every email Quad sends, from the update digests to the advisor's reminders, now replies to
  support@usequad.app, where a person reads it.

## Behind the scenes

One module names every address (`lib/contacts.ts`), and a test fails if a page spells one itself, so an address
changes in one place. The advisor's own mail is to be sent from advisor@usequad.app, a setting on the host, with
replies routed to support. The hosting notes list each address and what it is for.
