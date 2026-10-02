---
title: "Wave 2 history goes live: history publishes in batches"
pr: 44
date: 2026-10-02
kind: fix
summary: The Over time charts and home-state maps for wave 2 now reach the live site. History and detail files upload in batches instead of one swap that had grown too big.
---

## What's fixed

- **Over time and "Where first-years come from" show wave 2's data.** After wave 2, the colleges published (#43),
  but the history upload (20 MB) timed out, so the charts and home-state maps still showed the previous build. History
  and detail files now upload 150 to 200 colleges at a time.

## Behind the scenes

- While an update is uploading, a visitor can briefly see some colleges' new history and some old. Every college's
  history is complete either way, and the publish reads everything back and compares it with the files at the end.
- No database change was needed.
