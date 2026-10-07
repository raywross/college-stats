---
title: A plan for fewer failed deploys and faster search
pr: 98
date: 2026-10-07
kind: plans
summary: A plan to have the site read its college data from the files it deploys with, keep the database for people's data, and run the search box in the browser, so deploys stop failing and search answers as you type.
---

## What's planned

Three things have been going wrong behind the scenes: site updates sometimes failed, the database sometimes gave
out, and the search box was slow. They share a cause. The live site has been downloading its whole college dataset
from the database, once when a new version is built and again every time the host starts a fresh copy of the site,
even though the same data is already shipped with every update. Updates and data publishes ran at the same moment
and got in each other's way. And every letter typed into a search box went to the server for an answer.

The plan:
- **The site reads its college data from its own files.** Every update carries the data; nothing is downloaded from
  the database to show a college. An update is live when it's deployed, with nothing else that can fail.
- **The database keeps what it should:** accounts, households, lists, the planner, high schools, and the record of
  what changed that feeds the update emails. If it is ever paused or busy, the public pages and search keep working;
  only signing in waits. The free plans stay for now.
- **Search runs in your browser.** A small index of college names, nicknames, and places loads once; typing matches
  against it instantly, on the first visit as well as later. Explore's text filter stops reloading the page on every
  pause in typing.
- **Measure, then decide more.** Cold-start counts and page times are logged, and further steps (precomputing more at
  build time, a warm instance) are listed with the numbers that would justify each.

Nothing changes in what the pages show or in where any number comes from.

## Behind the scenes

The spec is `specs/serving-architecture.md`, on the roadmap under Platform. It records the measurements (the dataset
is 16.7 MB now, parsed in about 300 ms from disk; a cold load from the database is about nine sequential requests;
every dynamic request ran a version query; the publish swapped the colleges table under a running build), weighs the
client-server alternative, and lays out four phases: the environment switch and tracing fix, the browser search
index, cheaper Explore renders, and the retirement of the dataset tables a cycle later. The open decision in
`specs/database-architecture.md` is now decided, and `specs/supabase.md` carries a note that its serving section
describes the state until this lands.
