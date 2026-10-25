---
title: "A clearer path from your key to ChatGPT and Gemini"
pr: 174
date: 2026-10-25
kind: improvement
summary: The API keys page now says plainly that ChatGPT and Gemini don't use a key, and links to the steps that do work.
---

## What's new

- **If you made a key hoping to use it in ChatGPT or Gemini:** the API keys page now says up front that those two
  don't take a key — their connector menus can't accept one — and links straight to
  [Connect](/connect) for the address and the steps that do work.
- **Right after making a key**, the same note now sits next to the curl, Claude Code, and Claude Desktop/Cursor
  snippets, so it's there exactly when you're looking for it.

## Behind the scenes

- `app/account/api-keys/page.tsx` and `components/account/api-keys/MakeKeyForm.tsx` both gained a line pointing to
  `/connect`; no behavior changed, since ChatGPT and Gemini already used the public, keyless MCP address documented
  there (`specs/product/assistants.md`).
