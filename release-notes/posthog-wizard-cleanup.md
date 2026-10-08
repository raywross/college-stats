---
title: Tidying up after the analytics install
pr: 102
date: 2026-10-08
kind: infra
summary: Removes the setup guides the PostHog installer left in the repository, now that the site's own analytics design replaces them.
---

## What's new

Nothing on the site changes.

## Behind the scenes

The PostHog installer (#100) left a small folder of its own setup guides in the repository. They describe the
default-settings setup that [the telemetry build](telemetry.md) replaced: one init in the analytics provider, cookieless,
with autocapture off. Left in place, a future coding session could follow them and reintroduce a second init with
cookies and autocapture. The folder is gone; `specs/product/telemetry.md` is the reference.
