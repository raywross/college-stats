# Applicants Like You: Saying Who the Student Is Compared With

> Status: **planned** 2026-10-11 (owner: "I don't think that's super clear on the site"). Part 9 of
> [admission chances](README.md). Rewords what [base-rates.md](base-rates.md) built; no new data. Ships with or before
> [levels.md](levels.md).

## Goal
The estimate's second stage compares the student with the applicants a college admits from the same pool (its own
state, its intended major, a guaranteed-admission program), and the site calls that "Your pool". Nobody outside
admissions says "pool". Every place the word appears says instead **who** the student is compared with, **what share
of them** got in, and **what would change it**, in one sentence a family can read without a glossary.

## The sentence
The stage-2 line, everywhere it shows (planner drawer, profile standing card, Compare, the signed-out plan):

| Pool kind | Sentence |
|---|---|
| residency, in-state | "Applicants like you — from Indiana — were admitted at 71% (fall 2025) ⓘ." |
| residency, out-of-state | "Applicants like you — from outside Indiana — were admitted at 44% (fall 2025) ⓘ." |
| residency, international | "International applicants were admitted at 12% (fall 2025) ⓘ." |
| major | "Applicants to the College of Engineering were admitted at 23% (fall 2025) ⓘ; applicants from Indiana overall at 71%." (the residency rate named beside it in words, as built) |
| guaranteed | "Texas automatic admission (top 5%) applies to you: this college admits every applicant who qualifies ⓘ." |
| overall, with state known | "Applicants were admitted at 43% (fall 2025) ⓘ. Purdue doesn't publish a rate for applicants from Indiana, so this is everyone." |
| overall, no state on the household | "Applicants were admitted at 43% (fall 2025) ⓘ. Add your state to see the rate for applicants like you." (links to the household's address field) |
| open admission | "Admits everyone who applies ⓘ." |

- The year comes from lineage, never typed; the ⓘ cites the field (residency grid, major admission, program, or the
  overall rate), as built.
- The word "pool" no longer appears in any sentence a student sees. The glossary keeps it as a synonym.
- The stage-1 line keeps its shape and gains the word "admitted": "Your academics: in the middle of the students this
  college admitted (SAT 1300 inside 1220–1470; GPA 3.85 inside 3.6–4.0)."

## "Who you're compared with"
The ⓘ on the sentence opens a small panel (the same `InfoTip` pattern, wider), not a citation popover alone:

> **Who you're compared with**
> Colleges admit different groups at different rates, so we use the most specific rate Purdue publishes for applicants like you.
>
> | | Admitted | |
> |---|---|---|
> | **From Indiana (you)** | **71%** | fall 2025 ⓘ |
> | From outside Indiana | 44% | fall 2025 ⓘ |
> | Everyone | 43% | fall 2025 ⓘ |
>
> Purdue publishes no rate by major; engineering applicants are admitted to the university, then to the college.
> *Change your state in Household to see another rate.*

- Rows are the rates the college publishes for the student's situation, each cited: the one that applies in bold
  first, then the alternatives, then the overall. A guarantee is a row of its own ("Texas top 5%: admits everyone who
  qualifies"). A major rate is a row where published; "publishes no rate by major" otherwise.
- The early-decision fact ([base-rates.md](base-rates.md#early-decision-as-a-fact)) is a last row where C21 counts
  exist: "Early decision: 18%, against 6% overall; much of that gap is recruited athletes and other students with an
  inside track."
- The panel never says how the rate is used; it shows the facts and which one applies. `lib/chances/what-went-in.ts`
  already names the rate kind for Compare (`rateKindText`); the panel's rows come from `poolRateFor`'s `notes` plus
  the residency grid and the overall rate, assembled in one pure function `comparedWith(student, school)`.

## Where it shows
- **Planner row drawer**: the two stage lines open the Group section ([levels.md](levels.md#where-the-levels-show)).
- **Profile standing card**: the same two lines under the chip; the panel from the ⓘ.
- **Compare**: the "Where you stand" row's sub-line becomes the sentence's short form, "from Indiana: 71%" / "everyone:
  43%" / "guaranteed", with the ⓘ.
- **Data page accuracy summary** ([calibration.md](calibration.md)): the band labels say "admit rate for applicants like
  the student" where they said "base rate".
- **Signed-out plan**: the overall sentence with "Add your state" pointing at sign-up.

## Glossary
- `applicants-like-you` (new): "The group of applicants a college admits from in your situation: your state, your
  intended major, or a program you qualify for. Colleges often admit these groups at very different rates, so Quad's
  estimate uses the most specific rate the college publishes for you. Counselors call this your pool." Related:
  `acceptance-rate`, `levels`, `in-state`.
- `pool` (new, short): "Another word for applicants like you."

## Files (planned)
`lib/chances/notes.ts` (the sentences, replacing `estimate.pool`), `lib/chances/compared-with.ts` (pure:
`comparedWith()` rows), `components/chances/ComparedWith.tsx` (the panel), `components/chances/WhatWentIn.tsx` (uses
it), `components/planner/ListRow.tsx` drawer, `components/compare/…` the standing row, `lib/glossary.ts`,
`tests/chances-notes.test.mts` (no sentence contains "pool"; every kind has a sentence; years from lineage).

## Open questions
None the build needs; the sentences above are final copy until user feedback.
