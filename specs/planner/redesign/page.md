# Plan Page: A Top-Level Link, Three Tabs, and the Child Switcher

> Status: **built** 2026-10-10 on feature/plan-redesign ([build plan](build-plan.md)); **updated** 2026-10-11 on
> feature/plan-intake-redesign-frame for the [intake guide](intake.md) and the simplified frame below ("The page"
> and "The child switcher" are current as of that build; the rest of this file is the first build's description).
> Part 1 of the [planner redesign](README.md). Replaces the Plan tab's frame
> ([../model.md](../model.md#where-it-lives)): the six-stage strip, the stage panels, and the route under the household
> page. Builds on [household-hub.md](../../product/household-hub.md) and [parents.md](../parents.md).

## Goal
The plan is the reason to make an account, so it gets a place in the main navigation with the same weight as
Explore, one address that works for a student and for a parent, and a frame with three tabs instead of six stages.
A student opens Plan and sees their colleges; a parent opens Plan and sees the family's calendar.

## Navigation
- **Desktop header** (`components/layout/Header.tsx`): `Explore · Plan · Compare · High schools · Glossary · Data`.
  Plan is second, right after Explore. When the signed-in student or any child of a signed-in parent has a deadline
  in the next 7 days, a small dot sits on the link (the same `bg-pop` dot as the Compare count).
- **Phone tab bar** (`components/layout/BottomNav.tsx`): five tabs stay five: **Explore, Search, Plan, Compare,
  More**; Home moves to the logo in the header (it already links home). Plan's icon is `ListChecks`. (Owner,
  2026-10-10.)
- **Account menu**: "Household" stays for managing people (add, invite, roles, who can edit); the plan is no longer
  reached through it. `/household/[person]/plan` redirects to `/plan?for=[person]`; `/me/plan` redirects to `/plan`.

## Routes
| Route | Who | What |
|---|---|---|
| `/plan` | signed-in student | Their plan, Colleges tab |
| `/plan` | signed-in guardian | One child's plan (**changed 2026-10-11**: no more Everyone — see below), Colleges tab |
| `/plan?for=[person]` | guardian | One child's plan; a legacy `?for=everyone` falls through to the default below |
| `/plan?tab=scores` / `calendar` / `offers` | either | Opens a tab; tabs are links so back and forward work |
| `/plan?setup=1` | the plan's own editor | The intake guide ([intake.md](intake.md)) in edit mode, prefilled, starting at Review — the ✎ on the numbers line |
| `/plan` | signed out | The pitch and the numbers step ([below](#signed-out)) |
| `/plan/print` | either | The calendar's printable list (moves from `/household/[person]/plan/print`) |
| ~~`/plan/preview`~~ | (deleted 2026-10-11) | The design preview with a sample family, used during review; removed once the owner approved the build |

**Changed 2026-10-11** (`lib/planner/plan-frame.ts` `resolveSelectedChild`): a guardian's `/plan` always resolves to
one child now — the family/"Everyone" calendar is deferred with the rest of the family plan
([README.md](README.md#what-stays-what-goes)). The child is `?for=` when it names a real one on the roster, else the
last one viewed (the `plan_child` cookie, set by the switcher on every pick — a plain, non-`httpOnly` cookie, a
per-viewer convenience, nothing sensitive), else the child with the soonest open deadline, else the first on the
roster. A guardian with one child skips the switcher entirely (nothing to switch between). A student in two
households (divorced parents each with an account) has one plan; both see it, as today.

## The page
**Rebuilt 2026-10-11** on the [intake guide](intake.md) design handoff. Above the tabs there is only the title and
numbers line, Next up (or Your part for a parent, or NothingDue when nothing's due), and, when it applies, the
signed-out import banner — the stuck-signal stack, "What your parents see", and the header card's courses button
are all gone from this page (`StuckSignals`/`WhatParentsSee` stay as files/routes elsewhere; nothing here deletes
them). `GradYearPrompt` is gone too: a missing grad year is one of `intakeNeeded`'s conditions, so it's asked inside
the intake guide instead of a separate banner.
```
Phone                                   Desktop (lg:)
┌─────────────────────────────┐         ┌───────────────────────────────┬──────────────────┐
│ Your plan   GPA 3.82·SAT 1390✎│        │ Your plan            [Colleges][Scores•][Calendar]│ NEXT UP          │
├─────────────────────────────┤         │ Class of 2027 · applying this fall · GPA 3.82·SAT 1390 ✎│ Georgia & SC │
│ NEXT UP · Georgia and SC  7d │         ├───────────────────────────────┤ ◆ due Thu, Oct 15 │
├─────────────────────────────┤         │ … the open tab …              ├──────────────────┤
│[Colleges][Scores•][Calendar] │         │                                │ Coming up (8 wks) │
├─────────────────────────────┤         │                                ├──────────────────┤
│ … the open tab …             │         │                                │ (one notice)      │
└─────────────────────────────┘         └───────────────────────────────┴──────────────────┘
```
- **Header**: "Your plan" (or "Maya's plan" for a parent), Bricolage 800. On a phone the numbers line sits right of
  the title ("GPA 3.82 · SAT 1390 ✎"); on desktop it's below the title, after the class year and season in words
  ("applying this fall", "building the list", "deciding"): "Class of 2027 · applying this fall · GPA 3.82 · SAT
  1390 ✎". The whole line links to `planHref({person, setup: true})` — the intake guide in edit mode — when the
  viewer can edit; a read-only viewer with no numbers yet sees "No numbers yet" with no edit affordance. No
  completeness meter, no courses button.
- **Next up**: the single nearest deadline on the list in the round chosen, with days to go, in a dark ink card;
  when two or more colleges share that exact date and round their names are joined ("Georgia and South Carolina").
  Before the season: "Applications open Aug 1, 2027". After every deadline: the next decision date.
  **NothingDue** takes Next up's place when the list has no open deadline at all (a student with nothing due yet,
  or — most often — a parent looking at a child who hasn't picked rounds): a lime check tile, "Nothing due this
  year", and, on a phone, the same season words as the header ("Class of 2029 · building the list"); on desktop,
  where this sits in the aside instead of beside the title, a line explaining why instead ("Deadlines show up here
  once Sam picks rounds.").
- **Your part** (parent only, `components/planner/parents/YourPartLine.tsx`): the guardian's own first open task for
  this child (`lib/planner/summary.ts` `yourPart`), as one white card with a lime "Your part" tag, the task and its
  date ("Check Wake Forest's cost together by Nov 15"), and an "Open" link when the task has a URL (a `cost_check`
  task's college net price calculator). This is the one-line version; the full list across every child is still the
  household page's `YourPart` section (parents.md).
- **Tabs**: Colleges ([list.md](list.md)), Scores ([scores.md](scores.md)), Calendar ([calendar.md](calendar.md)),
  and Offers once any college has a decision ([../offers.md](../offers.md), unchanged in substance). A segmented
  pill, ink fill on the active tab, a **coral** dot (not lime) on Scores when a retake suggestion is live. Both the
  student's and a guardian's default tab are Colleges now (**changed 2026-10-11**; a guardian's `/plan` no longer
  has a calendar-first family view to default to — see Routes).
- **Layout**: two columns on desktop (`lg:`) — left, the header with the tabs beside it, then the open tab's body;
  right (~380px, sticky), Next up/NothingDue, then the 8-week "Coming up" list (`UpcomingList` `variant="aside"`,
  [calendar.md](calendar.md)), then the one notice (`PlanNotice`, [list.md](list.md) `view.notices[0]`). On a phone
  it's one column: header, Next up/NothingDue, Your part, the tabs, the open tab's body (the list shows the one
  notice at its own top on a phone instead, `lg:hidden`).
- **First time**: a student (or a guardian who can edit) with no grad year, or neither a GPA nor a test choice yet,
  gets the [intake guide](intake.md) in place of the tabs (`lib/planner/intake.ts` `intakeNeeded`); it ends on the
  Colleges tab. A read-only guardian in the same state sees the plan itself, with "No numbers yet" in the header.
- **Empty list**: "Add colleges from Explore or any college's page" with the search box inline; the numbers step
  still works so groups appear the moment a college is added.

## The child switcher (parents)
*Who is on it (fixed 2026-10-11, owner testing):* the children on the parent's household roster, the same people
the Household page shows (`lib/households.ts` `householdChildren`). A student record the parent can still read only
because they created it, but that is no longer in the household (left behind when the child joined with their own
account), is not a child here; the first version listed every readable record, so "Maya" and "Maya Ross" both
appeared and only one had the list. The parent's "Add to list" picks from the same children.

**Changed 2026-10-11**: no more **Everyone** pill — the family/"Everyone" calendar is deferred with the rest of the
family plan ([README.md](README.md#what-stays-what-goes)); `FamilyCalendar`'s `everyone` mode code stays (not
deleted) for when it's built. A row of pills under the page title (hidden entirely when there's only one child):
each child as a 40px initial avatar in their household color, their name, and class year; desktop precedes the row
with "Viewing". The selected pill is filled. Each pill's second line is the child's summary line from
[parents.md](../parents.md#the-summary-line), shortened ("Applying · 3 of 8 in · next Nov 1"). The same colors are
used for that child everywhere: the switcher, the calendar's "color by child", the Coming-up list, the hub's people
strip. Colors come from the dataviz palette's first three categorical slots in the order children were added; a
fourth child reuses slot 1 with a ring (households with four applying children at once are rare enough not to
justify a fourth hue). Picking a pill sets the `plan_child` cookie (`ChildSwitcher.tsx`, client-side, plain and
non-`httpOnly`), which `resolveSelectedChild` reads on the next `/plan` open with no `?for=` ([Routes](#routes)).

## Signed out
`/plan` signed out is the pitch and the first step, not a wall:
1. One sentence ("Your colleges, sorted by your numbers, with every deadline in one place") and a 10-second loop of
   the list re-sorting as a score changes (a recording of the preview, not a live demo).
2. The numbers form ([standing.md](standing.md#the-numbers)), kept in `localStorage` like the signed-out profile is
   today, and "Add colleges" from search; rows show groups and rounds live.
3. "Save your plan" (sign up) to keep it across devices, share it with a parent, and get reminders. The local numbers
   and colleges import on sign-up, as the profile already does (`ImportLocalProfile`).

## What's removed from the frame
`StageStrip`, the stage panels (`components/planner/stages/*`) as panels, the "six stages… a map, not a gate"
sentence, `ThisWeek` as its own section (its content is Next up plus the Calendar's Coming up), and the
`?stage=N` parameter (redirected to the matching tab: 1–2 → Colleges, 4 → Calendar, 6 → Offers, 3 and 5 → Colleges).
`stageOf()` stays: the hub caption, the reminders, and the default tab still read it.

## Telemetry
`plan_opened {tab, viewer: student|guardian, everyone}` replaces `plan_opened {stage}`; `plan_tab {tab}`;
`plan_switch_child`; `plan_signed_out_started`, `plan_signed_out_saved`. Never a name, a college, or a number.

## Files
`app/plan/page.tsx`, `app/plan/print/page.tsx`, redirects in `app/household/[person]/plan/page.tsx` and
`app/me/plan/route.ts`; `components/planner/PlanFrame.tsx` (header, Next up/NothingDue, tab pills + body),
`PlanHeaderCard.tsx`, `NextUp.tsx`, `PlanTabs.tsx` (`PlanTabPills` + `PlanTabs`), `ChildSwitcher.tsx`,
`parents/YourPartLine.tsx`, `parents/NothingDue.tsx`, `SignedOutPlan.tsx`; `lib/planner/plan-frame.ts`
(`resolveSelectedChild`, `nextUpGroup`, `joinNames`, `weekdayLabel`); `Header.tsx` and `BottomNav.tsx`;
`tests/planner-page.test.mts` (route choice per viewer including the cookie and the soonest-deadline tie-break,
Next up's grouping, `?stage=` redirects), `tests/planner-plan-tabs.test.mts` (the guardian default tab).

## Open questions
1. ~~The phone tab bar~~: decided 2026-10-10 ([above](#navigation)).
2. ~~Should a parent with edit access see the numbers form in the header card?~~ Decided yes 2026-10-10; the 2026-10-11
   rebuild answers it the same way through the intake guide instead of an inline form — the header's ✎ opens
   `planHref({person, setup: true})` for any editor, parent or student, and the edit is attributed like any other.
