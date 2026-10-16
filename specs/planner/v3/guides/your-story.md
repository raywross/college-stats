# Guide: Your Story

> Status: **built** 2026-10-16 (PR #165). After [../now.md](../now.md). Replaces the three prompts of
> [../../next-steps/your-story.md](../../next-steps/your-story.md) with one narrative; keeps every privacy rule. Reads
> depth ([../../../chances/depth.md](../../../chances/depth.md)). Part 6 of [plan v3](../README.md).

## Goal
The owner: "I like the task of 'write your story', but this should be free-form about telling us about your narrative.
We can build on this later with an agent. The idea is to help the student with our concepts of depth and breadth."

One page, one text field, with the frame (depth and breadth) explained in a paragraph and what the student's record
already says beside it, so the writing starts from facts and the student sees the gap between the list of things they
did and the story those things tell.

## The page
`/plan/guide/story` (the `story` and `brag_sheet` moves; the Numbers page's Your story section; the summer essay move's
"start from your story").

```
← Back to your plan
Your story
Private to you. Nobody at Quad reads it, and your parents can't see it.

DEPTH AND BREADTH
 Colleges that read beyond the numbers look for two things: depth, a few things carried for years with a growing
 role, and breadth, that those things add up to a person with a direction. Your story is where the second comes
 from. Write it the way you'd tell a teacher who asked "what are you about?"

WHAT YOUR RECORD SAYS SO FAR                       ← the depth reading's sentences, read-only
 · Soccer, three years, captain this year; robotics, two years, treasurer. One activity carried through…
 · Science: Biology, Chemistry, AP Chemistry, AP Biology (planned): a deep track for your major.
 · Intended major: mechanical engineering.

YOUR STORY                                                                         0 / 2,000
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                      │
 │                                                                                      │
 └──────────────────────────────────────────────────────────────────────────────────────┘
 Stuck? Start with one of these:  [What your grades don't say]  [What ties your activities together]
                                  [Why {major}]  [A moment you changed your mind]
                                                                              [Save]
```
- **The frame** is one paragraph, the site's own words, with "depth" linking the glossary (`depth`, new, in plain terms:
  years and roles in a few things) and no method.
- **What your record says** is the depth reading's sentences (`activitiesReading`, the course tracks' sentences) and the
  intended major, exactly as the Numbers page shows them, read-only. A student with no activities sees "Add your
  activities and the plan will show what they say" with the intake link. Nothing here is a level or a number.
- **The field**: one plain-text area, `STORY_MAX` 2,000 characters, autosaving on blur and on Save, with the count.
  Phone inputs 16px. The four **starters** are the old prompts plus one; tapping one appends its question as a line in
  the text for the student to answer, so the field stays one narrative.
- **Footer**: the move's Done (also ticked automatically once the story has at least 200 characters) and Skip.

## Stored
`student_profiles.data.story` becomes `{ narrative: string, updatedAt }`. The one-off migration concatenates existing
answers in order with their prompt as a line ("About you: …"), so nothing is lost. `storyMissing` reads
`narrative.trim().length < 200`. `sanitizeStory` keeps plain text as typed (built).

## Later: the agent
Not in this part. The field and the depth sentences are the inputs an agent would read; the owner decides then what
it does (questions back, never writing). The spec records the intent so the field isn't designed against it: the text is
kept as typed, with its history (`story_versions`, a later table), and the frame paragraph is where an agent's
questions would appear.

## Rules
- Private to the student (built): never to a guardian (a guardian's page says "Maya has written her story" or "not
  yet"), never exported in the household view, never in telemetry beyond `story_filled {length_band}`.
- Plain text; no model reads it in this part.
- Deleting the profile deletes it.

## Files (planned)
`lib/student-profile.ts` (`StudentStory { narrative }`, `STORY_MAX` 2000, `storyMissing`), `scripts/migrate-story.mts`,
`components/planner/guides/StoryGuide.tsx` (replacing `StoryCard`'s three fields and `StorySection`'s), the glossary
entry `depth`. Tests: `tests/student-profile-story.test.mts` (the migration joins the three; the 200-character rule; the
guardian redaction; the cap).

## Open questions
1. 2,000 characters (about 300 words) or longer? Recommendation: 2,000; the Common App essay is 650 words and this is
   the paragraph before it.
2. Should the auto-tick at 200 characters be a tick at all, or should the student always press Done? Recommendation:
   auto-tick; the card's job is to get the writing started.

## As built
- `StudentStory` becomes `{ narrative: string; updatedAt: string | null }`. The old three-prompt shape is joined on read ("About you: …\n\nThe thread: …\n\nWhy this major: …").
- `STORY_MAX` 2,000; auto-tick fires when the saved narrative first crosses 200 characters.
- Starters append a line; every `activitiesReading` note and track sentence appear beside the textarea.
- A guardian's StorySection on the Numbers page shows the status line plus a link to the guide (not the full story).
- `StoryCard` is deleted; the story move renders `MoveCard` with the guide button.
