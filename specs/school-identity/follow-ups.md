# Identity Follow-ups: A Monthly Refresh, Older Icon Formats, and the Visit-Page Picker Run

> Status: **deferred** 2026-10-04: the visit-page picker run waits for the owner. The monthly refresh and the older
> icon formats are built (sections 1 and 2). Part of the [identity family](README.md); written after the four specs
> were built, from the three optional follow-ups the build left.

## Why
The identity build (links, social accounts, short names, colors and marks) ships with every value in a committed file,
refreshed by hand (`sync-wikidata`, `probe-sites`, `sync-brand`). Three things were left open: nothing refreshes them on
a schedule; 42 colleges have an icon the decoder couldn't read; and 492 colleges have no visit page because their
admissions page doesn't name one plainly enough for the scorer.

## 1. The monthly refresh (built 2026-10-04)
**Problem.** Social handles, visit pages, colors, and icons change; links break. A link becomes null only after two
probe runs a day or more apart both find it gone, so the probe has to run again for that rule to ever act.

**Design.** A new workflow, `.github/workflows/identity-refresh.yml`, separate from the college-reported workflow (which
auto-merges and expects only college-reported data changes):
- **When**: checks daily at 06:00 UTC and proceeds only when due, meaning the newest probe in `data/site-probe.json` is
  at least 28 days old, and when no college-reported data PR is open (both write `data/schools.json`, and the second
  PR would conflict). Also runs by hand (`workflow_dispatch`), with a `force` input that skips the due check.
- **What**: `npm run sync-wikidata`, `npm run probe-sites`, `npm run sync-brand`, each ending in `merge-identity`. No
  secrets beyond the repository token; Wikipedia and Wikidata responses are cached between runs.
- **Then**: when `data/` or `public/brand/` changed, a branch `data/identity-refresh-<date>`, a PR with a generated
  summary (visit pages, accounts, colors, and marks gained and lost; links that failed and that became null) and its own
  release note, and auto-merge when CI passes, like the college-reported data PRs. The same guards apply as for any
  data change: lineage, the alias table's invariants, and every mark having its file.

## 2. Older icon formats (built 2026-10-04)
**Problem.** The icon step read ICO entries that are PNG or 32-bit BMP and skipped the rest, so 42 colleges whose only
icon was an older ICO got no mark.

**Design.** Decode the remaining BMP depths ICO files use: 24-bit (no alpha: transparency from the AND mask), and 8-, 4-,
and 1-bit palette entries (colors from the palette, transparency from the mask). The size, ink, and shared-image rules
are unchanged, so a 16 px favicon is still rejected. Then re-run the icon step for the colleges that had an unreadable
ICO.

## 3. The visit-page picker run (deferred)
**Problem.** 492 colleges have neither a visit page nor a virtual tour: their admissions page links to one with wording
the scorer doesn't recognize, or not at all.

**Design.** Already built and tested behind a flag (links.md, "As built: the probe"): the admissions page's links go to
Haiku, which answers with one URL or "none". What's left:
1. Before the first run, make the probe keep a picker find while its page still answers: today a monthly re-probe
   without `--picker` would replace it with the scorer's miss.
2. One run over the colleges without a visit page: `npm run probe-sites -- --picker` (only colleges without a visit
   page), capped at about $2. *Estimate:* $0.003 a college, about $1.50.
3. Look at a sample of its picks before they publish; a wrong pick is worse than none.

**Why deferred.** It's the one paid step. The owner runs it when ready.
