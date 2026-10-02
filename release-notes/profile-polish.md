---
title: "Search results on top, and a tidier Over time page"
pr: 48
date: 2026-10-02
kind: fix
summary: The home page's search results no longer hide behind the numbers below them, and a college's Over time page now has the same side list as the other profile pages.
---

## What's new

- **Home search.** Typing a college name on the home page showed results that were cut off and sat behind the
  "1,893 colleges" tiles, especially on phones. The results now float above everything else.
- **Over time page.** On a desktop, the chart groups (Cost, Aid, Admissions, and so on) are listed down the right
  side, where the other profile pages keep their "On this page" list, so the page looks and works like the rest of
  the profile. On phones the row of pills is unchanged.

## Behind the scenes

The hero section clipped the dropdown with `overflow-hidden` and painted below the tiles; its background blobs now
clip inside their own wrapper and the section stacks above what follows. The Over time page passes a side list
(`HistoryGroupNav`) into the shared topic-page frame; the list and the charts share the active group through a small
store (`lib/history-group-store.ts`), so a pick in either writes `?group=` as before.
