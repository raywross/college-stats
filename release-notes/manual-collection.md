---
title: A plan for documents a person has to open
pr: 92
date: 2026-10-06
kind: plans
summary: A plan for reading the public documents our automated readers aren't allowed to fetch, starting with high school profiles, at a person's pace and with a person watching.
---

## What's planned

Many schools and organizations publish documents for people to open but ask automated readers to stay out. Our
readers obey, which is why most high school profiles, some campus directories, and the federal graduation-rate
files have been out of reach. Roslyn High School's profile reached the site because a person opened it in a
browser once.

This plan makes that a routine:
- **A list** of every public document we know about but can't read by machine, with why, and what it would fill in.
- **An order**: documents that fill a field for thousands of schools first, then this year's documents for the
  schools and colleges people are waiting on, then earlier years, newest first.
- **A pace**: a person's pace, spread across many sites rather than many visits to one.
- **A supervised session** in which an assistant does the clicking in the owner's own browser while the owner
  watches, and the document goes through the same checks and gets the same citation as any other.

Nothing in it signs in, waits out a challenge, or hides what it is. Where a site's terms rule out even that, the
plan is to ask.

## Behind the scenes

The spec is `specs/manual-collection.md`: the inventory schema, the priority tiers, the wave scheduler and its
constants, the browser-session skill, from-file entry points for each existing extractor, an ask track, and an
archive route for profile history to be measured before it is built. One access-rule decision is open for the owner.
