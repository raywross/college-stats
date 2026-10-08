---
title: Faster search, and site updates that can't fail on the database
pr: 98
date: 2026-10-07
kind: improvement
summary: The search box now answers as you type from a small index in your browser, and the site reads its college data from the files it ships with, so an update is live when it's deployed and a busy or paused database can't take the public pages down.
---

## What's new

- **Search answers as you type.** The college search box in the header, on the home page, and in Compare's picker
  used to send every letter to the server, and on a fresh visit the first letters could come back with no matches
  until the server had warmed up. Now a small index of college names, nicknames, and places loads once in your
  browser, and every keystroke matches locally. The first letter is as fast as the hundredth.
- **Explore's text filter waits for you.** It now refreshes half a second after you stop typing, or when you press
  Enter, instead of after every few letters, and each refresh is cheaper on the server.
- **Updates can't fail on the database.** The site reads its college data from the files it deploys with, rather
  than downloading them from the database when it builds and again every time the host starts a fresh copy. A data
  update is live when its deploy is; nothing else has to succeed. If the database is ever paused or busy, every
  college page, Explore, Compare, the trends, and search keep working; only signing in waits.

Nothing changed in what the pages show or in where any number comes from.

## Behind the scenes

The plan and the measurements are in `specs/serving-architecture.md` (built the same day it was written, from the
owner's review). The dataset is 16.7 MB and parses from disk in about 300 ms once per server instance; before, a cold
instance made about nine sequential database requests for the same data and every dynamic page ran a version query
first. The dataset tables in Supabase (`schools`, `school_histories`, `school_details`, `school_aliases`, and their
publish functions) are retired by a migration; Supabase keeps people's data, the high-school table, and the record
of what changed between deploys, which a small GitHub job now writes after each production deploy (`npm run
publish-changes`, diffing two commits' files) so the update emails and the What changed panel keep working. The
search index is a static route, `/search-index.json` (522 KB, 99 KB compressed), matched with the same scorer the
server uses. Explore's filter facets and sources are computed once per dataset instead of on every render. The
`DATA_SOURCE` setting is gone; high schools have their own, `HIGH_SCHOOLS_SOURCE`.
