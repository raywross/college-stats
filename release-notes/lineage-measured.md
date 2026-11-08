---
title: The cold-start change, measured on the live site
pr: 230
date: 2026-11-08
kind: plans
summary: After the first data publish in the new layout, a freshly started server loads the college data in about 0.6 s instead of about 1 s; this note records the numbers.
---

## What's new

Nothing changes on the site; this records what the last two releases did. A server instance that has just started
now loads the college data in a little under 0.6 s, down from about 1 s, so the first visitor to reach it waits
about half a second less. Every citation on every page still shows.

## Behind the scenes

The publish that switched the data to the split layout went out this evening. Running servers picked it up in the
background with their citations intact, and the deploy that followed bundles the new layout, so cold starts read the
smaller file and load each college's citation records only when something asks for them.
