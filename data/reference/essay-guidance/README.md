# The essay guidance corpus

What the essay reviewer reads with every draft (`specs/product/essays/reviewer.md`, "The guidance corpus"): public
advice on writing college essays, kept as short cited excerpts, and our synthesis of it.

| File | What it is | Who writes it |
|---|---|---|
| `sources.json` | One entry per public page: organization, title, url, the date we read it, its half (`craft` or `approach`), the topics it speaks to, and its excerpts. `refused` lists the pages that robots.txt closed, that refused the crawler, or that have no readable text without a browser. | `npm run research-essay-guidance` |
| `guidance.md` | The synthesis: one section per note category (`## mechanics` … `## interest`) and one per question of approach (`## approach: …`). The reviewer loads sections by these headings (`lib/essays/guidance.ts`), so they are a contract: rename one only together with that file. | By hand, from the excerpts; the owner reviews every change |

## Refreshing it

```
npm run research-essay-guidance              # read every page again, rewrite sources.json
npm run research-essay-guidance -- --dry-run # read and report, write nothing
npm run research-essay-guidance -- --only unc-fragments-run-ons,mit-essays   # some pages; the rest are kept
```

The source list lives in `scripts/research-essay-guidance.mts` (`SOURCES`). Each source names the page and a few
phrases (`pick`) that choose which of its sentences to keep; the script keeps the whole sentences that contain them, in
page order. A phrase that is no longer on the page is printed as `! not on the page`, and a page with none left is
listed under `refused` with its earlier excerpts kept, so a changed page shows up in the run's output and in the diff.
Each page's text is saved under `.cache/essay-guidance/text/` (git-ignored) so a reviewer can read what an excerpt
came from.

After a refresh, read the diff of `sources.json`, then check `guidance.md` still says what its sources say. A change to
`guidance.md` changes what the reviewer tells students, so it goes to the owner and bumps `REVIEW_METHOD`.

## The rules

- **Public, institutional, nonprofit sources only**: university writing centers, admissions offices, the application
  platforms (Common App, the Coalition), NACAC. No commercial essay-coaching sites. No student essays: a page that
  quotes one is kept only for the office's own advice, and the picks avoid the quoted essay.
- **The crawler is polite**: every page goes through `PoliteHttp` (`scripts/lib/college-reported/http.mts`) with the
  honest user agent, robots.txt honored, one request a second per host, and no retry past a refusal. A page that
  refuses us is recorded, never fetched another way.
- **Fair use**: at most 300 words of excerpts per source, each an exact sentence from the page, cited by organization
  and url with the date we read it. Purdue OWL's pages state their own fair-use terms; the excerpts follow them as
  short, attributed quotations.
- **The synthesis**: every paragraph of `guidance.md` cites at least one url in `sources.json`; no paragraph quotes more
  than one sentence of any source; where sources disagree, the paragraph says so and the reviewer asks instead of
  advising.

`tests/essay-guidance.test.mts` checks all of these on every `npm test`: the sources' fields and word limits, the
headings, every paragraph's citations, the quotation rule, and the excerpt picker.
