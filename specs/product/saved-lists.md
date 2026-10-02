# Saved Lists: Reach, Target, Likely

> Status: **planned** (not built). After [accounts.md](accounts.md) and [student-profile.md](student-profile.md).
> Part of [product](README.md). Replaces the `localStorage` compare list as the way to keep colleges.

## Goal
A student keeps the colleges they're considering, sorts them into **Reach / Target / Likely**, tracks where each
application stands, and keeps notes and deadlines. A guardian sees the list. The list feeds Compare ("compare my
Targets"), the net price estimator ("what would I pay at each"), and the award-letter analyzer.

"Likely" rather than "Safety": counselors have moved to it because no college is safe when it is unaffordable or
when it rejects over-qualified applicants it expects to lose ("yield protection"). The glossary explains the terms.

## Research (2026-10-02)
- Scoir, Naviance, and Common App all keep a list with a category and a status; Scoir's exported outcomes carry
  app type (ED/EA/RD), outcome, waitlist/deferred flags, and "enrolling", which is the vocabulary families and
  counselors already use. The same fields make a list exportable to and importable from those tools
  ([scattergrams.md](scattergrams.md#import)).
- The idea document's Plus tier caps lists at 20 colleges. Counselors typically recommend 8–12 applications with a
  balance across categories, so the free tier can be generous on **one** list and still leave room for Plus
  ([commercialization.md](commercialization.md#feature-map)).

## Model
```
lists      (id, student_id, name, is_default, created)
list_items (list_id, unit_id, category: reach | target | likely | unsorted, status, round: ed | ed2 | ea | rea | rd | rolling | null,
            position, added_by, added_at, decision_date, enrolling bool)
list_notes (item_id, author_id, body, private bool, created)
```
- `status`: `considering → applying → applied → decided` where `decided` carries an `outcome`: `admitted`,
  `denied`, `waitlisted`, `deferred` (deferred returns to `applied` for the regular round). The outcome vocabulary
  matches Scoir's so later pooling ([scattergrams.md](scattergrams.md#self-reported-outcomes)) is lossless.
- One **default list** per student; more lists are a Plus feature (e.g. "Nursing programs", "Mom's suggestions").
- Compare keeps working without a list; "Add to list" appears next to "Compare" on cards, rows, and profiles. The
  compare tray gains "Save these to my list".
- Every college on a list is followed automatically, so the student gets an email when its data changes
  ([follow-colleges.md](follow-colleges.md#model)).

## Display
- `/me/list` (default) and `/me/lists/{id}`: a table grouped by category with a balance line ("3 Reach · 4 Target ·
  1 Likely: counselors suggest 2–3 Likely"), each row with crest, admit rate, the student's standing
  ([chances-and-fit.md](chances-and-fit.md)) when the profile has numbers, average cost, the chosen round and its
  deadline, status, and notes count. Drag to re-sort; category chips to move.
- **Deadlines** come from the college's own data when the site has it (CDS C21/C22 deadlines via
  [cds-admissions.md](../data-expansion/cds-admissions.md); application fee from
  [housing-and-policies.md](../data-expansion/housing-and-policies.md)); otherwise the student types one. A
  "Next 30 days" strip at the top of `/me`.
- **Compare all** (up to 4 free, 10 with Plus: [comparison.md](../comparison.md) today caps at 4 for layout reasons,
  so the 10-college view is the table view only).
- **Guardian view:** the same page read-only unless `can_edit`, with "Added by" attribution and private notes hidden.
- **Share:** a read-only link (`/l/{token}`) the student can turn on and off, showing the list without notes or
  standing; for grandparents, friends, a coach. Revocable.
- **Export:** CSV (the Scoir-compatible columns) and a one-page PDF ("My list" with category, cost, deadlines) via
  the same PDF renderer the counselor portal will use.
- Phones: rows reuse `SchoolRow` ([mobile.md](../mobile.md#patterns)); category is a swipe action.

## Rules
- A list is the student's. Guardians and counselors see it under the grants in
  [accounts.md](accounts.md#privacy-model); edits are attributed.
- Outcomes are self-reported and private. They feed nothing public unless the student opts into pooling later.
- Never rank or sort colleges by the student's standing in a way that reads as a verdict; the category is the
  student's choice, with the site's suggestion shown beside it ("Suggested: Target, because …").

## Files (planned)
- `lib/lists.ts` (server actions and queries), `app/me/list/`, `components/lists/`, migration `…_lists.sql` with
  policies, `tests/lists.test.mts` (status transitions, balance line, CSV round-trip).

## Open questions
1. Should statuses and outcomes be a Plus feature or free? Recommendation: free; they are the raw material for the
   pooled scattergrams that make the paid tiers valuable later.
2. Import from Common App or Scoir for a single student: no public API exists; CSV paste is enough for v1.
