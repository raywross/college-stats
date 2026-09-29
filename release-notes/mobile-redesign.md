---
title: A redesign for phones
pr: 19
date: 2026-09-29
kind: improvement
summary: A bottom tab bar, swipeable rows, compact search results, and no more sideways scrolling on phones.
---

## Why

On phones, pages scrolled sideways into empty space and were crowded: they rendered 644–857 pixels wide on a
390-pixel screen, and ran up to 16,700 pixels tall.

## What's new

- **A bottom tab bar**: Home, Explore, Search, Compare (with a count), and More (Glossary, Data, and the theme
  switch). It replaces the menu button and the floating compare button.
- **Swipe rails** for home shortcuts, leaderboards, What's changed, similar schools, and compare suggestions.
- **Compact search results**: about 90-pixel rows with acceptance rate, SAT, size, and cost, instead of 460-pixel
  cards.
- A compact profile header, a slim sticky compare bar, a sticky first column in Compare tables, and a sticky glossary
  search.

| Page (390 × 844) | Width before → after | Height before → after |
|---|---|---|
| Home | 770 → 390 | 11,133 → 6,432 |
| Explore | 415 → 390 | 12,733 → 3,942 |
| Profile (Harvard) | 778 → 390 | 16,731 → 14,730 |
| Glossary | 857 → 390 | n/a |
| Compare | 390 → 390 | 10,246 → 9,737 |

Desktop is unchanged.

## Behind the scenes

The sideways scrolling had two root causes, both fixed at the source: about 50 grids with no base column template,
and screen-reader text escaping horizontal scrollers. New tests fail if either comes back. Details:
[mobile.md](../specs/mobile.md).
