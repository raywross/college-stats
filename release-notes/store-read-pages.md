---
title: The data jobs read big collections in smaller pages
pr: 249
date: 2026-11-12
kind: fix
summary: A data job stopped before it started when reading every college's Common Data Set record in one request ran past the database's time limit; reads now shrink their pages when that happens.
---

## What's new
Nothing on the site changes. The job that gathers what colleges report about their newest class failed to start
on its first run after the fall-figures release, and the publisher would have hit the same wall on its next pass.

## Behind the scenes
The store reads a collection a thousand documents at a time. The Common Data Set records, 535 documents and 44 MB
after this month's rewrites, no longer fit in one request inside the database's 8-second statement timeout. A read
that hits that timeout now halves its page and asks again from the same place, down to 25 documents, instead of
retrying the same request and giving up.
