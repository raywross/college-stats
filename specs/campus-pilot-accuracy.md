# Campus Life: Reading Colleges' Own Pages Accurately Enough to Run Everywhere

> Status: **deferred** 2026-10-04 (owner: "I'll come back to it later"). What has to change in the campus-life
> pilot (`scripts/lib/campus-pilot/`, [college-reported-data.md](college-reported-data.md#campus-life-pilot-as-built-2026-10-04))
> before a full run over every college, based on three scored rounds of 25 colleges each. Companion to
> [religious-life.md](religious-life.md), [greek-life.md](greek-life.md), [lgbtq-life.md](lgbtq-life.md), and
> [campus-sources-later.md](campus-sources-later.md) (sources we can't read at all).

## Where things stand
Three rounds ran on 75 different colleges (2026-10-04), each scored against a hand-checked answer key (keys kept out
of the public repo: they hold page text beyond the short quotes we publish). Only fact types right about 95% of the
time are published; the rest are in `HELD_BACK` (`scripts/lib/campus-pilot/merge.mts`), kept in
`data/campus-pages.json` for re-scoring.

| Round | Colleges | Cost a college | Full run (1,890) |
|---|---|---|---|
| 1 | 19 of 25 (cap) | $0.61 | ~$1,150 |
| 2 | 23 of 25 | $0.31 | ~$590 |
| 3 | 25 of 25 | $0.16 | ~$300 |

**Precision across all three rounds** (published facts that matched the key, after reading every miss; misses that
were gaps in the key are counted as right):

| Fact type | Right | Status | What went wrong |
|---|---|---|---|
| Greek life present / none stated | 25 / 25 | Published | — |
| Councils' chapter counts | 46 / 47 | Published | — |
| Gender-inclusive housing, chosen name, restrooms | 4/4, 8/8, 10/10 | Published | Recall is low (13–27%) |
| Conduct restriction (quoted) | 1 / 1 | Published | Too few to judge |
| Nondiscrimination: orientation / identity | 21/23, 20/22 | **Held** (round 3) | A short notice read as the whole policy ("no" at TCU, confirmed by the second check); a replaced list read as covering both (FAMU) |
| LGBTQ+ center (from college pages) | 12 / 15 | **Held** (round 3) | General diversity or inclusion offices read as LGBTQ+ centers (Davidson, Furman, Villanova) |
| Members by council | 1 / 5 | **Held** (round 3) | Wrong column or row read from report tables (Rutgers) |
| Greek total members | 6 / 8 | Held | One council's page read as the whole community; old figures |
| Greek housing | 6 / 9 | Held | A housing rule read as housing being offered or not |
| Deferred recruitment / formal term | 8/9, 11/13 | Held | Round 1's housing rule read as recruitment; right in rounds 2–3 |
| Faith office | 20 / 22 | Held | Non-faith centers read as one (UNC's Campus Y; FSU's student Interfaith Council) |
| Faith groups by tradition | 72 / 80 | Held | Groups assigned to the wrong tradition or not actually at the college |
| LGBTQ+ student groups | 7 / 11 | Held | Groups named in news or events, not the college's group list |
| Organization estimates | 0 / 1 | Held | A 2016 figure published although estimates expire |
| Health plan covers transition care | 0 / 1 | Held | A plan's general coverage read as covering transition care |

**Recall is low everywhere** (4–55% by type): the pipeline finds the right page far less often than a careful reader.

## Fixes, by problem
1. **Nondiscrimination: read the policy, not the notice.** Prefer the page titled as the policy (or the policy
   library entry) over footers and short notices; record the policy's own revision date; when a page says it was
   edited "to comply with law" or lists "any legally protected status", answer *not stated*, never yes. A "no" needs
   the full policy's protected-category list as its quote, and the second check must be shown both the notice and
   the policy and asked whether they agree. A wrong "no" is the costliest error this section can make.
2. **LGBTQ+ center: a stricter definition.** Count an office only when its own name or mission names LGBTQ+, gender
   and sexuality, or queer and trans students, or it has staff whose title does. A multicultural, diversity, or
   inclusion office that serves LGBTQ+ students among others becomes a separate, lower-key fact ("LGBTQ+ programs in
   the inclusion office"), if the owner wants it shown at all.
3. **Membership tables: parse, don't read.** Report PDFs and tables (chapter size, community, grade reports) get a
   deterministic table reader for the common layouts (chapter rows, council subtotals, "total members" / "initiated"
   / "new members" columns) with checks: council totals equal the sum of their chapters, the community total equals
   the sum of councils, and a figure's label must say members. The model only picks which table and term.
4. **Faith office and groups.** An office counts only if it's the college's chaplaincy, religious or spiritual life
   office (or a named campus minister's office); student councils and social-justice centers don't. Groups come
   only from the college's own registered-group list or the office's list, with the tradition taken from the
   group's own words.
5. **Greek housing, total members.** Housing needs a sentence about chapter houses or Greek housing being offered;
   "first-years live in residence halls" is not it. Total members must be the whole community, dated within two
   years.
6. **Recall.** Sitemaps, the college's own site search, and well-known paths already find 55–60% of pages for free;
   add the office pages' own link lists (one level down), and log which page types the probes miss most, by college
   type, to target the paid search.

## How to measure, and when a held type can be published
- **Re-run the 75 scored colleges** with `--rediscover` after the fixes (about $12 at round 3's cost) and score each
  against its own round's key. Also add a fourth round of 25 new colleges with a fresh key, so the fixes aren't tuned
  to the colleges they were measured on.
- **Proposed rule (owner to confirm):** a type is published when it reaches ≥95% precision **and** at least 20
  scored findings across rounds. Today several types are right in every round but have only 3–9 findings.
- **"No" answers** (nondiscrimination, policies) need ≥98% and at least 10 scored "no" findings, because a wrong "no"
  misstates a college's policy on a sensitive subject.

## Full run
After the fixes and a passing re-score: one run over all colleges, about **$300** at round 3's cost (more if the
table reader or stricter checks add calls), capped and run in Actions like the pilot. It publishes only the types
that passed; everything else stays in `data/campus-pages.json` for the next re-score. Refresh yearly, re-reading only
pages that changed.

## Open questions for the owner
1. The publishing rule: 95% and at least 20 findings? And the stricter bar for "no" answers?
2. Show "LGBTQ+ programs in the inclusion office" as its own fact, or only true LGBTQ+ centers?
3. Budget for the re-score (~$12), a fourth round with a new key (~$4 plus the key's effort), and the full run (~$300).
4. Hand-checked keys take an agent about 1–2 hours per 25 colleges. Keep building one per round, or switch to
   spot-checking a sample of each run once the types stabilize?
