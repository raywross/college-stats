---
title: "A Data API, API keys, and Quad in ChatGPT, Claude, and Gemini"
pr: 172
date: 2026-10-21
kind: feature
summary: Quad's cited college data is now available to your assistant through one address that works in ChatGPT, Claude, and Gemini, to your own code through a keyed API with keys you make on your account, and to both through an MCP server with ten tools.
---

## What's new

- **One address for your assistant.** Quad now runs a connection that ChatGPT, Claude, and Gemini can all use (an
  "MCP server", the standard the three share), with no key. Connected, your assistant can look up any of about 1,900
  colleges, pull a college's record with the source and year behind each value, compare two to ten colleges with each
  one's percentile rank, read a college's year-by-year history, filter the whole set the way Quad's Explore page does,
  and look up what a term means. [Connect](/connect) has the steps for each assistant, a button that opens Claude with
  the form filled in, and copy buttons for every address.
- **A skill file.** If you'd rather not connect anything, download the Quad skill and upload it to Claude, Gemini, or
  a ChatGPT workspace. It teaches the assistant how to reach Quad and how to talk about what Quad says: carry the
  citation, link the college's page, and never invent a person's chances.
- **API keys on your account.** Signed in, open API keys on your account page, name a key, and copy it once. With it
  you get the same data as plain JSON over GET (a college's record, its history, the source behind every value,
  Explore's filters, national figures) at 5,000 requests a day per key, plus the MCP server at a keyed address with
  limits that are yours rather than your network's. The [Developers](/developers) page has every endpoint, the ten
  tools, the field registry, and the snippets for Claude Code, Claude Desktop, and Cursor.
- **What it can't see.** Both doors are read-only and show only what a signed-out visitor sees. Neither has access to
  your household, your student's numbers, lists, or plan, and neither gives odds; Quad's estimate stays in the
  signed-in plan.

## Behind the scenes

Two chats built an MCP server the same day: a keyed one as the roadmap's Data API, and a keyless one for the
assistants' menus, which can't send a key. They merged into one server with two front doors: `/api/mcp` behind an API
key, and `/mcp` behind a per-address limit. The tools reuse the site's own serializers, search, Explore filter parser,
and lineage, so every number an assistant or a script gets is the one a visitor sees, cited the same way; `fetch` is
the one tool that renders text, and it computes nothing. Keys are stored as hashes with row-level security, checked
by one database function that also counts the day's requests, and every request is recorded by endpoint and status,
never by its query. Tests hold the tool table, the spec, and the documentation page in step, and fail if anything
under the API ever imports the estimate, the selectivity index, or the admin console.
