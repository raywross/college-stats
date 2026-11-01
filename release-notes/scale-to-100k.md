---
title: "Planned: ready for 100,000 students"
pr: 207
date: 2026-11-01
kind: plans
summary: A new roadmap item lays out how Quad will prove it serves 100,000 students, with an audit of every query a signed-in page makes, a load test at the expected peak, and the small fixes they surface.
---

## What's new

The roadmap gains "Scale to 100k students". It says what that many students means in traffic, why the public pages
already scale (they read a snapshot held in memory and never wait on the database), where the real risks are (the
database's compute tier and region, a few row-level policies and indexes, one write per profile view, digest email
volume), and the work: an audit, a load test against a seeded copy, and the fixes it finds, each measured before it
is made.

## Behind the scenes

- Three decisions are the owner's: the production database's compute tier and when to create it, whether signed-out
  profile views keep writing to Postgres or go to the analytics service, and the peak rate the load test should reach.
