# Part 1, The Prompts: What Each College Asks Students to Write

> Status: **planned** 2026-10-28. Part 1 of [essays](README.md). Builds on the college-reported agent
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
reported.essays: {
  cycle: "2026-27";                       // as the page states it; a page with no cycle is held for review
  source_url: string; retrieved: string;
  status: "published" | "none" | "refers_to_form";  // none: the page says there is no supplement; refers_to_form: "see the Common App"
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
Registered in `lib/fields.ts` as `reported.essays.*` (source `college-site`, per-document lineage like every reported
field); the display cites each prompt to its page and date. `status: "none"` is a fact worth showing ("No essays
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
