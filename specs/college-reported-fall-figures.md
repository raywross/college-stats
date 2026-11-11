# Fall figures before the CDS

> Written 2026-11-11 after the owner saw an Instagram post with UT Austin's Fall 2026 numbers (98,841 applicants,
> up 9%; 9,487 freshmen) while the site showed Fall 2025. Part of [college-reported-data.md](college-reported-data.md);
> changes the rules in [college-reported-round-3.md](college-reported-round-3.md) Decisions 6, 7 and 10. Owner
> decisions taken 2026-11-11 (end of this page); build started the same day on `feature/fall-figures`.
> Status: **planned**

## The question
A college's Common Data Set arrives six to twelve months after the class enrolls. Before that, many colleges publish
the same numbers themselves, in whatever form suits their news office: a March release with applicants and admits, a
September release with the enrolled count, a PDF "year in review", a fact page, a counselor newsletter. The owner is
happy to carry these early, non-standard figures. This page measures how much they would add across all 1,893
colleges, explains why today's pipeline misses most of them, and specifies the change.

## What the store holds today (dev, 2026-11-11)

Survey of `reported.sources` (the recipes) and `reported.entries` (what each college publishes), joined to snapshot 9's
selectivity tiers. Script kept out of the repo; the numbers are the point.

| | Count |
|---|---|
| Recipes (one per college) | 1,893 |
| Recipes with a CDS source | 626 |
| Recipes with a class-profile source | 627 (717 sources) |
| Colleges with a college-reported admissions funnel | 245 (198 from a CDS, 52 from a class profile) |
| … whose entering term is Fall 2026 | **23** |
| … whose entering term is Fall 2025 | 222 |

The 717 class-profile sources, by what reading them produced:

| Outcome | Sources | Why |
|---|---|---|
| Figures extracted | 119 | Working as designed |
| Read, no figures | 406 | Wrong page (a law-school profile, an Instagram account, a visit page, a majors list), a page with score ranges but no counts, or a page whose numbers are rendered by script (UGA's admissions-stats page: the model found "Fall 2026" and nothing else) |
| Never read | 192 | The fetch never succeeded; `host_blocked` is the third most common failure code (169 colleges) |

The three selective tiers, where a year-ahead figure changes what a family sees:

| Tier | Colleges | Fall 2026 funnel today | No class-profile source | Evergreen page, still Fall 2025 or empty | Dated URL from a past year |
|---|---|---|---|---|---|
| Elite | 29 | 4 | 11 | 9 | 3 |
| Highly selective | 45 | 5 | 14 | 19 | 4 |
| Very selective | 119 | 10 | 47 | 59 | 2 |
| **All three** | **193** | **19** | **72** | **87** | **9** |
| Selective (the fourth tier) | 328 | 3 | 160 | 152 | 10 |

Frozen dated URLs across all tiers: 32 (UT Austin's 2025 release, Michigan's "record applications for fall 2025"
article, Vanderbilt's Class of 2029 post, Columbia's Class of 2029 PDF, NYU's March 2025 release, Swarthmore's
"admits 965 to Class of 2029", Binghamton's record-applications story, Loyola's "welcomes Class of 2029"). Each was
right when discovery found it and will never be right again.

## What colleges actually publish, and when

A web check of 32 colleges on 2026-11-11 (search results only, pages not opened, so every figure below is as the
search summary reported it; the first build verifies on the pages). The 32 were chosen from the 174 selective-tier
colleges without a Fall 2026 funnel, plus four from lower tiers.

**20 of 32 had at least one first-year count for Fall 2026 on an official page.** Only three had the whole funnel
from the college itself (USC's profile PDF, Georgia Tech's year-in-review PDF, Boston University's "Snapshot: Class
of 2030"). The rest had pieces, and the pieces arrive on a calendar:

| When | What | Who, in the sample |
|---|---|---|
| Dec–Feb | Early-round admits; sometimes total applicants ("most applications ever") | Johns Hopkins (553 ED I, 260 ED II), Rice (447 ED I), Tufts (36,000+ applicants, Jan 22), Michigan (115,125 applicants, Feb) |
| Mar–Apr | Regular-decision release: applicants, admitted, often the rate | Yale (54,919 / 2,328), UVA (82,118 / 10,287), Cornell (5,776 admitted), Tufts ("about 10%") |
| Jun | University-system fact sheets: every campus's applicants and offers in one table | University of California (all nine campuses in one PDF; UCSD and UCI have nothing of their own) |
| Jul | Deposits ("record first-year deposits") | Temple (6,682), Clemson (66,494 applicants as of July 28) |
| Aug–Oct | Census or move-in release: the enrolled count, sometimes applicants again | UT Austin, Purdue (82,000+ applicants, 10,818 freshmen), WashU (33,221 / 12.2% / 1,942), Ohio State (8,585), Boston University (3,714), Rice ("largest ever"), Princeton and UNC (releases with no counts at all) |
| Feb–Aug next year | The Common Data Set, with the full funnel | Everyone who publishes one |

Forms seen: news release (most), class-profile page, PDF profile, PDF year-in-review, fact page, counselor
newsletter (Ohio State), provost enrollment update (Arizona), system fact sheet (UC). Twelve had nothing official:
Florida, Pittsburgh, Penn State, Northeastern, Texas A&M, NYU, Miami (page still shows Class of 2029), Washington
(a three-campus total only), Alabama (total enrollment only), and the Harvard figures came from Harvard Magazine
and the Crimson, not the admissions office.

Three kinds of number that look like the funnel and are not:
- **Rounded** ("more than 82,000", "about 10%", "nearly 109,000").
- **Targets** (Georgia Tech's "class goal of 4,100", UVA's "target class 3,988") and **deposits** (Temple), which are
  not the enrolled count.
- **Multi-campus totals** (Washington's 12,552 across three campuses, Penn State's system-wide applications).

And third-party sites disagree with each other and with the college (USC: 10,006 admitted on the profile PDF,
9,251 in a USC Today article; Harvard's admit count only on a consultancy's page). The pilot's finding stands:
aggregators recirculate old data under new labels.

## Why the pipeline misses them

Round 3's rules were written for the CDS, one document per edition, posted to a stable index page. Fall figures
break every assumption:

1. **One class-profile URL per recipe, found once.** Decision 10: discovery is "never redone for a college whose
   index page works". A dated article URL is checked weekly, returns 304, and the next year's article at a new URL
   is never looked for. This is the UT Austin case, and the 32 frozen URLs.
2. **The calendar is wrong for the spring releases.** Class-profile pages are checked weekly only Aug–Nov; Dec–Jul is
   monthly, for CDS editions. The March admit releases and the June UC sheet fall in the monthly window and are new
   URLs anyway, so nothing finds them.
3. **The extractor wants one page with "appl" on it.** `profileInput` returns nothing, without a model call, when
   the anchor is absent, and it reads one page per college. A funnel assembled from a March release (applicants,
   admitted) and a September release (enrolled) has no single page to read.
4. **The picker takes the first profile-shaped link.** Law-school and MBA class profiles, Instagram, visit pages
   and majors lists are 67 of the 717 sources. These cost a read each and yield nothing.
5. **Rounded figures fail check #2** (the number must appear in the quote) or, worse, pass as exact.
6. **Blocked hosts** stop 169 colleges before any of this applies. Out of scope here; the round-3 browser-fetch
   question stands.

## Decisions

### Decision 1: a college's fall figures are a set of notices, not one document
A new recipe source kind, `notice`: one dated page (HTML or PDF) that states one or more first-year figures for a
named entering term. A recipe may hold many notices, across years. The existing `class-profile` kind stays for
evergreen pages (Harvard's admissions-statistics page, Purdue's class-profile page, Brown's); a class-profile source
whose URL names a year or a class ("2025", "class-of-2029", "class-2030") is reclassified as a notice of that term
on the first run.

Each notice records `url`, `term` ("Fall 2026"), `published` (from the page or the URL), `form` (`release`, `profile`,
`pdf`, `fact-page`, `newsletter`, `system-sheet`), `sha256`, and an `extraction` with the fields below.

### Decision 2: figures combine by term, each with its own citation
`reported.admissions` for a term is assembled from every source that names that term: a CDS first (it wins outright
when present, as today), else the notices and class profile. Each of `applicants`, `admitted`, `enrolled` comes from
the newest notice that states it, with that notice's quote and URL as the field's lineage, so the admissions page can
show "82,118 applied (March release) · 10,287 admitted (March release) · enrolled: not yet published". Round 2
Decision 1 (the newest figures are the headline, partial funnels show row by row) already handles the display.

`acceptance_rate` is computed only when applicants and admitted are both exact and from the same college. A stated
rate without counts is kept as `rate_stated` and shown as the college's own words, not as a computed value.

### Decision 3: exact, approximate, target, deposit, system
The extraction schema gains a qualifier per figure:

| Qualifier | Example | Stored as | Shown as |
|---|---|---|---|
| `exact` | "82,118 applications" | the value | 82,118 |
| `approx` | "more than 82,000", "nearly 109,000", "about 10%" | the value with `approx: true` | "82,000+" / "about 10%" on the funnel, with its sign; never an exact rate from it |
| `target` | "class goal of 4,100", "target class of 3,988" | `enrollment_target`, never `enrolled` | A labeled row under the funnel: "Class goal: about 4,100" |
| `deposits` | "6,682 first-year deposits" | `deposits`, a separate field | A labeled row: "6,682 deposits (July)"; replaced by the census count when published |
| `multi-campus` | "12,552 new students across three campuses" | rejected: scope check fails | nothing |

**Only exact counts feed the selectivity tier** (owner, 2026-11-11). The tier and its in-state and out-of-state
variants are computed from a term's funnel only when every count they use is exact (a CDS, federal data, or exact
notice figures); an approximate applicant count shows on the page but leaves the tier on the last exact term.
Targets and deposits never enter any computation.

Check #2 (the number appears in the quote) applies to the stated number ("82,000" must be in the quote); the
qualifier is the model's call and is itself a reviewed item: a run where `approx` exceeds 40% of extracted figures
goes to review.

### Decision 4: a season calendar replaces the Aug–Nov window
Three seasons, each a discovery pass for the colleges in scope (Decision 6):

| Season | Looks for | Runs |
|---|---|---|
| **Admits** (Mar 15–May 15) | Regular-decision releases: applicants, admitted, rate; early-round posts fill `admission_profile.early_decision` as a side effect | Weekly |
| **Systems** (Jun 1–Jul 31) | System-office fact sheets (UC first; CSU, SUNY, Texas, Florida checked once and listed if they publish one) and deposit releases | Every two weeks |
| **Census** (Aug 15–Nov 15) | Enrollment and move-in releases: enrolled, often applicants again | Weekly |

Outside a season nothing changes: known notices are not re-fetched (a release doesn't change), evergreen class
profiles keep their monthly conditional GET, the CDS calendar is untouched.

### Decision 5: finding a notice is cheap and bounded
A season pass for one college, cheapest first, stopping at the first notice found for the season's term:

0. **Index scan, no model.** The recipe's `news-index` pages (Decision 7) and any known notice's parent listing,
   fetched with a conditional GET; links whose text matches the season's patterns (`record … applications`,
   `class of 2030`, `first-year class`, `welcomes`, `enrolls`, `admits`, `offers of admission`, `fall 2026`) are
   candidates. Free.
1. **Search-only step** (round 3's step 3, Sonnet with two searches, no fetch, ~$0.05–0.08): the query names the
   college, the term and the figure; results on the college's own hosts only (the Scorecard website's domain and the
   recipe's hosts; the news office is often a subdomain, `news.`, `today.`, `now.`, `source.`). Student newspapers
   and magazines are excluded by host list (Decision 9).
2. **Read** (Haiku, batch where the season allows, ~$0.005): the candidate's text, windowed around the term rather
   than around "appl"; a page without the term in its text is recorded `no_term` without a model call. Output per
   Decision 3.

Budget per season: `$0.10 × colleges in scope`, so about $50 for the top four tiers; ~$150 a year, plus the first
catch-up (the census season is on now).

### Decision 6: scope by tier, where the figures exist
The pilot's answer key and this check agree: selectivity predicts whether a college publishes anything. Seasons run
for the **top four tiers** (elite, highly selective, very selective, selective: 521 colleges). Accessible and open
colleges get no season passes; their class-profile sources and CDS editions continue as today. A college in a lower
tier whose news index is already known (Decision 7) is scanned at step 0 only, free.

### Decision 7: the news index as a recipe source
When a notice is found, its listing page is recorded as a `news-index` source: the news office's admissions tag or
search page (`news.utexas.edu/tag/admissions`, `news.virginia.edu/topic/admission`), or the office home when there is
no tag. Step 0 of every later season reads the index first, so a college that publishes the same way every year
costs nothing after the first find. "Changed" means the set of candidate links changed, as for CDS index pages.

### Decision 8: when the CDS arrives
The term's CDS replaces its notices' figures (today's check #7: agreement within 1% or review). The notices stay in
the recipe and the archive; their lineage records stay on the history rows they produced. The accuracy report
(college-reported-data.md "Self-measurement") gains a second comparison: notice figures against the CDS for the same
term, by qualifier, so we learn whether "more than 82,000" means 82,0xx or 84,000.

### Decision 9: what is never a source
- Student newspapers (the Crimson, the Cornell Sun, the Cavalier Daily, the Huntington News) and third-party sites,
  however exact their numbers look. A publication the university itself runs (Harvard Magazine, the Gazette, a
  provost's update, a counselor newsletter) is a source (owner, 2026-11-11), cited as that publication.
- A figure for a different cohort (transfers, all undergraduates, a system total) or for a class the page does not
  name.
- A figure from a page whose host is not the college's: the UC fact sheet is the one exception, taken as a
  `system-sheet` whose rows are each campus's own figures, cited to the system office.

### Decision 10: round-3 rules amended
- Decision 10 "never redone: discovery for a college whose index page works" now reads "…for its CDS index page";
  notice discovery runs by season.
- Decision 7's back-off applies per season: a college whose pass found nothing waits for the next season, not next
  February.
- The schedule table in college-reported-data.md replaces "Aug–Nov weekly, fall class profiles" with the three
  seasons.

## What it would add
By this check, a build run today would give roughly 60% of the 193 top-three-tier colleges a Fall 2026 figure
(19 have one now), most often applicants and enrolled, with the admit count following in March for the colleges that
announce it. For families that is the number the post was about: applications at UT Austin were up 9% before anyone
saw the CDS. On the site it feeds the admissions page headline (round 2 Decision 1), the selectivity direction line,
and later [cycle watch](ideas/cycle-watch.md), which needs exactly this: what changed for the coming cycle before the
federal year arrives.

## Build order
1. **Schema and display**: `notice` and `news-index` source kinds, the qualifier, `combine by term`, `rate_stated`,
   lineage per figure; `lib/newest.ts` shows approximate values with their sign. Tests on the combine rule and the
   qualifier display.
2. **Census catch-up**: one pass over the 521 colleges for Fall 2026 (steps 0–2), the reclassification of dated
   class-profile URLs, and the UT Austin recipe as the worked example. Measured: colleges with any Fall 2026 figure
   before and after; cost.
3. **Seasons**: the calendar in the pipeline's schedule, the per-season back-off, the news-index scan.
4. **System sheets**: UC; the other systems checked once.
5. **Accuracy**: the notice-vs-CDS comparison when the 2026–27 editions land (spring 2027).

## Owner decisions (2026-11-11)
1. **Scope: the top four tiers** (521 colleges, ~$150 a year).
2. **Approximate figures show** on the profile ("82,000+ applied"); only exact counts feed the selectivity ranking
   (Decision 3).
3. **Targets and deposits are shown, with their label**, never as the enrolled count (Decision 3).
4. **Any publication the university runs is a source** (Decision 9); student newspapers and third parties still are
   not.
5. **Run the census catch-up now**, in the build, so Fall 2026 shows this cycle.
