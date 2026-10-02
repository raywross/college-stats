---
title: "Guide: how the database is shaped for what's coming"
pr: 40
date: 2026-10-02
kind: plans
summary: A written guide on why the public college data stays as published JSON documents while accounts, lists, and other user data get ordinary database tables with access rules.
---

## What changed

Nothing on the site. A new guide in the specs answers a question the roadmap raised: the site stores each college as
one JSON document that is replaced whole on every data publish. Does that still fit once there are accounts,
saved lists, family finances, award letters, high school data, and an API?

The answer is that the database has two parts. Public data (colleges, their history, and later high schools) stays
as published documents mirrored from the reviewed files, because every page needs all of it at once and a publish
must be all-or-nothing. User data gets regular tables with typed columns and row-level access rules, so a parent's
finances can never be read by a student and small-count thresholds live in the database, not the app.

## Behind the scenes

The guide also proposes one shared way to publish any document collection (today each has its own functions), says
when the load-everything-into-memory pattern stops fitting (24,000 high schools; earnings by major across every
college), and leaves one decision open for the formal release: whether production reads the public dataset from the
build or from the database.
