# Coalition Application: Which Colleges Take It (Coalition for College member list, Scoir's list)

> Status: **built** 2026-10-28 (PR #182, `feature/coalition-app`; see [As built](#as-built-2026-10-28)); specified the
> same morning (owner: "add a spec and then go ahead and build it"). A small companion to [common-app.md](common-app.md): the site knows which colleges
> take the Common App and nothing about the other shared application. Feeds the "What it takes to apply" card
> ([common-app.md](common-app.md#display)), the planner's platform picker ([../planner/applications.md](../planner/applications.md)),
> and the glossary. Part of [data-expansion](README.md).

## Question it answers
*Does this college take the Coalition application?* The Coalition for College is the Common App's smaller rival: a
nonprofit whose member colleges (146 on 2026-10-28; "more than 150", its FAQ says) share an application with an
access mission. Since the 2023–24 cycle the form is delivered through Scoir, the counselor platform ("Coalition on
Scoir"), and not every member takes applications that way: Scoir lists 116 colleges that do (as of 2026-10-20).
Most Coalition members also take the Common App, so for a student it is usually a choice of form, not of colleges; a
few take the Coalition form and not the Common App.

## Why
The planner's application card lets a student record the platform they used, with Coalition as one of six choices,
and the Applications view groups cards by platform; but the site has no member list, so the picker offers Coalition
to every college and the "What it takes to apply" card never mentions it ([../planner/applications.md](../planner/applications.md)
notes the gap). Two public lists close it.

## Sources
| Source | What | Access | Read |
|---|---|---|---|
| The Coalition's member list, `https://www.coalitionforcollegeaccess.org/our-members` (the `/member` link resolves there) | Every member college, alphabetically, each linked to its own admissions page | A public Squarespace page; its robots file allows ordinary crawlers (`User-agent: *` disallows only account, search, and query-string paths) and names no terms of use (checked 2026-10-28) | Once a year, and when the planner's platform list is questioned |
| Scoir's list, `https://www.scoir.com/apply-colleges` | "The colleges below accept applications through Scoir", dated ("As of October 20, 2026"), one name per line | A public page; robots allows it | The same run |

Both are read through the site's polite crawler (robots.txt honored, the honest user agent, one request each): two
requests a year. Nothing else is taken from either page: no logos, text, or counts beyond the names, the admissions
links (used only to join), and Scoir's date.

**Permission.** Unlike Common App's site, neither page carries terms that forbid reading it, and what is kept is a
list of names and a yes/no per college, the kind of fact every guidebook prints. The ⓘ on every value names the
Coalition for College and links its homepage; the site links no other page of either organization.

## Store
A present-only block on members, like `apply` for Common App members:

```ts
school.coalition: {
  member: true;          // on the Coalition's member list
  via_scoir: boolean;    // on Scoir's list of colleges taking applications through it (the Coalition form)
  retrieved: string;     // the day both lists were read
}
```
Registered in `lib/fields.ts` as `coalition.member`, `coalition.via_scoir`, and `coalition.retrieved` (every stored leaf is a field, as the lineage check requires), source `coalition` (label "Coalition
for College"), vintage `coalition-members` ("Member list read October 28, 2026"); a non-member has no block and cites
nothing (`PRESENT_ONLY`, like `common-app`). The source and vintage are written by the merge, not the sync
(`MERGED_LATER`), so a dataset published before the first merge still passes the lineage check.

Files, in git like every other input: `data/coalition/members.json` (the two lists as read, each name joined to a
`unit_id` or listed as unmatched with the reason) and `data/coalition/name-map.json` (name → unit id for the names no
rule joins, each checked by hand). `npm run sync-coalition` reads the pages and writes the file; `npm run
merge-coalition` applies it to `data/schools.json` and `data/meta.json`; `sync-data` applies the committed file the same
way after the Common App block, so the two never disagree.

## Joining names to colleges
In order, each needing exactly one college; never a similarity guess:
1. the admissions link's registrable domain equals exactly one college's website domain (Coalition names only;
   Scoir prints no links). First, because the college's own site is the strongest identifier: the Coalition's
   "Wheaton College" links wheatoncollege.edu (Massachusetts), while the exact name is the Illinois college's;
2. the college's name, exactly;
3. the name normalized (case, curly quotes, spaces and dash kinds around a hyphen; the Common App join's rule);
4. a row of `data/aliases.json` whose key equals the name's alias key and whose unit id is unique among the rows;
5. `name-map.json`, whose entry may name several colleges when one printed name stands for two campuses
   (St. John's College: Annapolis and Santa Fe).
A name no rule joins goes to `unmatched` with the rules tried. Scoir's names join the same way; `via_scoir` is true
for a member whose unit id is on Scoir's list. A Scoir name that joins a college not on the member list is listed
under `scoir.not_members` for a person to look at, and stored nowhere.

## Display
- **"What it takes to apply"** (a Common App member's card): one more line, "Also takes the Coalition application,
  through Scoir.", cited to `coalition.via_scoir`, with the glossary term `coalition-application`.
- **A college that takes the Coalition form but not the Common App**: a small "How to apply" block on the admissions
  page in the same place, with "Takes the Coalition application, through Scoir."
- **The planner**: `platformsFor` offers Coalition only to a college on Scoir's list (a platform already saved stays
  selectable, marked not offered, as today); the application card's platform line reads "Takes the Common App and the
  Coalition application." or "Takes the Coalition application, through Scoir." before the student picks.
- **Glossary**: `coalition-application`.
- Membership alone (a member not on Scoir's list) is stored and cited but not shown: it tells an applicant nothing.
- Not built, on purpose: an Explore filter and a Compare row (a choice of form, not a reason to pick a college), the
  Coalition's own deadlines (it publishes none; the Common App grid and the CDS carry them).

## Checks
- Parse: at least 100 and at most 300 member names, no duplicates; at least 50 Scoir names and a date on the page;
  the sync exits 1, writing nothing, otherwise.
- Join: at most 10% of either list unmatched, else exit 1 with the names to add to `name-map.json`.
- Lineage: `npm run check:lineage` finds both fields; a non-member's footnotes never list the Coalition.
- Fixture tests: both parsers on saved excerpts; every join rule and the never-a-guess rule; the block is set for a
  member, removed for a college that left the list, and keeps its place in the record; the source and vintage come
  from the file's dates, never typed; `platformsFor` and the platform line for member, Scoir, both, and neither.

## Complexity
Small: two pages read once a year, one block, one line on a card, one planner rule.

## Open questions
1. Should a Coalition-only college (not a Common App member) get the full "What it takes to apply" card? Its
   deadlines come from the CDS when on file; the card stays the grid's. Revisit if more than a handful exist.
2. Scoir's list may include colleges that take applications through Scoir without being Coalition members
   (`scoir.not_members`); the first run says whether that set is empty.

## As built (2026-10-28)
Built on `feature/coalition-app` the day it was specified; where this section and the plan above disagree, this
section is what runs.

- **Read.** `npm run sync-coalition` (`scripts/sync-coalition.mts`) fetches the two pages through `PoliteHttp`
  and writes `data/coalition/members.json` (`CoalitionFile` in `lib/coalition.ts`): the member list as read (name,
  admissions link, unit id, join rule), Scoir's list (its "As of" date, names, unit ids), and the unmatched names
  with the rules tried. The parsers (`scripts/lib/coalition/parse.mts`) read the Squarespace summary items and the
  `<br>`-separated paragraph; the join (`scripts/lib/coalition/join.mts`) applies the five rules above.
- **Merge.** `scripts/lib/coalition/merge.mts`: `applyCoalition` sets or removes the block (placed before the record's
  later keys, like `apply`), `addCoalitionMeta` writes the source and vintage from the file's dates; `npm run
  merge-coalition` applies them to the committed data and refuses to write on a lineage failure; `sync-data` calls the
  same functions after the Common App block.
- **Display.** `coalitionSentence()` in `lib/coalition.ts` is the one sentence, read by the card
  (`components/school/WhatItTakes.tsx`), the new `components/school/HowToApply.tsx` block for Coalition-only colleges,
  and the planner's platform line; `platformsFor` reads `school.coalition?.via_scoir`.
- **Numbers, first run (2026-10-28):** see the PR's description and `data/coalition/members.json`.
