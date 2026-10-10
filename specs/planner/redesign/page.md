# Plan Page: A Top-Level Link, Three Tabs, and the Child Switcher

> Status: **planned** 2026-10-09. Part 1 of the [planner redesign](README.md). Replaces the Plan tab's frame
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
| `/plan` | signed-in guardian | The family: child switcher, defaulting to **Everyone** on the Calendar tab |
| `/plan?for=[person]` | guardian | One child's plan; the switcher remembers the last choice (`localStorage`, per-viewer convenience only) |
| `/plan?tab=scores` / `calendar` / `offers` | either | Opens a tab; tabs are links so back and forward work |
| `/plan` | signed out | The pitch and the numbers step ([below](#signed-out)) |
| `/plan/print` | either | The calendar's printable list (moves from `/household/[person]/plan/print`) |
| `/plan/preview` | anyone, preview deployments only | The design preview with a sample family (this spec's companion; deleted when the redesign ships) |

A guardian with one child skips the switcher's Everyone pill. A student in two households (divorced parents each with
an account) has one plan; both see it, as today.

## The page
```
┌───────────────────────────────────────────────┬──────────────────────┐
│ (M) Your plan                                 │ NEXT UP              │
│     Class of 2027 · applying this fall        │ University of Georgia│
│ [ GPA 3.82 · SAT 1390  ✎ ]                    │ ◆ EA due Oct 15 · 7d │
└───────────────────────────────────────────────┴──────────────────────┘
 [ Colleges ]  [ Scores • ]  [ Calendar ]  ( [ Offers ] from the first decision )
 … the open tab …
```
- **Header card**: the student's initial in their household color, "Your plan" (or "Maya's plan" for a parent), the
  class year and the season in words ("applying this fall", "building the list", "deciding"), and the numbers as
  one tappable line that opens the numbers form in place ([standing.md](standing.md#the-numbers)). No completeness
  meter.
- **Next up**: the single nearest deadline on the list in the round chosen, with days to go. Dark card with the
  round's color as a diamond. Before the season: "Applications open Aug 1, 2027". After every deadline: the next
  decision date. Nothing else competes with it.
- **Tabs**: Colleges ([list.md](list.md)), Scores ([scores.md](scores.md)), Calendar ([calendar.md](calendar.md)),
  and Offers once any college has a decision ([../offers.md](../offers.md), unchanged in substance). The Scores tab
  carries a dot when a retake suggestion is live. The student's default tab is Colleges; a parent's is Calendar.
- **First time**: a student with no numbers, or no Dream decision yet, gets the two-step setup
  ([standing.md](standing.md#first-time-setup)) in place of the tabs; it ends on the Colleges tab with the
  suggestions marked.
- **Empty list**: "Add colleges from Explore or any college's page" with the search box inline; the numbers step
  still works so groups appear the moment a college is added.

## The child switcher (parents)
A row of pills under the page title: each child as their initial in their household color, name, and class year,
then **Everyone** (a stack of the children's color dots). The selected pill is filled. Each pill's second line is
the child's summary line from [parents.md](../parents.md#the-summary-line), shortened ("Applying · 3 of 8 in · next
Nov 1"). The same colors are used for that child everywhere: the switcher, the calendar's "color by child", the
Coming-up list, the hub's people strip. Colors come from the dataviz palette's first three categorical slots in the
order children were added; a fourth child reuses slot 1 with a ring (households with four applying children at once
are rare enough not to justify a fourth hue).

With **Everyone** selected only the Calendar tab shows (the list and scores are per child); picking a child brings
the other tabs back.

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

## Files (planned)
`app/plan/page.tsx`, `app/plan/print/page.tsx`, redirects in `app/household/[person]/plan/page.tsx` and
`app/me/plan/route.ts`; `components/planner/PlanFrame.tsx` (header card, next up, tabs), `ChildSwitcher.tsx`,
`SignedOutPlan.tsx`; `Header.tsx` and `BottomNav.tsx`; `tests/planner-page.test.mts` (route choice per viewer, tab
fallback for Everyone, `?stage=` redirects).

## Open questions
1. ~~The phone tab bar~~: decided 2026-10-10 ([above](#navigation)).
2. Should a parent with edit access see the numbers form in the header card? Recommendation: yes, the same switch
   that lets parents edit the list ([household-hub.md](../../product/household-hub.md)) covers it, and the change is
   attributed like any other edit.
