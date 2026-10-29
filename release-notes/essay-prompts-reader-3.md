---
title: "Essay prompts: a stricter reader after the second run"
pr: 189
date: 2026-10-29
kind: fix
summary: The reader now keeps "choose 4 of 8" on disk, understands a required essay beside a pick-some set, refuses "no essays" read off an unrelated page, and never records the Common App's own prompts as a college's.
---

## What's new

- **A required essay beside a choice.** Colleges like Duke list one essay everyone writes and then a set to choose
  from. The card now reads "1 essay (250 words); choose 2 of 5 more (250 words)", each prompt in the set is marked
  as one to choose from, and your list's count adds the required one plus the number you'll pick.
- **Fewer false "no essays".** The second collection run had called several colleges essay-free after landing on a
  tutoring page, an HR page, or a financial-aid form that happened to say "supplemental". Those readings are refused
  now, and a college with no prompts on file is looked for again on every run.

## Behind the scenes

- The record writer uses a fixed key order and had left out `cycle_assumed` and `choose`, so the UC campuses were
  stored as eight optional essays. Both keys are written and round-tripped in a test.
- `choose.of` counts the prompts marked optional (the set); a required prompt stands outside it. A `none` quote must
  say there are no essays; a `refers_to_form` quote must name the essay and the application it is part of. A page
  that only says "supplemental" no longer reads like an essay page, those words score zero as links, and the picker
  is told not to choose them.
- A prompt equal to one of the platforms' own prompts in `data/reference/platform-prompts.json` holds the record
  (Rutgers and Pace reproduce the Common App's seven on their pages). The reader is told to leave them out.
