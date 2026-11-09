---
title: "The admin console's Data page has a way in, and the Inbox says when a publish is waiting"
pr: 235
date: 2026-11-09
kind: fix
summary: On wide screens the admin console's side menu now links each section's front page, the Data section lists its Overview, and the Inbox shows a row when changes have waited more than two hours for a publish.
---

## What's new

Nothing changes on the site for students, parents, or counselors. This is a fix to the admin console that shipped
yesterday.

**A way in.** On a wide screen, the console's side menu named each section (Steward, People, Data, More) as a plain
heading, so the Data section's front page, where the Publish now button lives, could be reached only by typing its
address. Section names are now links, and Data lists an **Overview** entry first.

**Knowing a publish is waiting.** Changes to the data usually publish themselves within minutes. When they don't,
because they were made outside a scheduled job, the Inbox now shows a row, "N changes are waiting for a publish",
with the Publish now action, once the oldest has waited more than two hours. The Live version tile says how many
are waiting.

## Behind the scenes

The side menu's door headings became links with the same look, marked current only when no screen shares their
address. The Data door's screens gained an Overview at its landing, and a landing no longer lists itself among its
cards. The Inbox's new row reuses the Data page's one changes query; tests cover the two-hour rule and the tile note.
