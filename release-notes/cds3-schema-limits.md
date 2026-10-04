---
title: "College data agent: reading colleges' reports within the API's limits"
pr: 64
date: 2026-10-04
kind: fix
summary: "The agent that reads colleges' Common Data Sets asked for its answers in a shape too large for the API to accept; it now uses a compact one, so documents found on the next run are actually read."
---

## What's new

Nothing changes on the site yet. On its second live run, the agent found and saved Common Data Sets for several new
colleges, but the requests to read them were all turned away: the answer format it asked for was larger than the API
accepts. It now asks for a compact list instead, so the next run reads what it finds.

## Behind the scenes

- Structured outputs allow at most 24 optional and 16 union-typed parameters per request. The per-code schema had
  hundreds of each. The answer is now one required list of `{code, v, lines}`, and a test keeps every schema inside
  the documented limits.
- When a batched request fails, the review queue now keeps the API's own message, so the cause is visible.
- The data pull request's description no longer fails when a whole extraction call is in the review queue.
