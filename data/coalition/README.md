# Coalition application data

Raw inputs for the Coalition section (specs/data-expansion/coalition-app.md). `npm run sync-coalition` writes
`members.json`; `npm run merge-coalition` applies it to `data/schools.json` as `school.coalition` and to
`data/meta.json`. Nothing here is served directly.

| File | What it is |
|---|---|
| `members.json` | The Coalition's member list and Scoir's list as read (`CoalitionFile` in `lib/coalition.ts`): each name with the admissions link the Coalition prints, the college it joined to and the rule that did it, whether it is on Scoir's list, Scoir's "As of" date, and the names no rule joined. |
| `name-map.json` | Name → IPEDS unit id for the names no rule joins. Each entry was checked by hand (the college's own site agrees with the name). |

Refresh once a year, and when the planner's platform list is questioned: two page reads through the polite crawler.
After a run, read the printed unmatched list; add an entry to `name-map.json` only when the college is certain, then
rerun. Never add an entry by name similarity alone.
