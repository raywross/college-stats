# The role item: Advisor, Household, Caseload

> Status: **built** 2026-11-08 (owner's request: "Advisor as a top-level function is perfect for a student, but a parent
> manages students through their household and a counselor through their caseload"). Part of [product](README.md);
> follows [advisor.md](advisor.md) "1. The name", [household-hub.md](household-hub.md), and
> [counselor-portal.md](counselor-portal.md).

The header's second item and the phone's middle tab used to say **Advisor** to everyone, and the avatar menu carried
the role work: Caseload for a counselor, Household for all, Your account, Admin. A student's day is their advisor, so
the item fit them. A parent's day is their children, reached through the household; a counselor's is their students,
reached through the caseload. For those two the item said the wrong word and the right pages hid in the avatar menu.

## Who is who

`/api/me` answers a `role` beside `org` and `admin` (`lib/accounts.ts meRoleOf`), one rule for the header, the tab bar,
and the tests:

| Facts | Role |
|---|---|
| A member of a counselor organization (`my_organization()`), whatever else they are | **counselor** |
| Otherwise, a student on their household's roster as a guardian (`householdChildren()`), or "a parent or guardian" said at sign-up (`role_hint`) | **guardian** |
| Everyone else, including a counselor role hint with no organization yet | **student** |
| Signed out | none |

The sign-up form defaults to "a student", so a parent who never switched it still reads as a guardian the moment a
child is on the roster. A counselor who is also a parent keeps Caseload as the item and finds their children in its
menu. The answer also carries `children` (id and name, roster order) for the menu's entries.

## The item

One pill (`components/layout/RoleNavItem.tsx`), built from `roleNav(me)` (`components/layout/role-nav.ts`, pure): the
label is a link, one click to the page that role uses most, and a chevron opens a menu when the role has one.

| Role | Label | One click | Menu under the chevron |
|---|---|---|---|
| Signed out, a student, or an answer not in yet | Advisor | `/advisor` (the splash page signed out) | none: a plain link, as before |
| Guardian | Household | `/advisor`: the last child's advisor, with the people line as the switcher | *Jordan's advisor*, *Maya's advisor* (each child by first name; "Their advisor" for a name not in yet), then **Manage household** (`/household`) |
| Guardian with nobody on the roster yet | Household | `/household` | **Add someone** |
| Counselor | Caseload | `/org` | **Add students** (`/org/students/new`), **Members and settings** (`/org/members`); then, for a counselor who is also a parent, their children's advisors and **Household** |

The item is filled (active) on the role's own paths: `/advisor` and `/household` for a guardian, those and `/org` for a
counselor, so a caseload student's advisor lights Caseload. The advisor's dot (a deadline in the next week or a new move,
`usePlanDot`) stays on the item for every role. The names come from `ADVISOR_SHORT` and `advisorTitle()`
([advisor.md](advisor.md)); the hrefs from `planHref()` and `CASELOAD_HREF`.

**Why the parent's click lands on the advisor, not the roster.** The advisor is the product a family pays for and the
page a parent opens daily; the roster is a weekly job. The people line at the top of the advisor is the household's
students, so the page still reads as "Household". The alternative (landing on the hub, one hop from the advisor) was
offered and declined (owner, 2026-11-08).

## The avatar menu

The personal things stay: name and email, **Your account**, **Admin** for an admin ([admin.md](admin.md) "The
console"), **Sign out**. **Household** stays for a student (it is how they invite a parent). A guardian's Household and a
counselor's Caseload are the role item's now (`components/account/account-menu-links.ts accountMenuLinks(me)`).

## Phones

The middle tab takes the role's label, icon (ListChecks, Users, Briefcase), and one-click destination; a tap on
Household opens the advisor with the people line. The More sheet lists the role's **page** entries at the top, under
Account (Manage household or Add someone; Add students and Members and settings; a counselor-parent's Household), not
the children: their advisors are one tap away on the people line. The sheet's own Caseload row is gone.
[mobile.md](../mobile.md) describes the bar.

## First paint

The header renders from the `quad_signed_in` cookie and a five-minute memo of the last `/api/me` answer
([accounts.md](accounts.md) "Header state"), so the static HTML carries Advisor and a signed-in parent or counselor
sees the item become theirs once the answer is in: at hydration from the memo, or a moment later on the first page of a
new tab. A stored answer from before the role existed (no `role`) is treated as stale and asked again. The two pages
where the role or the children change refresh the answer on arrival (`RefreshHeader`): `/org` (membership) and
`/household` (becoming a guardian, adding a child).

## Files

| File | Role |
|---|---|
| `lib/accounts.ts` | `MeRole`, `MeChild`, `meRoleOf()`, `MeState.role` and `.children` |
| `app/api/me/route.ts` | Answers `role` and `children` from `me_bundle()` in one call (else `householdChildren()` beside the profile read) |
| `components/layout/role-nav.ts` | `roleNav(me)`: label, href, icon, menu entries (`kind: "child" \| "page"`, icon, caption), active paths |
| `components/layout/RoleNavItem.tsx` | The desktop pill: link + chevron menu (base-ui `Menu`, as the avatar menu) |
| `components/layout/Header.tsx`, `BottomNav.tsx` | Render the item in the Advisor slot / the middle tab; the More sheet's role pages |
| `components/account/account-menu-links.ts` | The avatar menu's links by role |
| `components/org/RefreshHeader.tsx` | Now also in `app/household/layout.tsx` |
| `tests/role-nav.test.mts` | The rule, each role's item, the avatar links, the wiring |
