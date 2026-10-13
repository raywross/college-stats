---
title: "Every new Common Data Set read gets the mark-by-mark check"
pr: 157
date: 2026-10-13
kind: infra
summary: When we read a college's newest Common Data Set, its test policy and admission factors are now checked against where each box is marked before anything reaches the site.
---

## What's new

The check that corrected test policies at 36 colleges now runs on every Common Data Set we read from here on, not just
the ones already on the site. A test policy or admission factor that can't be confirmed from where its mark sits on
the page stays off the page until it can be.

## Behind the scenes
- The data pipeline places each grid mark under its column heading right after a document is read, using the
  document's own layout, and corrects a reading made under the neighbouring column.
- The scheduled runs install the PDF layout tool this needs.
