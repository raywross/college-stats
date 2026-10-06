# Manual Collection: Documents a Person Has to Fetch

> Status: **planned** (not built). Independent; builds on the college-reported engine's review queue
> ([college-reported-data.md](college-reported-data.md)), the campus-life blocked lists
> ([campus-sources-later.md](campus-sources-later.md)), and the high school profile pilot
> ([product/high-school-data.md](product/high-school-data.md#pilot-results-profile-pdfs-2026-10-05)). Revises one
> campus-life access rule (owner decision needed, [Rules](#rules)). Written 2026-10-06 from the Roslyn High School
> case.

## Why
The crawlers obey robots.txt and stop at bot challenges, and they should. That leaves a growing pile of public
documents we know about but can't read by machine:
- **High school profiles.** The pilot located 18 of 100 profiles and could fetch 6. The other 12 sit on hosts whose
  robots.txt disallows crawlers: a school's own document folder (Roslyn's `/fs/`), Google Drive downloads, Edlio and
  Blackbaud file hosts, ParentSquare, Issuu. Every one is a link a school put on its public page for people to open.
- **Campus life.** National chapter directories behind Cloudflare challenges (Alpha Phi, Kappa Alpha Psi), UT Austin's
  Greek-life reports under a robots disallow, directories whose robots.txt itself returns 403 (OCF, oSTEM).
- **Federal and state files.** ed.gov and ED Data Express return a bot check to every script; the graduation-rate
  files only arrived because the owner downloaded them in a browser. Florida's and California's landing pages block
  scripts the same way.
- **College documents.** Common Data Sets on a university's Google Drive, class profiles behind a WAF.

Roslyn showed the route that works: the owner opens the document in a browser, once, and the existing extractor
reads it. That took an hour of a chat session for one school. This spec turns it into a system: an **inventory** of
what needs a person, a **priority and schedule** that gets the most data for the fewest visits and never leans on
one site, and a **browser session** in which an assistant does the clicking while the owner watches.

## What this is and isn't
A person opening a public document their browser was linked to is not a crawler, and robots.txt doesn't govern it.
An assistant working unattended through ten thousand sites with a browser's user agent is a crawler with a
disguise. The design keeps to the first and makes the second impossible by construction:
- the session runs only while the owner is present, in the owner's own browser, in one visible tab;
- it moves at a person's pace, per host and per day ([Schedule](#schedule));
- it opens only documents a public page links for the public; it never signs in, never passes a challenge or
  CAPTCHA, never changes the user agent, never calls a download endpoint the page doesn't offer;
- the inventory records who fetched what, when, from where, and why a machine couldn't;
- it is for hundreds of documents a year, not tens of thousands. The crawler stays the bulk route, and the
  upload path (a student or counselor adds their school's profile; see high-school-data.md's recommendation and
  [counselor-portal.md](product/counselor-portal.md)) is the route to scale.

## Inventory
`data/manual/inventory.json` in git, like every other data file: reviewed in PRs, diffable, the one list every
tool reads. One item per document per subject per edition.

```ts
interface ManualItem {
  id: string;                       // "hs-profile:362505003470:2026-27"
  kind: ManualKind;                 // what extractor reads it (below)
  subject: { type: "high-school" | "college" | "organization" | "state" | "federal"; id: string; name: string };
  edition: string;                  // "2026–27", "Class of 2023", "2024–25"
  current: boolean;                 // the newest edition we expect to exist (history items are false)
  landing: string;                  // the public page that links the document
  document: string | null;         // the document URL once located (null: find it on the landing page)
  host: string;                     // registrable domain of `document` (or `landing`), the pacing key
  blocked: "robots-path" | "robots-host" | "challenge" | "bot-check" | "viewer" | "js-only" | "terms" | "login" | "none";
  blockedDetail: string;            // "robots.txt disallows /fs/", "Cloudflare challenge 2026-10-04"
  reach: number;                    // subjects the document covers: 1 for a profile, ~2,300 for a Texas file
  demand: number;                   // 0–3, from the signals below
  tier: 0 | 1 | 2 | 3;              // computed; see Priority
  after?: string;                   // item id this one waits for (history waits for the subject's current item)
  status: "needed" | "located" | "queued" | "fetched" | "extracted" | "published" | "failed" | "ask" | "skipped";
  route: "browser" | "hand" | "archive" | "ask";
  attempts: { at: string; by: "owner" | "assistant"; outcome: string }[];
  fetched?: { at: string; by: "owner" | "assistant"; route: ManualItem["route"]; file: string; sha256: string; bytes: number };
  outputs?: string[];               // files the extractor wrote: "data/high-schools/detail/362505003470.json"
  notes?: string;
}
type ManualKind = "hs-profile" | "edfacts-acgr" | "state-report" | "cds" | "class-profile" | "campus-page"
  | "org-directory" | "pss" | "ccd";
```

**Where items come from** (`npm run manual-inventory` rebuilds the file; hand edits survive by id):
1. The engines' own blocked records: the college-reported review queue's `unreachable` items, the high school
   pilot's located-but-blocked profiles (`profile-pilot.json`), the campus `blocked.json`, the directories'
   `blocked` entries, and `data/reference/blocked-hosts.json`. Each already carries the URL and the reason.
2. The tables in [campus-sources-later.md](campus-sources-later.md), entered once as `data/manual/requests.json`
   (the owner's standing asks: "the newest EDFacts school file each year", "UT Austin's SFL reports").
3. **Editions we expect**: for every subject with a current document, the builder adds next year's item when the
   publisher's season arrives (profiles each September–November, CDS each winter, EDFacts each spring), and
   **history** items for kinds whose past editions are online ([History](#history)).
4. Demand: a high school a signed-in student has set ([student-profile.md](product/student-profile.md)) or a
   college on a saved list gets an item even when no crawler has tried yet, so the first visit is the person's.

The builder never deletes: an item whose document the crawler can now fetch (robots changed, host unblocked) is
marked `skipped` with the reason, and the crawler takes it back.

## Priority
Get the most current data for the fewest visits, then fill history. Tiers, in order:

| Tier | What | Examples |
|---|---|---|
| **0** | One document that fills a published field for thousands of subjects | The newest EDFacts school file; a state report-card download the adapter can't fetch |
| **1** | Current edition for a subject someone is waiting on: a signed-in student's high school, a college on a saved list or with a follow | Roslyn's 2026–27 profile |
| **2** | Current edition for a subject in a pilot cohort or a top-enrollment subject in a covered state | The 12 located-but-blocked pilot profiles |
| **3** | History: past editions of a subject whose current edition is done, newest year first | Roslyn 2025–26, then 2024–25 |

Within a tier the order is `reach × (1 + demand)`, then enrollment. The score and its inputs print in
`npm run manual-report`, so the owner can see why something is first and move it (`priority` override by id).
History never outranks any current item: a tier-3 item is eligible only when its `after` item is `extracted`,
`published`, or `failed`.

## Schedule
The owner's rule: don't do one school's ten years in a row; do ten schools' current year, then come back for the
next year. The scheduler turns that into **waves**:
1. Take the eligible items in priority order.
2. A wave holds up to **8 items with distinct hosts and distinct subjects**. The first item of each host and subject
   in the queue joins; the rest wait for a later wave.
3. Between waves, a host rests: a host that appeared in the last wave is skipped until **2 minutes** have passed since
   its last fetch. Per host, at most **10 fetches a day**; per session, at most **40 items or 60 minutes**, whichever
   comes first.
4. Platform hosts that serve many schools (`drive.google.com`, `resources.finalsite.net`, `*.files.edl.io`,
   `*.myschoolcdn.com`) count as one host, so a wave never has two Drive downloads.

So a session with twenty schools' current profiles does them across three waves at a person's pace, and their
history years come up only in later sessions, newest first, one year per school per wave. The agent works a wave one
item at a time (one tab), so "parallel" here means interleaved subjects, not simultaneous requests; the pacing is
what matters, and the wave rules enforce it. `npm run manual-next -- --wave 8` prints the next wave and marks its
items `queued`; a session that ends early leaves them `located` again.

## The browser session
A Claude Code skill (`.claude/skills/collect-manual/SKILL.md`) run by the owner, which drives Claude in Chrome (the
owner's own browser; the desktop app's built-in browser pane works the same way). The owner starts it and watches;
nothing runs unattended. Per item:
1. `manual-next` gives the wave. The assistant opens the item's landing page in one tab and finds the document link
   it recorded (or, for `document: null`, the link that matches the kind: "School Profile", "Common Data Set",
   "Chapter locator"). If the page shows a sign-in, a challenge, a CAPTCHA, or a notice that the document is for
   counselors/members, the item becomes `ask` and the assistant moves on. It never types a password or waits out a
   challenge.
2. **PDF or spreadsheet:** the assistant clicks the link; Chrome saves it to `~/Downloads`. `npm run manual-intake --
   --item <id>` finds the newest download whose name or size matches, moves it to `.cache/manual/<id>/`, records
   sha256, size, time, `by: "assistant"`, and the original URL, and runs the kind's extractor. **HTML page** (a
   chapter list, a class profile page): the assistant reads the rendered tab text and passes it with `--text`; the
   same intake records it.
3. The extractor is the one the crawler would have used, given a local file: the high school profile reader
   (`sync-hs-profiles -- --file`), `sync-high-schools -- --edfacts-file`, a state adapter's `--file`, the
   college-reported document reader for a CDS or class profile, the campus pilot's page reader. Each gains a
   from-file entry point where it lacks one, and each writes the usual provenance plus `access: "browser"` (or
   `"hand"`, `"archive"`) so the record says how the document came in. The citation shown to readers is unchanged:
   the school's document, its URL, its date, the quote and page.
4. The item becomes `extracted` (or `failed` with the check that failed, like any crawler run). At the end of the
   session the skill runs `npm run manual-report`, commits data and inventory on `data/manual-<date>`, and opens a
   PR, so every hand-fetched document gets the same review as a crawl.

**Hand drop** is the same intake without the browser step: the owner drags files into `.cache/manual/inbox/` and runs
`manual-intake -- --inbox`, which matches them to items by name (`SY2021_…_SCH.csv` → the EDFacts 2020–21 item).

**Ask** items get an email draft from `npm run manual-ask -- --item <id>` (who we are, what we'd show, the ⓘ
citation, the removal address from [school-identity](school-identity/README.md)), for the owner to send; a reply
with a document goes through hand drop.

## History
History is the user's own point: current first, then fill in. Which kinds have past editions online at all:
- **EDFacts**: one file per school year on ED Data Express; each is a tier-0 item, hand-dropped (the site's bot check
  applies to the whole session, so the browser route is the only one). Graduation history fills `grad_history`
  ([high-school-data.md](product/high-school-data.md#as-built-graduation-rates-and-history-2026-10-05)).
- **State report cards**: states keep prior years' downloads; each adapter already takes a year flag, so a history
  item is "run the adapter for 2023–24" with the file hand-dropped where the state blocks scripts.
- **Common Data Sets**: most colleges keep an archive page; the crawler fetches those where allowed, so manual
  items are only the archives behind Drive or a WAF.
- **High school profiles**: schools replace the PDF each fall and rarely keep old ones. Past editions exist only as
  captures on the Internet Archive. The `archive` route tries `web.archive.org` for the landing page and the
  document for each prior year (one request per year, archive.org's robots.txt and rate limits obeyed; no browser
  needed), cited as "archived copy of the school's profile, captured <date>". Whether captures exist for a typical
  school is unknown until tried: the first history session measures hit rate on the Roslyn-era schools before
  the builder adds archive items broadly ([open question 3](#open-questions)).

## Measurements
Per session and in `manual-report`: items fetched, minutes per item, extraction pass rate, cost (model calls), new
coverage (subjects that now have the field), `ask` and `failed` counts by reason, and hosts touched with their
day's count. Targets to decide after the first three sessions: minutes per item under 3, pass rate over 80%.

## Rules
1. **Owner present, one tab, human pace** (the limits in [Schedule](#schedule) are constants with tests).
2. **Only public links for the public.** No sign-in, no challenge or CAPTCHA, no user-agent change, no endpoint the
   page doesn't link. A page that says the document is for counselors, members, or staff is `ask`.
3. **Terms over robots.** Robots.txt alone, on a document the page links, doesn't stop a person; a site whose terms
   forbid automated access, or whose robots.txt itself is refused, is `ask`. The campus lists already classify these.
4. **Every fetch is recorded** (who, when, route, hash) and every output is reviewed in a PR.
5. **Removal honored**: a school or organization that asks us not to show its document gets it removed and its
   items set to `skipped: "declined"`, permanently.
6. **Revision to campus-life owner decision 1** (`campus-life-2-brief.md`, restated in
   [campus-sources-later.md](campus-sources-later.md): "never fetch a disallowed PDF even by its exact URL"): the
   **crawlers** never do; a **person in a supervised browser session** may, under rules 1–5. Decision 1's other
   halves stand: never bypass a challenge or a login, by any route. **Needs the owner's confirmation before build.**

## Build order
1. **Inventory**: schema, `manual-inventory` builder from the five existing blocked records plus `requests.json`,
   `manual-report`, validator (ids, hosts, statuses, `after` points at a real item), tests. Seeds: the 12 pilot
   profiles, the EDFacts years, the campus-sources-later tables.
2. **Intake and from-file extractors**: `manual-intake` (download matching, hashing, provenance `access`), the
   missing `--file` entry points, tests with fixture documents (Roslyn's profile is the first fixture; its detail
   file must come out byte-identical to the hand-made one).
3. **Scheduler**: tiers, waves, host and subject rules, caps; tests that prove each limit holds (a wave never holds
   two items on one host; a host in the last wave waits; history waits for current).
4. **The skill and the first session**: the 12 pilot profiles plus the EDFacts hand drop; measure.
5. **Ask track**: templates, `manual-ask`, the removal rule.
6. **History**: archive route on the first sessions' schools; add archive items only if the hit rate earns it.

## Files (planned)
`specs/manual-collection.md` (this), `data/manual/{inventory,requests}.json`, `lib/manual-collection.ts` (pure:
schema, tiers, waves, validators), `scripts/manual-{inventory,next,intake,report,ask}.mts`,
`scripts/lib/manual/**` (sources of items, download matching, archive route), `.claude/skills/collect-manual/`,
`tests/manual-collection*.test.mts`, from-file flags in `sync-hs-profiles`, the state adapters, the campus pilot,
and the college-reported reader.

## Open questions
1. **The line** (rule 6): confirm that a supervised browser session may open robots-disallowed documents a public
   page links, while crawlers never do. Recommendation: yes, with the limits above as code, not guidance.
2. **Pace constants**: 8 per wave, 2 minutes per host, 10 per host per day, 40 per session. Recommendation: start
   there; the report shows hosts' daily counts so they can be tuned.
3. **Archive route for profile history**: build after measuring capture hit rate on 20 schools; if under 30%, history
   for profiles waits for the upload path (families often keep old profiles) instead.
4. **Say so on the site?** Readers see the same citation either way. Recommendation: one sentence on `/data`
   ("some documents were opened by hand where sites block automated reading"), nothing per value.
