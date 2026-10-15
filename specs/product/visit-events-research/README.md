# Visit events: research archive

The research behind [visit-events.md](../visit-events.md), kept so a later round (a new vendor, a change at TargetX
or Element451, a revisit of the robots.txt decision) starts from what was measured rather than from memory. These
are working documents written during the build, 2026-10-13 to 2026-10-15, by the lead and by research agents; they
are kept as written apart from local file paths. The spec holds the decisions; where the two disagree, the spec
wins (the Element451 build, for instance, corrected three points in its research: occurrence ids collide across dates,
virtual sessions can carry a placeholder location, and the latitude/longitude pair was swapped).

| Document | What it measured | Led to |
|---|---|---|
| [universe.md](universe.md) | One standard-search read of all 795 Slate hosts: 350,406 events by kind, the most common titles per kind, the hosts with the most staff rows | The five shown kinds and the stored-but-hidden rule (`other`, `staff`); the title rules in `lib/visit-events/kinds.ts` |
| [non-slate-vendors.md](non-slate-vendors.md) | The visit pages of the 984 colleges without a Slate host, classified by the registration system they link | Round 3's choice of TargetX and Element451; the widened Slate discovery (hosts linked without a portal path) |
| [targetx.md](targetx.md) | TargetX's two readable flavours (the legacy events site's remoting reads, the ERx site's embedded list), the Lightning flavour, field names, and the coverage split over 151 colleges | The TargetX reader (`scripts/lib/visit-events/readers/targetx.mts`), built and then switched off when the pilot found Salesforce's default robots.txt (owner's decision 2026-10-15) |
| [element451.md](element451.md) | Element451's server-rendered `event451` listing, its state blob, field names, and the coverage over 50 colleges | The Element451 reader (`readers/element451.mts`), live on 20 colleges |

Raw material these cite (saved pages, remoting responses, the per-college classification lists) lived in the owner's
build folder outside the repository and was not kept, except what the tests use under `tests/fixtures/visit-events/`.
The list of the 74 TargetX colleges affected by the robots.txt decision is summarised in the spec's "TargetX: the
protocol" section.
