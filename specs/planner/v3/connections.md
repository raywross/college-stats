# Part 1, Connections: Legacy and Recruiting in the Profile; a Simpler Row

> Status: **planned** 2026-10-15. Changes the intake ([../redesign/intake.md](../redesign/intake.md)), the list row and
> its capture panel ([../redesign/list.md](../redesign/list.md#simpler-planner-owner-2026-10-12)), and where the hooks
> come from ([../../chances/inputs-beyond-academics.md](../../chances/inputs-beyond-academics.md#legacy)). Part 1 of
> [plan v3](README.md).

## Goal
The owner: "I find the expand functionality to be confusing and hard to use. We should move the 'legacy' information as
a step in the student profile section, after Work and before Other. We could have them add schools and a connection
there similar to the way APs work. The remove can be moved up into the bar as a trash icon. The other things like
socials, campus visits, etc., we can remove from this part of the site."

A connection is a fact about the student and a college (a parent graduated from Duke; a brother is at Michigan; a coach
at Elon has been in touch). It belongs with the other facts about the student, entered once, and should apply whether or
not the college is on the list yet. The list row goes back to being a row.

## The Connections step
A ninth intake step between Work and Other (`IntakeStep` 6; Other becomes 7, Review 8, Done 9; `INTAKE_REVIEW` and
`INTAKE_DONE` move with them, and `SECTION_STEP` in `lib/planner/profile-progress.ts` gains `connections: 6`, `other: 7`).

**Headline:** "Any connections to a college?" **Sub-line:** "A parent, grandparent, or sibling who went somewhere, or a
coach who's recruiting you. Some colleges weigh these; we only use them where the college says it does." Optional, like
the activity steps: Skip in the phone header, "I'll add these later" on desktop, a one-tap **None** chip
(`academics.activitiesNone.connections`, the same mechanism, so the ring counts an answered step).

**Adding one** works like an AP course: a search box over the college index (`/search-index.json`, the same client
search the add-college box uses), popular picks before anything is typed (the list's own colleges first, since a
connection there is the common case, then nothing else; no "popular colleges" list), and a card per college:

```
┌ Duke University                                              ✕ ┐
│ Who went here?   [Parent] [Grandparent] [Sibling]  [Coach is recruiting me ▾] │
│ Parent · Grandparent                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```
- The three family chips toggle independently (a parent and a grandparent is common). "Coach is recruiting me" opens
  the built picks (Coach contact · Pre-read · Likely letter) and reads "Recruited · Pre-read" once picked, as the row's
  Connections line did.
- Under a marked family chip, the built state-ban sentence where one applies ("California bars legacy preference at all
  colleges, so this isn't used there"), from `banFor` (`lib/chances/legacy-bans.ts`).
- A card with nothing picked isn't saved. At most `CONNECTIONS_MAX` (10) colleges.
- Review gets a "Connections" line ("Duke (parent), Michigan (sibling)" or "None"); Edit jumps to the step.

**Stored** on the profile, not the list:
```
StudentProfileAcademics.connections: ConnectionEntry[]
ConnectionEntry {
  id: string,
  unitId: string,                                   // the college (any college in the dataset)
  family: ("parent" | "grandparent" | "sibling")[], // may be empty when only recruiting is set
  recruited: RecruitedPick,                         // "none" | "contact" | "pre_read" | "likely_letter" (built type)
}
```
`sanitizeProfile` drops an entry with an unknown unit id or nothing set. Entered on the intake and on the Numbers page
(a "Connections" section after Activities, the same cards). A guardian with edit access enters them like any profile
field; a guardian sees them (they are not the story and not a note).

## What reads it
- **The hooks.** `hooksFromPlan(items, visits, profile)` builds `legacy` (any of parent or grandparent), `sibling`, and
  `recruited` from the connection whose `unitId` matches the row, instead of the row's columns. Interest is unchanged.
  The method's gating stands: a connection enters only where the college's C7 rates alumni relation at least
  considered, never under a state ban, and sibling never stacks on a parent's ([method/standing.md](../../chances/method/standing.md)).
- **The profile's standing card** (`/college/[id]`, signed in) reads the connection directly, so "Add Duke to your list
  to mark a legacy connection" is replaced by the connection's own sentence; a college with no connection says nothing.
- **The list explainer** keeps its "legacy, recruiting" line; nothing about weights.
- **The ED sheet** keeps reading the hooks through the estimate, unchanged.

## Migration
- No schema change to `student_profiles` (jsonb). A one-off script, `scripts/backfill-connections.mts`, reads every
  `list_items` row with `legacy`, `legacy_sibling`, or `recruited <> 'none'` and writes the equivalent entries into the
  student's profile (`family: ["parent"]` for a legacy flag, since the toggle said "parent or grandparent"), skipping a
  college that already has one. Run once on dev after the build, on prod at the formal release.
- `list_items.legacy`, `legacy_sibling`, `recruited` stay in place and are no longer written or read; a later migration
  drops them once no release reads them (the `priority` pattern, [../redesign/list.md](../redesign/list.md#whats-removed)).
  `setItemLegacy`, `setItemSibling`, `setItemRecruited` and `AboutYouAndCollege.tsx` are deleted.

## The row
```
 ♥  [crest] Wake Forest University          [Good ED opportunity]   Working on it   🗑
```
- Heart, crest and name (linked), the one pill, the senior status word, and **Remove** as a trash icon (`Trash2`,
  44px, editors only, `aria-label="Remove Wake Forest from the list"`). Tapping asks first, in the built words (notes,
  visits, tasks, and the offer go with it), then removes; telemetry `plan_college_removed {dream}` as today.
- **No expand control.** `RowDrawer.tsx`, `row/*`, the `rowToDo` count and accent, and `plan_drawer_opened` go.
- **The ED pill** opens `EdSheet` as a dialog (`SheetDialog`: a bottom sheet on phones, centered from `sm`) instead of
  inline. Its contents are unchanged; its "Visit before you decide" line links the Show interest guide. The `open_row`
  move action becomes `open_ed_sheet { itemId }`; the ED card's button opens the dialog.
- **The interest pill** opens the Show interest guide for that college ([guides/show-interest.md](guides/show-interest.md)):
  `/plan/guide/interest?college=<unit id>`.
- **Capture leaves the list.** Visited, Requested info, Following, Quick links, and Next events are no longer on the
  Colleges tab anywhere; they live in the Show interest guide (visits and information requests and follows, with the
  events). The stored data and `hooksFromPlan`'s reading of it are unchanged. The ED sheet's "ED offered; no counts
  published" line moves into the sheet.
- Phones and desktop show the same one-line row; the name truncates before the pill does.

## Rules
- A connection is never shown on the row or the list; it shows in the profile, the standing card, and inside the
  estimate's "what went into it" where that exists.
- Never in telemetry (as today); exported with the profile; deleted with it.
- The intake stays optional past step 1: Continue never waits on Connections.

## Files (planned)
`lib/student-profile.ts` (`ConnectionEntry`, `CONNECTIONS_MAX`, sanitizer, `connectionsNone`), `lib/planner/intake.ts`
(the step, `searchConnectionColleges` over the index, review line, `applyIntake`/`draftFromProfile`),
`components/planner/intake/ConnectionsStep.tsx`, `ConnectionCard.tsx`, `components/me/ConnectionsForm.tsx`,
`lib/planner/hooks.ts` (profile-sourced), `lib/planner/profile-progress.ts` (eleven sections), `components/planner/PlanRow.tsx`
(trash, dialog), `components/planner/EdSheet.tsx` (dialog mode), `scripts/backfill-connections.mts`; deleted:
`RowDrawer.tsx`, `AboutYouAndCollege.tsx`, `components/planner/row/*`, the three item setters. Tests:
`tests/planner-intake.test.mts` (the step's save and read-back, None, the cap, an unknown college dropped),
`tests/planner-hooks.test.mts` (hooks from connections; a connection on a college not on the list is ignored by the
list's hooks and read by the standing card), `tests/planner-list-view.test.mts` (no drawer; the trash asks first).

## Open questions
1. Recruiting on this step (overview question 2)? Recommendation: yes.
2. Should adding a connection to a college not on the list offer "Add it to your list"? Recommendation: no; a
   grandparent's alma mater isn't a reason to apply, and the list guide handles additions.
