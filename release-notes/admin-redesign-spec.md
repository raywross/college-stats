---
title: Plan for a simpler admin console, with the Data Steward in charge
pr: 221
date: 2026-11-08
kind: plans
summary: A spec for rearranging the admin console around the Data Steward, with an inbox of what needs a person, plain words with help icons, and a phone layout.
---

## Why

The console grew one section at a time and now has fourteen entries in its menu, the same decision on three screens,
and the code's own words on its pages. The Data Steward, which should be the way most data work gets done, sits five
screens deep. On a phone, eleven of its tables scroll sideways.

## What is planned

- **Four doors**: Steward, People, Data, Settings. The Steward's **Inbox** becomes the home: what needs a person,
  what the Steward did, and how things stand.
- **The Steward reads every job's outcome**, flags what looks wrong, repairs a short list of safe things itself, and
  recommends the rest.
- **Plain words** everywhere, an info icon on every panel, and a Help page for the console's own terms.
- **A phone layout** with a tab bar and card lists instead of sideways tables, checked on every screen.

Nothing changes yet. The spec is on the roadmap as a planned item and lists the decisions the owner makes before
the build.
