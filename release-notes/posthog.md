---
title: Usage analytics with PostHog
pr: 100
date: 2026-10-08
kind: infra
summary: The site now counts how people use search and Compare, and reports page errors, so we can see what helps and fix what breaks.
---

## What's new

Nothing changes on screen. The site now records a few anonymous actions: picking a school from search, adding or
removing colleges in Compare, opening a comparison, and choosing a field in "Your major". When a page crashes, the error
is reported so we can fix it quickly.

## Behind the scenes

- PostHog runs in the browser through Next.js's client instrumentation file, with exception capture turned on
- Server logs from the revalidation route go to PostHog over OpenTelemetry
- Two new settings, the PostHog project token and host, turn it on. Without them it stays off, and local development
  prints a warning instead of failing
