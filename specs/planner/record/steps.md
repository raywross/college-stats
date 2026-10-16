# Part 1, Your Record: One Guided Entry and an Overview

> Status: **built** 2026-10-16 (PR #165). Replaces the Numbers tab ([../../product/household-hub.md](../../product/household-hub.md#a-persons-page-householdperson))
> and extends the intake ([../redesign/intake.md](../redesign/intake.md), whose rules for each built step stand). Part 1
> of [Your record](README.md).

## Goal
The owner: "They should all be together. I really like the guided tour; it's a guided tour to fill everything out, and it's
very usable. On Numbers I like 'How complete is this'; maybe this is a better view than the check boxes."

Everything about the student is entered through one guided tour, **Your record**, and reviewed on one overview page that
says how complete the record is and what each missing piece would unlock.

## The steps
`RecordStep` 0–14 (`lib/planner/record.ts`, replacing `IntakeStep` in `lib/planner/intake.ts`; `RECORD_REVIEW` 13,
`RECORD_DONE` 14). The built steps keep their rules ([intake.md](../redesign/intake.md)); the new ones are below.

| Step | Headline | Asks | Required |
|---|---|---|---|
| 0 Grades | "Start with your grades" | Class of, GPA, high school (built) | yes |
| 1 Test | "Your test score" | SAT / ACT / neither, score, practice, target (built) | yes |
| 2 AP courses | "Your AP courses" | built | no |
| 3 Sports | "Your sports" | built | no |
| 4 Clubs | "Clubs and organizations" | built | no |
| 5 Work | "Work and internships" | built | no |
| 6 Connections | "Any connections to a college?" | built (v3) | no |
| 7 Other | "Anything else?" | built | no |
| 8 Major | "What might you **study**?" | Up to three major families, typed with common picks ([majors.md](majors.md)) | no |
| 9 Basics | "A few **basics**" | State of residence (picker, "Outside the US"), fee-waiver eligible (yes / no / not sure), first generation (yes / no / not sure) | no |
| 10 Where you'd go | "Where would you **go**?" | Size (chips), setting (chips), states or regions (type-ahead chips over the state and region names), public or private (chips), the cost limit (one number, "the most your family would pay in a year", a parent's field a student may leave blank), early-round interest (chips: ED · EA · none yet) | no |
| 11 Your story | "Your **story**" | One text area (`STORY_MAX`), the four starters, the depth sentences folded behind "What your record says so far" ([../v3/guides/your-story.md](../v3/guides/your-story.md)) | no |
| 12 Recommenders | "Your **recommenders**" | The teachers list (name, subject, years, rank, status) as the recommenders guide's rows ([../v3/guides/recommenders.md](../v3/guides/recommenders.md)) | no |
| 13 Review | "Look right?" | One row per step with Edit | |
| 14 Done | "Your record is **in**." | First run only | |

- **First run** (`recordNeeded`, the built `intakeNeeded` rule): steps 0 and 1 are required and Continue waits on them;
  every other step shows Skip in the phone header and "I'll add this later" on desktop, as the activity steps do. The
  rail lists all thirteen; a skipped step reads "Later" on the rail and the Review row.
- **Edit mode** (`?record=1`, or `?record=1&step=n`): opens at Review (or the step), prefilled, no Done screen, returns
  to where it was opened from (`?back=plan|record`, default the plan).
- **Steps 11 and 12 on the first run** show a one-line note under the headline: "Most students write this the summer
  before senior year; skip it for now if you like." Their moves surface then ([ranking.md](ranking.md)).
- **The rail's check marks stay** on the tour (it is the tour's own progress). The overview is where completeness
  reads as "what this unlocks".
- **Order**: the facts a college reads first (grades, test, courses, activities, work, connections), then what the
  student wants (major, basics, where), then the writing (story, recommenders). Review last.

### Mapping to the profile
`applyRecord` (the built `applyIntake`, renamed) adds: `plans.intendedMajors` (step 8); `basics.stateOfResidence`,
`basics.feeWaiverEligible`, `basics.firstGeneration` (step 9; `firstGeneration: boolean | null` is new on
`StudentProfileBasics`, read later by the fee-waiver and the estimate's notes, never by the model until a spec says so);
`preferences.sizes/settings/statesOrRegions/types/maxAverageCost` and `plans.earlyRoundInterest` (step 10);
`story` (step 11, through the same sanitizer the story guide uses; a guardian's draft never carries the text: the step
is read-only "Written" / "Not yet" for a guardian); `recommenders` (step 12). The draft (`RecordDraft`) carries each as
the profile stores it; `parseRecordSave` checks them as `sanitizeProfile` does. Saving an unchanged draft gives back the
same profile (the built round-trip rule).

## The overview: `/household/[person]/record`
```
Jordan's record                                                   [Fill it in →]   (first run, when needed)

HOW COMPLETE IS THIS                                                             8 of 13
 ████████████░░░░░░░░
 ✓ Grades            GPA 3.7 · Class of 2028 · Riverside High                            Edit
 ✓ Test              SAT 1350, aiming for 1450                                            Edit
 ✓ AP courses        4 courses                                                            Edit
 ✓ Sports            Soccer (varsity)                                                     Edit
 ○ Clubs             Add clubs: colleges read depth over a long list                      Add
 ✓ Work              None                                                                 Edit
 ○ Connections       Add a connection, or none                                            Add
 ✓ Other             2 awards                                                             Edit
 ○ Major             Add a major: unlocks "like your list" matches and majors and earnings   Add
 ✓ Basics            NC · fee waiver: not sure                                            Edit
 ○ Where you'd go    Add a size or setting: unlocks Explore's "Fits my preferences"       Add
 ○ Your story        Not yet · most write it the summer before senior year      Open your story
 ○ Recommenders      Not yet                                                   Pick your recommenders
```
- **The header**: "{First}'s record" (a guardian) or "Your record"; a first-run record (steps 0–1 missing) shows one
  button, **Fill it in**, opening the tour.
- **How complete is this**: the count of sections with something in them (a "None" answer counts), the bar, and one row
  per step: a check or a ring, the step's name, its summary (the tour's rail summary: `railSummary`), and **Edit** / **Add**
  opening the tour at that step (`/plan?record=1&step=n&back=record`). A missing section's summary is its *unlock* line
  from `SECTION_UNLOCK` (`lib/planner/record.ts`): what the site can do once it's in ("unlocks Explore's 'Fits my
  preferences'", "colleges read depth over a long list", "the estimate reads your courses"), never a score. The built
  `completeness()` tool list (ScoreChecker, Fits my scores, Fits my preferences, GPA bands, Net price, Majors and
  earnings) becomes these unlock lines; `completenessScore` stays for anything else that reads it.
- **Your story** and **Recommenders** rows link their guides, not the tour step (the guide is the better editor); their
  state reads "Written" / "Not yet", "{n} teachers, {m} asked".
- **A guardian** sees the same page; Edit needs edit access; the story row never shows text.
- **Nothing else on the page**: no form, no "Open in the plan" card, no course or test links (those are moves). The
  one-time "Import what you entered before signing in" offer (`ImportLocalProfile`) stays, above the list, for the
  student's own record.
- `/household/[person]/numbers` redirects here (301). The person header's control reads **Plan | Record**. `/me` keeps
  redirecting to the student's own record.

## The people line
`PlanPeople`'s ring reads the record's completeness (`recordProgress`: the same 13 sections; the built
`profileProgress` becomes a view over it) and "Next:" stays the top-ranked move; the ✎ opens the overview
(`/household/{id}/record`), labeled "{Name}'s record". The built "Edit {name}'s grades, test, and courses" wording goes.

## Parents can edit
The switch moves from the Numbers page to `/account`, as its own `AccountSection` ("Parents can edit", under Household),
for a student with at least one guardian. Same component, same action; the Numbers page had the only other copy.

## Files (planned)
`lib/planner/record.ts` (`RECORD_LABEL`, `RecordStep`, `RECORD_REVIEW`, `RECORD_DONE`, `RECORD_STEPS` (name, headline,
required, section), `SECTION_UNLOCK`, `recordProgress`, `recordNeeded`, `recordHref`), `lib/planner/intake.ts` → the
draft, save, parse, apply, and review-line changes (the file keeps its name; `IntakeStep` is re-exported as `RecordStep`
for the tests that import it), `lib/planner/profile-progress.ts` (`PROFILE_SECTIONS` gains `major`, `basics`,
`where`, `story`, `recommenders`; `major`/`state` stay as sections with their step), `lib/student-profile.ts`
(`firstGeneration`), `components/planner/intake/{PlanIntake,ReviewStep,MajorStep,BasicsStep,WhereStep,StoryStep,
RecommendersStep}.tsx`, `components/record/{RecordOverview,RecordRow}.tsx`, `app/household/[person]/record/page.tsx`,
`app/household/[person]/numbers/page.tsx` (redirect), `components/account/PersonHeader.tsx` (Plan | Record),
`app/account/page.tsx` (+ ParentsCanEdit), `components/planner/PlanPeople.tsx`; deleted: `components/me/{StudentNumbers,
ProfileForm,CompletenessMeter}.tsx`. Tests: `tests/planner-record.test.mts` (every step's save and read-back; a skipped
step; the unlock lines; `recordProgress` for planted profiles), `tests/planner-intake.test.mts` (updated step numbers),
`tests/planner-profile-progress.test.mts`.

## Open questions (answered)
1. Should the tour's first run stop after step 1 ("That's enough to start") and offer the rest later? Recommendation:
   no; the owner likes the tour and every later step is one tap to skip.
   **Adopted: tour's first run keeps every step.**
2. Should a guardian see the Review step's story row at all? Recommendation: yes, as "Written" / "Not yet".
   **Adopted: guardians see story row as Written / Not yet.**

## As built by R1a–R3
- The thirteen entry steps (0–12) plus Review and Done; steps 0–7 built, steps 8–12 new in this section
- `RecordStep` type covers 0–14; `IntakeStep` aliased for backward compatibility with `import` statements
- Story and recommenders drafts preserve null for guardians, keeping the stored student story on every guardian save
- Thirteen tour steps with rail, headline (lead, pop, tail), one-line description, required flag, and why-text; the overview reads from the same `RECORD_STEPS`
- Record overview replaces Numbers tab with sections for all thirteen steps, each with check/ring, rail name, summary or unlock text, and Edit/Add (guarded by `canEdit`)
- `/household/{id}/record` is the new overview route; `/numbers` redirects to it
- `/me` redirects to `/household/{id}/record` for both student and guardian
- PersonHeader segmented control shows Plan | Record
- Parents can edit section moved from Numbers page to /account, guarded by guardians.length > 0

## Changed (owner review, 2026-10-16, later): the record expands on the plan page
"I like having it on the plan page when you hit edit. Make it so that when you hit edit on the plan page it expands to
show your record, then have a save or cancel button to close it." The people line's Edit now opens `/plan?record=1`:
the same overview (`RecordOverview`) under the people line in place of the tabs (`components/record/RecordInline.tsx`),
each section's Edit opening the tour at that step and returning here (`back=inline`), with **Save** and **Cancel**
closing it back to the plan's tabs (every step saves on its own when its tour saves). The household's Record tab keeps
the standalone page.
