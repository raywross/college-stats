---
title: "Essays gets its own tab, and one move that follows your list"
pr: 194
date: 2026-10-30
kind: feature
summary: Quad Advisor adds an Essays tab beside Next steps, Colleges, and Calendar, and replaces three overlapping essay tasks with one move that always points at the next college with work left.
---

## What's new

- **One card for all your essays.** Next steps used to show up to three separate essay tasks with no sense of which
  college they were for. Now there's one: it names the next college whose essays need work, in deadline order, and
  counts what's left across your whole list. Starting the summer before senior year it's "Write your essays"; once
  your colleges' prompts are on file it's "Finish {College}'s essays", and it gets more urgent as fall deadlines
  close in. When everything is ready, it says so, and tells you to paste each college's package into its form when
  you apply.
- **A new Essays tab.** Essays now sits beside Next steps, Colleges, and Calendar — one row on your phone and your
  desktop. Open it and see the personal essay first, then a card per college in deadline order: which prompts are
  done, which are drafts, which haven't been started, and a Start button for each one. A college whose essay page
  hasn't been read yet gets "Add what {College} asks" so you can type its prompt in and get writing. Parents see the
  same tab, read-only, with a note on who can edit.
- The old essays page still works — it opens the Essays tab now instead of a separate list.

## Behind the scenes

- `lib/essays/progress.ts` reads what's left from the student's drafts and the list's colleges once, pure and
  shared by the move, its card, and the tab, so none of them can disagree. `lib/planner/generators/essays.ts`
  generates the one move from it; `lib/planner/importance.ts` ranks it 72 in the summer before senior year and 85
  in senior fall and winter, same as any other dated piece of applying.
- The strip (`components/planner/PlanTabs.tsx`) becomes a segmented control on phones that always fills the width,
  whether it's showing four tabs or five (once Offers appears): every cell stays 44 px tall and nothing scrolls
  sideways, proven by a width guard test.
- The two cycle-file essay tasks (draft the personal essay, write the supplements) stay on the calendar but no
  longer compete for a Next steps slot; the per-college "Supplement n of N" rows are gone entirely. `/advisor/essays`
  redirects to the new tab.
