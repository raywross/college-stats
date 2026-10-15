# Guide: Pick Your Recommenders

> Status: **planned** 2026-10-15. After [../now.md](../now.md). Replaces the "Notice two teachers" note move
> ([../../next-steps/seasons.md](../../next-steps/seasons.md#junior-fall-augdec)) and gives the cycle's
> `ask_recommenders` and `thank_recommenders` entries a screen. Part 8 of [plan v3](../README.md).

## Goal
The owner: "I like the recommendation to start thinking about teachers to write recommendations. This should probably
not start until the second half of junior year or maybe start of senior year. Maybe give them a tool to enter their
teachers' names and rank them and tell them what they should be thinking about and how to approach them."

## When
- **March of junior year** (`junior_spring`): the new playbook entry `pick_recommenders`, "Pick your recommenders",
  why "Junior-year teachers in core subjects know your work best. Advisors say ask before summer, while they remember
  it." Carries until two recommenders are marked asked.
- **April 15 – June 10**: the cycle's `ask_recommenders` window (built) opens the same guide.
- **Senior fall**: the built `recommendation` tasks per college (the count from the college's record) and the Common
  App move; the guide's status list is where "invited in Common App" is marked.
- **November – January**: the cycle's `thank_recommenders` (built) opens the guide's thank-you line.
- The junior-fall "Notice two teachers" entry is removed (the owner: not before the second half of junior year).

## The page
`/plan/guide/recommenders`

```
← Back to your plan
Pick your recommenders
Most colleges ask for one or two teacher letters. Ask before summer; teachers write dozens in the fall.

WHAT TO THINK ABOUT
 · A teacher who saw you work, not only the one who gave the highest grade.
 · Junior-year, core subject (English, math, science, history, language) for most colleges; some engineering and
   science programs ask for a math or science teacher.
 · Two teachers from different subjects shows range. A third, optional, from an elective or an activity.
 · Your counselor writes a separate letter; the brag sheet feeds it.

YOUR TEACHERS                                                     drag to rank, or use the arrows
 1  Ms. Alvarez · AP Chemistry · junior year          Thinking → [Asked]  [Agreed]              ✎
 2  Mr. Park · English 11 (H) · junior year            Asked May 2 → [Agreed]                    ✎
 3  Coach Lee · Robotics · 10th–11th                   Thinking                                   ✎
 [+ Add a teacher]  name · subject (from your course list) · which year

HOW TO ASK
 In person, before the end of junior year. Say which colleges and why them. Offer your story and a short list of
 what you did in their class. Give the Common App invitation in August and at least four weeks before the first
 deadline. Thank them after decisions come.
 [Open your story]

THANK THEM  (November on)
 Letters are in. A note by hand goes a long way.                                  [Done]
```
- **Think about** and **How to ask**: the site's words from the advisor consensus (College Board, NACAC, the
  counselor guidance the research cites), with the one data point per college where it exists: the college's required
  recommendation count (`recommendations_count`, C-section) in a folded "What your colleges ask for" line.
- **Your teachers**: up to `RECOMMENDERS_MAX` (4) entries, ranked by drag (arrows on phones), each with a status:
  Thinking · Asked (dated) · Agreed (dated) · Invited (senior fall, dated; "sent the Common App invitation"). The subject
  is picked from the student's course list (or typed). Marking two **Asked** ticks the `pick_recommenders` move; marking
  the Common App invitations ticks the college `recommendation` tasks' parent move.
- **Open your story** links the story guide (the brag-sheet connection).

## Stored
```
student_profiles.data.recommenders: RecommenderEntry[]
RecommenderEntry { id, name (≤60), subject: string | null, courseId: string | null, years: (9|10|11|12)[],
                   rank: number, status: "thinking" | "asked" | "agreed" | "invited", askedOn, agreedOn, invitedOn }
```
Visible to a guardian (a teacher's name isn't a private note; a parent often helps time the ask). Exported and deleted
with the profile. Never in telemetry (`recommenders_count {n}` only).

## Rules
- Advice is the advisor consensus, cited once on the page; never "you should"; never a judgment of a teacher.
- No college's requirement is stated without its record and edition.
- Telemetry: `plan_guide_opened {slug: "recommenders"}`, `plan_recommender_status {status}`; never a name.

## Files (planned)
`lib/student-profile.ts` (`RecommenderEntry`, `RECOMMENDERS_MAX`, sanitizer), `lib/planner/moves-catalog.ts`
(`pick_recommenders` in `junior_spring`; `notice_teachers` removed), `components/planner/guides/RecommendersGuide.tsx`,
`RecommenderRow.tsx`, the registry entry. Tests: `tests/planner-recommenders.test.mts` (the entry's sanitizer and cap;
the move opens in March of junior year and not in fall; two Asked ticks it; the words pass the catalog guard).

## Open questions
1. March of junior year, or senior fall only (the owner offered both)? Recommendation: March, with the ask by June;
   every source says ask before summer, and the fall is when teachers are swamped.
2. Should the guide send the student a reminder when a recommender has been "Asked" for three weeks without "Agreed"?
   Recommendation: no; a nudge about a teacher is the family's business.
