---
title: "Essay prompts: finding more colleges' pages"
pr: 191
date: 2026-10-29
kind: fix
summary: The essay prompts reader looks one level deeper for a college's page, takes a second look when a general page only points to the application, reads a shared page once, and no longer mistakes a test's essay section for an application essay.
---

## What's new

- **More colleges' prompts will be found.** The first collection runs found no page for about half the colleges they
  tried, because the essay link usually sits on the first-year "how to apply" page rather than the admissions front
  page. The reader now follows those pages too.
- **Colleges whose supplements were missed.** Several colleges that publish their essay prompts had been recorded as
  "see the application" because a general page was read first. When a page lists no prompts, the reader now looks
  once more for a page that does, and takes that one when it finds it.
- **The University of California campuses agree.** They share one page of personal insight questions; it is now
  read once per run, so every campus shows the same eight questions the same way.

## Behind the scenes

- Discovery step 2 gains a deeper pass: up to three first-year application pages on the college's own hosts
  (`rankApplyLinks`: first-year, freshman, how to apply, application requirements; never graduate, transfer, visit, or
  a bare "Apply") are fetched for their links before the well-known paths, sitemaps and the model picker.
- `runCollege` gives a read that lists no prompts a second look: the ladder runs again past that page (`skip`), and a
  page that reads as published replaces the first answer. Reads are cached per run by the page's bytes' hash
  (`readCache`), so a shared page costs one model call.
- A `none` quote about a test's essay section ("does not require the essay section of the SAT, ACT or CLT") holds
  the record. Each change has a test on a fixture site or a planted record.
