# Part 4, Less Text on Every Screen

> Status: **planned** 2026-10-16. A rule and a per-screen list across the record's steps ([steps.md](steps.md)), the
> guides ([../v3/guides/](../v3/guides/)), and the plan's tab. Part 4 of [Your record](README.md). The owner: "On each of
> the screens, less explanatory text when the screens come up. It's great information and instruction, but put that stuff
> in collapsed areas or info icons, whatever works best for the section."

## The rule
1. **A screen opens with a title and one line** (under 90 characters). Nothing else above the first control.
2. **Why it matters, how to think about it, and where numbers come from** go behind one of:
   - a **fold**: `<details>` titled "Why this matters" or "How to think about it", closed by default, one per section at
     most (`components/ui/why-fold.tsx`: a chevron row, 44px, the body in muted text);
   - an **info icon** next to a section title when the text is a sentence or two (`InfoTip`, built);
   - a **sheet** when it's a page's worth (the built "How this season works", "Why this shape").
3. **Hints stay where they prevent a mistake** (a field's range, "enter it the way your transcript shows it").
4. **A guide's lead line is the move's why** when a move led there, else the guide's purpose; both one line.
5. **Reading order on a phone**: title, one line, the first control within the first screen height.

## Per screen
| Screen | Today | Becomes |
|---|---|---|
| Tour steps (each) | Headline + a sub-line + per-step hints | Headline + one line; a `?` info icon on the headline opens the step's longer note ("Why we ask") |
| Record overview | "Your own numbers, entered once and read everywhere…" | "Everything a college reads about you, in one place." The unlock lines carry the detail |
| Now (the tab) | Header + the cards | Unchanged (already a title and cards); the explainer stays a sheet |
| Build your list | "What a good list looks like" row with a season sentence and a "Why this shape" sheet | The shape row and the count line; the season sentence moves into the sheet; each gap section's lead is one line |
| Show interest | The C7 line and a sentence per section | The C7 line; each numbered section is its title and the buttons; the sentence per section ("An information request puts you in Elon's system", "No college says it counts a follow") moves under an info icon on the section title |
| Reach your score | The header line, "Where it stands" with its count line, "Study" with a paragraph | Header line; the standing count line; Study as the links only with "How much to study" folded; dates as rows |
| Your story | The privacy line, "Depth and breadth" paragraph, "What your record says" list | Privacy line stays (it's a rule the student must know); "Depth and breadth" becomes a fold, closed; "What your record says so far" a fold, open the first time, closed once the story has text |
| Choose APs | "Schools ask for next year's choices in late winter…" + suggestion reasons | One line; the reasons stay on the suggestion cards (they are the content); the depth tie-in sentence stays |
| Pick your recommenders | "What to think about" four lines, "How to ask" paragraph | Both become folds ("What to think about", "How to ask"), closed; the teachers list comes first |
| ED facts (guide and dialog) | The read, the framing, the caveat, the questions | The read and the questions; "What {college} reports" and the caveat fold |
| Season explainer (sheet) | Lead, paragraph, next line | Unchanged (it is the fold) |

## Rules
- The folded text is unchanged in content: cited where it was cited, sourced where it was sourced.
- A fold's open state isn't remembered (it's short; opening is one tap).
- Telemetry: `plan_why_opened { screen, section }` once per open, to learn which explanations are read.
- Tests: a source-level guard per guide and step that the text above the first control is at most two elements (the
  title and the lead), listing the file and the selector it checks.

## Files (planned)
`components/ui/why-fold.tsx`, edits in every guide and step named above, `lib/analytics.ts` (`plan_why_opened`),
`tests/planner-less-text.test.mts`.
