---
title: An admin console, planned
pr: 138
date: 2026-10-12
kind: plans
summary: A plan for the place where the site's owner can find and fix any account, see what the site computes but never shows, watch each college's data freshness, and start reruns or approve data changes.
---

## What's new
Nothing on the site changes yet. The roadmap gains a plan for an **admin console**: one signed-in place for the
people who run Quad to help a family with their account (a lost password, a changed email, a child who needs linking
to a parent), to see which colleges have fresh data and which are going stale, and to start a data rerun or approve
a data change without leaving the site.

## Behind the scenes
The spec is `specs/product/admin.md`. It keeps the site's rules: no admin key on the web host (admins read through
database policies and write through checked functions, with one small function inside Supabase for the account
operations that need the master key), a second factor required to sign in as an admin, every action logged, and a
student sees "Quad support viewed your information" when an admin looks at their data, exactly as they see a
parent's views. Reruns and approvals go through a GitHub App with only the permissions those actions need.
