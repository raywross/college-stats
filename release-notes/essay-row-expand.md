---
title: "Tap a prompt's title to read the whole prompt"
pr: 196
date: 2026-10-30
kind: improvement
summary: On the Essays tab, a prompt's row keeps its short title, and tapping it now unfolds the college's full question beneath; the status on the right opens the draft.
---

## What's new

The Essays tab lists each college's prompts by a short title, such as "Essay (650 words) · “Share an essay on any…”",
so the list stays scannable. The whole question was only visible once you opened the draft. Now the title itself
unfolds: tap it and the college's full prompt appears beneath, in its own words; tap again to fold it away. The
status on the right ("Draft · 180 of 250 words", "Ready") is the way into the draft, and **Start** is where it was.

A prompt you added yourself for a college, where the site has no text to show, keeps a plain title.

## Behind the scenes

The row is a `<details>` element: the summary holds the glyph and title (a 44 px target, reachable from the
keyboard, with a chevron that turns), the fold holds the prompt. The status is the link to the editor instead of the
whole row. Tests cover the fold, the link, and the plain row.
