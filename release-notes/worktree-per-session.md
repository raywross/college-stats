---
title: One workspace per coding session
pr: 6
date: 2026-09-28
kind: infra
summary: Each AI coding session now works in its own git worktree, so parallel sessions can't switch branches or edit files under each other.
---

## Why

Several Claude Code sessions work on the site at once. When they shared one checkout, they changed branches and
edited files under each other: one session found its checkout moved to a different branch mid-task.

## What changed

- **The rule** (in `CLAUDE.md`): start every task in a new worktree under `.claude/worktrees/`, and run each dev
  server on its own port.
- **The guard**: a hook blocks file edits and branch-changing git commands in the main checkout. Read-only commands
  still work.
- **Keeping main current**: at the start of each session, a second hook fast-forwards the main checkout when it's
  clean, so new sessions start from the latest merged work.

Nine new tests run both hooks against throwaway repositories. This change was built from its own worktree.
