# Part 1, The Prompts: What Each College Asks Students to Write

> Status: **built** 2026-10-29 (`feature/essays`; see [As built](#as-built-2026-10-29)); the first live read over
> colleges is the owner's to run (the `essay-prompts` workflow). Planned 2026-10-28. Part 1 of [essays](README.md). Builds on the college-reported agent
> ([../../college-reported-data.md](../../college-reported-data.md), its archive and recipes) and the Common App card
> ([../../data-expansion/common-app.md](../../data-expansion/common-app.md)); feeds the workspace
> ([workspace.md](workspace.md)) and the plan. Part of [product](../README.md).

## Question it answers
*What will I have to write for this college, how long, and is it required?* And across the list: *how many essays am
I signing up for?*

## What the site has
The Requirements Grid's one column, "writing supplement" (yes or blank), which the 2026-27 grid leaves blank for every
member, so the card never shows it; nothing about short answers, limits, or the prompts themselves. The prompts inside
Common App, the Coalition form, and a college's own form sit behind a student's login and are off limits (the terms
forbid bots, and we agreed to read only the grid and the Explore pages).

## Where the prompts come from, and whether they match the form
Every college with a supplement publishes it on its admissions site before the cycle opens, because students draft
outside the form: "essay prompts", "writing supplement", "supplemental essays", usually under how-to-apply, with the
cycle named ("2026-2027 first-year applicants"). A college writes one set of essay prompts and uses it on every form it
accepts, so the published page matches the application for the essays. It can differ for the small questions inside
the form: an intended major, a second-choice program, a 50-word "why this program" that exists only there. Some
colleges publish those too, some don't. So the record says "as the college publishes them" and the card says the
application may ask a few short questions beyond these.

The platforms' own prompts are public: the Common App's personal essay prompts (seven, the same every recent cycle)
and the Coalition's. They are stored as a reference file with their source pages and shown with a link to each
organization's homepage (Common App's terms allow linking only to its homepage;
[common-app.md](../../data-expansion/common-app.md#permission)).

## Sources
| Source | What | How read | Refresh |
|---|---|---|---|
| The college's admissions site: its essay-prompts or writing-supplement page | Each prompt verbatim, its limit (words or characters), required or optional, who it applies to (everyone, a program, transfers), the cycle | The college-reported agent, a new recipe type `essay-prompts`: discovery by the site's well-known paths and its own search (the class-profile route's pattern), then one model read of the page with the archive copy kept, every value quoted | August to October each year, when the pages change for the cycle; and whenever the archive's manifest sees the page change |
| `commonapp.org` (the personal essay prompts page) and `coalitionforcollegeaccess.org` (its essay prompts page) | The platforms' own prompts | A reference file, `data/reference/platform-prompts.json`, kept by hand with the page and date (two pages a year) | Each August |

Access rules as everywhere: robots.txt honored, the honest user agent, one read per page per refresh, the page kept in
the archive so a re-judge never refetches.

## Store
Per college, a college-reported block like the class profile's, with per-value lineage (the page, the quote, the date,
the cycle as the edition):

```ts
essays: {                                 // a top-level block on the record (as built; the plan said reported.essays)
  cycle: "2026-27";                       // as the page states it; a page with no cycle is held for review
  source_url: string; retrieved: string;
  status: "published" | "none" | "refers_to_form";  // none: the page says there is no supplement; refers_to_form: "see the Common App"
  choose?: { n: number; of: number; quote: string }; // "answer four of the eight": each prompt is then optional on its own
  prompts: {
    id: string;                           // stable within the cycle: "{unit_id}:{cycle}:{n}"
    text: string;                         // verbatim
    kind: "essay" | "short_answer" | "why_us" | "program" | "activity" | "optional" | "other";
    limit: { kind: "words" | "characters"; max: number; min?: number } | null;
    required: boolean;
    applies_to: "all" | { program: string } | "transfer" | "international" | string;
    quote: string;                        // the sentence the limit and requirement were read from
  }[];
}
```
Registered in `lib/fields.ts` as `essays.*` (source `college-site`); one lineage record per college at
`lineage.essays` (method `extracted`, year = the cycle, the page's url, the date read, the page's own cycle line as the
quote) covers every `essays.*` path, so the display cites each prompt to its page and date. `status: "none"` is a fact worth showing ("No essays
beyond the Common App's"); `refers_to_form` shows nothing and counts as unknown.

## Checks
- A prompt is a sentence or a question, 10 to 1,500 characters, quoted verbatim; a limit is a whole number from 25 to
  2,000 words or 100 to 10,000 characters; `required` comes from the page's own word (required, optional, "if you
  wish"); a page with no cycle, or a cycle older than the one open, is held for review, never published.
- A college whose prompts changed between editions keeps both, so the card can say "new this cycle".
- The kind is read, not inferred: `why_us` only when the prompt asks why this college or program; `program` when it
  applies to a named school within the university.
- The review queue takes anything the checks hold, as for every reported value; the Data Steward's To do list takes
  pages that block us.
- Fixture tests: the reader on four saved pages (a plain list, a table with limits, a page with program-specific
  prompts, a "no supplement" page); the checks on planted bad values; the count across a fixture plan.

## Display
- **"What it takes to apply"** ([common-app.md](../../data-expansion/common-app.md#display)): a line, "2 essays
  (250 and 400 words) and 3 short answers; 1 optional", cited; it opens an **Essays** fold listing every prompt with
  its limit and requirement, each cited to the college's page, and the platform's own prompts linked above them. A
  college with `status: "none"` says so. A line under the fold: "The application may ask a few short questions
  beyond these."
- **The plan's Colleges tab**: the count across the list ("Your list asks for 14 essays and short answers, 9 of them
  'why us'"), reading `reported.essays` for every row; colleges with nothing on file counted as unknown and said so.
- **The workspace** ([workspace.md](workspace.md)): the prompt picker and each draft's heading.
- **Compare**: a row with the counts, only when every compared college has a record.
- **Glossary**: `supplemental-essay`, `short-answer`, `why-us-essay`.

## Coverage and cost
First wave: the 200 most-applied-to colleges plus every college on any plan on the day of the run; then monthly for
colleges newly added to a plan. At the class-profile route's cost (about $0.15 a college, one page, one model read),
the first wave is about $40 and a cycle's refresh about the same.

## Complexity
Medium: a recipe type for the agent with its checks and fixtures, a reported block with lineage, the card's fold and
the plan's count, and a reference file.

## Open questions
1. Prompts that exist only inside the form (the 50-word program question): leave them to the student's own reading of
   the form, with the card's one-line warning? Recommendation: yes; the alternative is reading a student's form, which
   we have ruled out.
2. ~~The platforms' prompts: store the text, or only link?~~ Decided 2026-10-28 (owner): **store the text** for both,
   with each organization's homepage as the link, so the workspace shows the prompt beside the draft.

## As built (2026-10-29)
Built on `feature/essays` the day after the plan, with the workspace and the reviewer. No college has a block yet:
the first read is the owner's to run (`.github/workflows/essay-prompts.yml`, by hand, with `units`, `top`, and
`budget`; it opens a data PR and never auto-merges).

- **The block is top-level** (`school.essays`, `SchoolEssays` in `lib/types.ts`), placed before the later keys like
  the Coalition block, with one lineage record per college at `lineage.essays` rather than per value. The lineage
  check (`essaysProblems` in `lib/lineage.ts`) requires that record, rejects stray keys and records under `essays.*`,
  and requires prompts only when `status` is `published`.
- **The reader** (`scripts/lib/essay-prompts/`): `discover.mts` tries the recipe, then the essay links on the apply
  and admissions pages the record already holds, fourteen well-known paths, the sitemaps robots.txt lists, and
  finally one cheap model pick among candidates; `read.mts` makes one `claude-opus-5` read per page (adaptive
  thinking, cached system block, a JSON schema for the record); `checks.mts` holds any record whose prompts or quotes
  are not on the page word for word, whose cycle is missing or stale, or whose limits are inferred. Held records go to
  `data/essay-prompts/held/`, never into the dataset. `cycle.mts` opens the cycle on 1 August; records from an older
  cycle are dropped at merge so last year's prompts never show. A record keeps the previous cycle's prompts in
  `previous` when they changed.
- **Scripts**: `npm run sync-essay-prompts -- --units | --top N | --on-plans <file> | --dry-run | --budget <dollars>
  | --force | --discover-only | --report body|note` (exit 3 when the budget stops it); `npm run merge-essay-prompts`
  applies records and `data/reference/platform-prompts.json` to `data/schools.json` (one college per line, refusing
  to write on a lineage failure); `sync-data` runs the same step after the Coalition one. A price line for
  `claude-opus-5` was added to the engine's spend cap.
- **The platforms' prompts** (`data/reference/platform-prompts.json`, read at runtime through
  `getPlatformPrompts()` in `lib/data.ts`): the Common App's seven prompts and the Coalition's, verbatim, each with
  its homepage as `source_url` and the page actually read in `read_from`. The Common App's pages do not state the
  650/250-word limits, so its entry has `limit: null` and a `limit_note`; the workspace applies 650/250 from the
  form's own rules. The Coalition page names no cycle (`cycle_note`); its "about 500-650 words" sentence is the limit.
- **Display** (`components/school/EssayPrompts.tsx`, `lib/essays/summary.ts`): one cited line on the "What it takes
  to apply" card ("2 essays (250 and 400 words) and 3 short answers; 1 optional"; "No essays beyond the Common App's"
  for `none`; nothing for `refers_to_form`), a fold with every prompt cited, the platform's own prompts linked above
  only for platforms the college takes, and the one-line warning about questions inside the form. A college with
  prompts and no Common App card gets the block on its own beside "How to apply". The plan's Colleges tab says "Your
  list asks for 14 essays and short answers, 9 of them 'why us'; 3 colleges not on file" under the balance notice;
  compare shows an "Essays" row only when every compared college has something to say. Glossary:
  `supplemental-essay`, `short-answer`, `why-us-essay`.
- **Tests**: `tests/essay-prompts.test.mts` (the reader on four fixture pages with a fake model, every check on
  planted bad values, discovery's ordering, the merge's placement and removal, the lineage check, the platform
  file's shape, the workflow's structure) and `tests/essay-display.test.mts` (the strings, the fold's citations, no
  hard-coded 650).
- **Not built**: a query of the plans for `--on-plans` (it takes a file of unit ids); feeding held records to the
  admin review queue (they are files plus the PR's table); writing blocked hosts to the shared blocked-hosts file.

### The second reader (2026-10-29, after the first run)
The first run over the 200 most-applied-to colleges read 200 pages for $3.65: 22 passed, 73 held, 105 not found, 40
hosts blocked. Three faults in the reader, fixed the same day (`READER_VERSION` 2026.10.29.2):
- **A platform's page is never the college's.** A Common App member's apply link points at commonapp.org, whose
  homepage reads like "the prompts are in the form"; twelve colleges, Cornell and Stanford among them, were recorded
  that way. Discovery now skips shared platforms and system portals (`PLATFORM_HOSTS`: the Common App, the
  Coalition and Scoir, ApplyTexas, Cal State Apply, SUNY, QuestBridge, and so on) as start pages, as fetched pages
  including after a redirect, and in the picker's list. The UC's shared admissions site is not on the list: its
  personal insight questions page is the campuses' own.
- **A page that names no cycle is not held.** Seventy of the 73 holds were "the page names no cycle", and for fifty it
  was the only reason: the UC's page, Vanderbilt's, Notre Dame's and Dartmouth's simply print no year. The reader now
  uses the cycle open on the day it read the page, marks the record `cycle_assumed`, and the data PR lists those
  colleges under "Cycle assumed" for a glance. The lineage record carries no quote for them. A record with neither a
  cycle quote nor the mark is still held.
- **"Answer four of the eight."** The block gained `choose: { n, of, quote }` for pages whose prompts are a set to pick
  from (the UC's eight personal insight questions, four answered). The reader returns it with the sentence that says
  so; the checks require `of` to match the prompts listed and refuse any prompt marked required under it; the card
  line reads "Choose 4 of 8 essays (350 words)", the fold says "Answer 4 of these 8." and drops the per-prompt
  Required/Optional word, and the plan's count adds four, not eight. Registered as `essays.choose`.
The 105 not-found colleges are a discovery problem for a later round: the cheap steps found few pages and the model
picker found 57.

### The third reader (2026-10-29, after the second run)
The second run passed 68 (27 published, 26 pointing to the form, 15 with none), held 20, found no page for 112, for
$3.87. Reading its records showed four more faults, fixed as `READER_VERSION` 2026.10.29.3:
- **The serializer dropped the new fields.** Records are written with a fixed key order, and `cycle_assumed` and
  `choose` weren't in the list, so every UC campus read as "8 optional essays" on disk. Both keys are written now, and
  a test round-trips them.
- **A required essay beside a pick-some set.** Duke, Yale, Boston College, Rice and Oregon list a prompt everyone
  answers and then a set to choose from. `choose.of` now counts the prompts marked optional (the set); a required
  prompt stands outside it. The card line reads "1 essay (250 words); choose 2 of 5 more (250 words)", the fold marks
  each set member "One of 5 to choose from", and the plan's count adds the required ones plus `n`.
- **"None" from the wrong page.** The picker had chosen pages about supplemental instruction, supplemental pay,
  supplemental funds and an essay contest, and the reader called each "no essays". A `none` quote must now say there
  are no essays; a `refers_to_form` quote must name the essay and the application it is part of; a page that only
  says "supplemental" no longer reads like an essay page; those words score zero as links; and the picker is told
  not to choose them. A record that lists no prompts also starts discovery over on the next run instead of being
  reused, so a better page can still be found.
- **The Common App's seven prompts, copied.** Rutgers's and Pace's pages reproduce the Common App's personal essay
  prompts, and the reader recorded them as the college's own. A prompt equal to one of the platforms' prompts in the
  reference file now holds the record, and the reader is told to leave them out.

### The fourth reader (2026-10-29, after the third run merged)
Forty-four colleges landed from the third run (PR #190). Four things it still got wrong, fixed as `READER_VERSION`
2026.10.29.4 for the next run:
- **Half the colleges had no page found.** The ladder's cheap steps started from the apply and admissions links and
  looked only at the links on those pages; the essay link usually sits one level deeper, on the first-year "how to
  apply" page. Discovery now fetches up to three such pages on the college's own hosts (`rankApplyLinks`) for their
  links before the well-known paths, the sitemaps, and the picker.
- **"See the form" from a general page.** Cornell, Dartmouth, Tufts and Boston University publish their supplements,
  but the page read was a general "how to apply" page that mentions the Common App. When the first read lists no
  prompts, the ladder now runs once more past that page; a page that reads as published replaces the first answer
  (the second read costs about two cents, only for those colleges).
- **One read per shared page.** The nine UC campuses share one personal insight questions page; nine reads of it
  disagreed on one question's kind and three campuses were held. A run now reads a page once (by its bytes' hash) and
  answers every college on it from that read.
- **A test's essay section is not an application essay.** "UNF does not require the essay section of the SAT, ACT or
  CLT" had passed as "no essays"; such a quote now holds the record.

### The fifth reader (2026-10-29, after the fourth run merged)
Fifty-three colleges after the fourth run (PR #192). Three more corrections, no change to the model call:
- **Colleges that share a page agree after the run.** The per-run read cache couldn't help the UC campuses: four
  workers hit their shared page at once, before the first read finished, and three campuses were held on a kind the
  model gave one question on some reads and not others. Outcomes are now kept until every worker is done; a held
  college whose page bytes match a passing record's (this run's or a committed one) takes that read with its own
  ids, is re-checked, and passes. The PR lists who took whose read.
- **Transfer and graduate pages are never the page.** The second look took Dartmouth's transfer essays for its
  first-year ones. A URL with a transfer or graduate segment is never fetched, and such links score zero.
- **A hold says when a passing record stays on file.** Held is never merged, and a hold on a re-read can be the
  model's noise, so the earlier passing record is kept; the PR's held table now says so with its date, for the owner
  to judge. Harvard's "see the form" read is a true reading of its checklist page (the five questions live
  elsewhere), so it stays until discovery finds that page.

The third run's data PR then failed CI on the "re-merge changes nothing" tests, the first time real blocks met them:
the college-reported merge re-appends its lineage records last and the tiers build re-inserts `selectivity` right
before `directories`, so `lineage.essays` now sits before the first `reported.*` record and `essays` before
`selectivity`. Both placements are idempotent, and a re-merge or rebuild leaves every college byte for byte.
