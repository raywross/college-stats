---
title: A plan for an iPhone app
pr: 94
date: 2026-10-07
kind: plans
summary: A plan for a native iPhone app with everything the site does, fed by a new screen API so the app shows the same numbers, words, and citations as the site.
---

## What's planned

The site works on a phone's browser today. An app would open on the college you looked at last, keep working on a
campus tour with poor signal, sign you in with Face ID, and share a college with a tap. The plan is for an iPhone app
with **every feature of the site**: home, Explore with its four views and every filter, each college's overview and
six topic pages, Compare with its seven topic pages and the full table, the glossary, the Data page, the national
trends, high schools, the roadmap and these release notes, and, when signed in, your account and household, your
numbers, your saved lists, and the colleges you follow.

Three ideas run through it:
- **The app never computes a number.** Every figure, percentile, takeaway, and citation comes from the site's own
  code on the server, so both show the same thing at the same moment and the "where does this number come from" tap
  works in the app exactly as on the site.
- **Screens are described by the server.** When a page on the site gains a new section, the app shows it without an
  App Store update.
- **The same links.** Every site address opens in the app, and everything the app shares is a site address, so
  someone without the app lands on the same page.

Signing in adds Sign in with Apple beside email and password. Public data stays free and signed out, and the age
rule stays 13 and older.

## Behind the scenes

The three specs are in `specs/iphone-app/` and on the roadmap under a new "Native apps" group
([overview](/roadmap/iphone-app)): the screen API (`/api/app/v1`, built over the same `lib/` code as the pages,
with a fixed block catalog and an OpenAPI document the Swift models are generated from), the SwiftUI app (the
options scored, architecture, universal links, offline cache, Supabase Auth, design tokens generated from the site's
CSS, accessibility, telemetry, release, phases, tests), and a page-by-page parity map that every phase is checked
against. Phase 1 is everything that works signed out; phase 2 is accounts and reaches parity.
