---
title: "Plans: follow colleges and get an email when their numbers change"
pr: 42
date: 2026-10-02
kind: plans
summary: A new roadmap page describes following colleges, one email per data release summarizing what changed and for which years, and a public "What changed" panel on every profile.
---

## What's planned

Once accounts exist, you'll be able to **follow** the colleges you care about, and every college on your saved list
will be followed automatically. Each time the site publishes new data, you'll get **one email** listing what changed
at your colleges, in plain language and with the years: a new year of admissions figures, a revised price, a value
a college newly reports. Nothing personal goes in the email, only the same public figures the site shows, and
unsubscribing is one click.

Every profile also gains a public **What changed** panel, so visitors without an account can see that a college's
numbers moved and when. It was built in October: see [Accounts](/release-notes/accounts).

## Behind the scenes

Changes are detected once, when data is published, by comparing the previous publish with the new files field by
field, using the site's lineage records for the years and per-field tolerances so float noise never counts as a
revision. A daily job sends digests for publishes older than a day. The spec also settles the email provider
(Resend) that accounts will use for sign-in links. Nothing is built yet.
