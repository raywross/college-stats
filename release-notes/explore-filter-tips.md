---
title: "Explore: the LGBTQ+ filters' explanations work cleanly"
pr: 78
date: 2026-10-04
kind: fix
summary: The ⓘ explanations on Explore's LGBTQ+ campus-life filters now sit beside each filter instead of inside it, which stopped an error on every Explore page.
---

## What's new

- **Explore → LGBTQ+ campus life**: the ⓘ next to "Has an LGBTQ+ center", "Gender-inclusive housing", and
  "Nondiscrimination covers gender identity" now sits beside each filter, as its own button.

## Behind the scenes

- Each ⓘ was a button inside the filter's own button, which browsers don't allow; the page logged an error and rebuilt
  itself after loading. A new check scans every page for a button inside a button so it can't come back.
