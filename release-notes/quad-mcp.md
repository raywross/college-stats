---
title: "Use Quad in ChatGPT, Claude, and Gemini"
pr: 172
date: 2026-10-20
kind: feature
summary: Your assistant can now answer college questions with Quad's numbers and Quad's citations, through one address that works in ChatGPT, Claude, and Gemini, a skill file you can upload, and a page that walks you through each.
---

## What's new

- **One address for your assistant.** Quad now runs a connection that ChatGPT, Claude, and Gemini can all use (an
  "MCP server", the standard the three share). Connected, your assistant can look up any of about 1,900 colleges, pull
  a college's facts with the source and year beside each number, compare two to four colleges, filter the whole set the
  way Quad's Explore page does, and look up what a term means.
- **A skill file.** If you'd rather not connect anything, download the Quad skill and upload it to Claude, Gemini, or
  a ChatGPT workspace. It teaches the assistant how to use Quad's public pages and how to talk about what Quad says:
  carry the citation, link the college's page, and never invent a person's chances.
- **A page that shows you how.** [Connect](/connect) has the steps for each assistant, with the exact menus as of
  this writing, a button that opens Claude with the form filled in, and copy buttons for every address.
- **What it can't see.** The connection is public and read-only. It has no access to your account, your household,
  your student's numbers, lists, or plan, and it never gives odds; Quad's estimate stays in the signed-in plan.

## Behind the scenes

The server lives at `/mcp` and answers the Model Context Protocol over plain JSON with no session, so it runs on the
same deployment as the site. Its seven tools reuse the site's own search, the Compare table's rows and formatting, and
Explore's filter parser, so every number an assistant gets is the one a visitor sees, cited by the same lineage. The
same operations are plain `GET` endpoints under `/api/v1` with an OpenAPI document, limited to about sixty requests a
minute per address. The skill file is built on request so its addresses always match the deployment. Nothing under
the new code can import the estimate, the selectivity index, or the planner; a test fails if it ever does.
