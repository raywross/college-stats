---
title: "A testing view of every next step, by season"
pr: 171
date: 2026-10-20
kind: infra
summary: A setting, off on the live site, that lists every next step a student could get by the season it belongs to, so each one can be tried and refined before families see it.
---

## What's new

- **Nothing changes for families.** The Next steps tab still shows the season's top three moves.
- **A testing view for us.** On test sites, the Next steps tab can show every move a student could get, from freshman
  year to the summer after senior year, each under the season we recommend it. Each one works for real (finish it,
  skip it, open its guide), so we can walk through every step and improve it.

## Behind the scenes

- Admins switch it on a new **Settings** page in the admin console, and each change is logged. It's stored in a new
  `app_settings` table (`planner.all_moves`; no row means off), written only through `admin_set_setting`.
- With it on, the season and cycle generators emit every move whatever their conditions, and the tab groups them by
  season (`lib/planner/all-moves.ts`).
- Turning it off removes the extra moves from each plan on its next open; turning it back on restores them.
- Spec: `specs/planner/v3/all-moves-preview.md`. Tests: `tests/planner-all-moves.test.mts`.
