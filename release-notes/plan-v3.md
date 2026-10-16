---
title: "Plan v3: three things to do now, each with a guide"
pr: 165
date: 2026-10-16
kind: feature
summary: "Everything about the student is entered in one place, Your record, with a view of how complete it is and how Quad reads it; the plan shows at most three things to do, ranked by importance, each opening a page built for that one job; skips are remembered, nothing from a later season shows, and the list row is back to a name, a pill, and a trash can."
---

## What's new

**Three cards, not six.** The Next steps tab shows at most three things a student can do right now. Each card has a
title, one line of why, and one button that opens a guide. Done and Skip live in a small menu on the card. When a card
goes, the next one takes its place. Skipped moves fold under "Done and skipped" with the date and a Bring back, and
nothing from a later season shows: a junior never sees anything about applications or decisions. A student who has a
real SAT or ACT score is no longer told to take a practice test.

**A guide for each job.** Tapping a card opens a page designed for that one thing:
- **Build your list** shows what a good list looks like for the season, where this list stands against it, and colleges
  *like the ones already on it* at the level that's missing: the same kind of college (public or private, size, setting,
  region or nearby, character, your major) at a different level, each with the reason it's alike and one-tap Add.
- **Show interest** takes one college and lists what counts there, in the order the evidence supports: the college's
  own upcoming events with Register, an information request, and a follow. When you come back from the college's page
  the plan asks whether you registered; if it misses you, a short email the next morning asks instead. A confirmed
  registration lands on the family calendar. Nothing is ever assumed.
- **Reach your score** is for a student under their target: where the current score stands across the list, the
  official free study resources, and the upcoming test dates with registration deadlines, "I'll take it", and a
  Register button tracked the same way as a tour.
- **Your story** becomes one free-form page in the student's own words, with depth and breadth explained and what the
  record already says beside it. Still private: no parent sees the text.
- **Choose next year's APs** shows the courses taken by subject, the suggestions that add depth, and a search to add
  anything else; every change updates the profile.
- **Pick your recommenders** opens in March of junior year: enter teachers, rank them, mark asked and agreed, and read
  what to think about and how to ask.

**Connections move to the profile.** A parent who went to Duke, a sibling at Michigan, a coach who's recruiting you:
these are entered once in a new Connections step of the profile (after Work), not on each list row. The list row is
now a heart, the crest and name, one pill, and a trash can to remove it. The ED pill opens its facts as a dialog; the
interest pill opens the Show interest guide.

**For parents.** A parent's Next steps shows their own part first, then the whole season for their student: what the
student sees now, what comes next, what's done, and what was skipped (with the date and a Bring back). Next season is
listed too. The weekly summary adds one line for the week's skipped moves.

**Your record: one place for everything about you.** The guided tour that used to fill in grades, tests, courses, and
activities now holds everything: your major (type a word, tap a common one, pick up to three), a few basics (state, fee
waiver, first generation), where you'd go (size, setting, states or regions, public or private, the family's cost
limit), your story, and your recommenders. The Numbers page is gone; in its place a record overview shows how complete
your record is, what each missing piece would unlock, and **how Quad reads your record right now**: what the estimate
is working from, the one most useful thing not yet entered, and your list's levels. A college you're about to add shows
its level before it's on the list. "Parents can edit" moved to your account page.

**Three things, ranked.** Every move the plan knows about has an importance; the plan shows the three highest that
apply to you right now, and the next surfaces as you finish one. Deadlines and binding decisions come first, then the
parts of your record the estimate needs, then the list, your test, interest, and the rest. Your story and your
recommenders wait for the summer before senior year.

**Less text.** Every screen opens with a title and one line. Why it matters, how to think about it, and where the numbers
come from are one tap away, folded or behind an info icon.

## Behind the scenes

The guides are pages under `/plan/guide/<slug>`, found by a registry that maps each move to its guide; the generated
tasks and their stored actions are unchanged. The Now view gained a season gate (a move's own season or earlier, or
dated within two weeks). Skips are stamped with when and by whom. Act tracking is one table shared by the interest and
test guides, confirmed by a return prompt or a next-morning email, and expired a week after the event. Connections live
on the student profile and feed the estimate's hooks from there; the old row columns were backfilled and are no longer
read. The story's three prompts were joined into one narrative on read, so nothing was lost. The record is the same profile data, entered through one tour (`lib/planner/record.ts`,
`specs/planner/record/`); the ranking is a table of base importance by move with timing and season rules
(`lib/planner/importance.ts`), computed on every open and stored nowhere. Built with the `build-roadmap-section` skill:
eleven units for plan v3 and six for the record, on sub-branches (`specs/planner/v3/build-plan.md`,
`specs/planner/record/build-plan.md`).
