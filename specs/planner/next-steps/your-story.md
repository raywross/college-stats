# Part 7, Your Story: Three Private Prompts That Start the Narrative

> Status: **built** 2026-10-14 (feature/next-steps, PR #160). After [seasons.md](seasons.md); extends the student profile
> ([../../product/student-profile.md](../../product/student-profile.md)). Part 7 of [next steps](README.md). The one new
> capture piece in this section (owner, 2026-10-14; no résumé export, no essay tracker).

## Goal
Advisors spend junior year getting a student to say who they are in a paragraph before anyone writes an essay. The
profile holds the facts (courses, activities, awards, work, a major) and nothing in the student's own words. Three
short prompts, private to the student, answered in junior year and read again when the essay window opens, are the
smallest version of that work that is still useful.

## The prompts
Stored as `student_profiles.data.story` (`{ about, thread, majorWhy, updatedAt }`, each up to 500 characters, plain
text):
1. **About you**: "What should someone reading your application know about you that your grades don't say?"
2. **The thread**: "What ties the things you've spent your time on together?" (the profile's activities are listed
   beside it, with the depth reading's prompt where it applies: "two activities for three years, with a role")
3. **Why this major**: "Why {intended major}, in a few sentences?" (skipped when no major is set; "or 'not sure yet'
   is a fine answer")

No scoring, no suggestions, no model reads or rewrites them. IECA's rule applies to the site as to advisors: nobody
writes the essay but the student.

## Where
- A move in junior fall ("Write your story", carries until done) and a one-line card in junior spring before the brag
  sheet ("Your counselor's questionnaire asks the same things; your story is here").
- Edited from the Numbers page ("Your story", a section after Plans) and from the move's card; saved like any profile
  edit, with the intake's chip style and 16px inputs on phones.
- The summer essay move's card links it: "Start from your story" opens the three answers read-only beside the move.
- Never shown to a guardian ([../parents.md](../parents.md): private notes stay private) and never exported with the
  list; a guardian's card says "Maya has written her story" or "not yet", nothing more.

## Rules
- Private to the student: not in the admin export's household view, not in the CSV, not in telemetry (only
  `story_filled {count}`).
- Plain text; no links or formatting; pasted text is kept as typed.
- Deleting the profile deletes it.

## Files (planned)
`lib/student-profile.ts` (`story`, `sanitizeStory`), `components/me/StorySection.tsx`, `components/planner/moves/StoryCard.tsx`,
the `story_missing` applies-key, kind `story`. Tests: `tests/student-profile-story.test.mts` (limits, the major
condition, the guardian never receives the text in any loader or export, the move closes when all applicable prompts
are filled).

## Open questions
1. Should the prompts be offered to seniors who skipped them, inside the essay move? Recommendation: yes, as the same
   card; it's never too late for the counselor's questionnaire.
