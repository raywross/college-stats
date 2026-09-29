# National Trends: How College Is Changing

> Status: **planned** (not built). Opened 2026-09-29 with one study; more will be added. Uses the year-by-year history
> already on the site ([how history is built](trends-data.md)).

## Why
Every page on the site so far answers a question about **one college**: what it costs, who gets in, how that changed.
Many of the most interesting questions are about **the whole landscape**: *Is it getting harder to get in everywhere, or
only at a few colleges? Are men and women treated differently in admissions, and is that changing? Is it a regional
story, a public-versus-private story, or a small-college story?*

The site already has the data to answer these: 20+ years of federal history for about 1,900 four-year colleges. This spec
sets out how a **trend study** works, where studies appear on the site, and the rules that keep them honest. Each study
is a small, self-contained section below. New ideas get added as new studies.

## What a study is
One question about the landscape, answered in the same shape every time:

| Part | What it is |
|---|---|
| **The question** | Plain language, e.g. "Are colleges admitting men and women at different rates, and is it changing?" |
| **The national picture** | One number and one line over time, across all colleges that report the measure |
| **Breakdowns** | The same measure split by the site's standard groups (below), so readers can see *where* a change is happening |
| **Takeaway** | Two or three sentences a reader can repeat, with the caveats that matter |
| **Method note** | Which colleges, which years, weighted or not, and why |
| **Links** | To Explore, sorted or filtered to the colleges driving the pattern |

### Standard breakdowns
Every study offers the same four, so readers learn one way of reading them:

| Breakdown | Groups | Notes |
|---|---|---|
| **Region** | Northeast, Southeast, Midwest, Southwest, West | The site's regions (`location.region`). Territories are shown only when 30+ colleges report. |
| **Public or private** | Public, private nonprofit | Private for-profit only when 30+ report (rarely). |
| **Size** | Under 2,000 · 2,000–9,999 · 10,000+ undergraduates | |
| **Selectivity** | Under 25% admitted · 25–59% · 60% or more | Only for admissions studies, and only for colleges that report a rate. |

A study can add its own grouping when the question needs it (for example, test policy for a testing study).

## Rules
1. **Fixed panel for "then vs now."** Compare the same colleges at both ends, so a change isn't just colleges entering or
   leaving the data. The panel and its size are always stated.
2. **Say whether it's colleges or students.** "Share of colleges" (each college counts once) answers "how common is
   this?"; enrollment-weighted figures answer "how many students does this affect?" Each study picks one per chart and
   labels it.
3. **Groups use today's classification** unless the study says otherwise (a college that grew past 10,000 counts as
   10,000+ throughout). The method note says so, because it can matter.
4. **At least 30 colleges per group**, or the group shows "too few colleges to say."
5. **Patterns, not causes.** Breakdowns show *where* something changed, not *why*. "Drivers" means "where the change is
   concentrated," and the copy never implies a cause the data can't show.
6. **Definition changes break the line** (the SAT redesign in fall 2017, and the pandemic shading), as on college pages.
7. **Every number is cited** with its source and years, like the rest of the site ([data lineage](data-lineage.md)).
   The universe is the site's four-year colleges, not all of U.S. higher education, and the page says so.
8. **Precomputed and checked.** Studies are computed by `npm run sync-history` (like the Home facts in
   `data/history/facts.json`), so pages stay static, and a test recomputes each one from the committed history.

## Where it appears
- **A new "Trends" page** (`/trends`), linked from the main navigation and from the phone's More menu. One card per
  study, newest first; each opens to the full study.
- **Study pages** (`/trends/{study}`): the national chart, a small chart per breakdown group side by side (same scale,
  so they compare at a glance), the takeaway, and the method note.
- **Home "What's changed"** can feature one study's headline number when it's striking, linking to the study.
- **College pages** can link to a relevant study ("How does this compare nationally?") where the college's own chart
  sits, e.g. the "Acceptance rate, men and women" chart links to Study 1.

## Studies

### Study 1: Men and women in admissions
**Question.** Are colleges admitting men and women at different rates, and is that changing? Where is the change
concentrated: particular regions, public or private colleges, small or large, more or less selective?

**Why it's interesting.** Nationally, women make up most undergraduates, and at most colleges women are admitted at a
higher rate than men. The share of colleges admitting *men* at a notably higher rate has halved in 20 years, and the
change isn't spread evenly.

**Data.** Acceptance rates by sex from the IPEDS admissions survey, fall 2001 on (history series `admit_rate_men` and
`admit_rate_women`; see the [admissions detail spec](data-expansion/admissions-detail.md)). "Notably higher" means a gap of
3 or more percentage points, the same bar the college pages use.

**First look (computed 2026-09-29).** Fixed panel: 912 colleges reporting both rates, with 1,000+ applicants, in fall 2004
and fall 2024. Groups by today's region, type, size, and selectivity. Share of colleges, not students.

| Group | Colleges | Admit men 3+ pts higher | Admit women 3+ pts higher | Median gap, men − women (pts) |
|---|---|---|---|---|
| **All** | 912 | 13% → 6% | 43% → 48% | −2.3 → −2.8 |
| Northeast | 289 | 17% → 5% | 41% → 56% | −2.2 → −3.5 |
| Southeast | 223 | 16% → 7% | 33% → 42% | −1.0 → −2.2 |
| Midwest | 221 | 10% → 5% | 53% → 53% | −3.2 → −3.4 |
| West | 113 | 4% → 6% | 54% → 39% | −3.3 → −1.9 |
| Southwest | 51 | 14% → 4% | 43% → 45% | −2.8 → −2.3 |
| Private nonprofit | 506 | 15% → 8% | 44% → 50% | −2.4 → −3.0 |
| Public | 405 | 11% → 3% | 41% → 46% | −2.1 → −2.5 |
| Under 2,000 undergrads | 275 | 12% → 6% | 51% → 57% | −3.3 → −4.0 |
| 2,000–9,999 | 443 | 16% → 7% | 38% → 43% | −1.6 → −2.2 |
| 10,000+ | 194 | 9% → 4% | 44% → 48% | −2.5 → −2.6 |
| Under 25% admitted | 75 | 23% → 9% | 25% → 19% | −0.5 → −0.1 |
| 25–59% admitted | 150 | 17% → 15% | 38% → 59% | −1.2 → −4.2 |
| 60% or more | 687 | 11% → 4% | 46% → 49% | −2.6 → −2.9 |

What stands out, to confirm before publishing:
- **The Northeast drives the national shift.** Colleges there admitting women at a notably higher rate went from 41% to
  56%, while those favoring men fell from 17% to 5%.
- **The West moved the other way.** Fewer Western colleges admit women at a notably higher rate than 20 years ago (54% →
  39%).
- **Moderately selective colleges changed most.** Among colleges admitting 25–59% of applicants, the share admitting
  women at a notably higher rate rose from 38% to 59%. The most selective colleges show almost no gap either way.
- Public and private colleges moved in the same direction by similar amounts.

**To build.**
- National line: the share of colleges admitting men / women at a notably higher rate, each fall from 2001 (fixed
  panel), plus the median gap.
- Small charts for each breakdown group, same scale.
- An enrollment-weighted companion: "of all applicants, men were admitted at X%, women at Y%."
- Link to Explore sorted by the admit-rate gap (`sortBy=admit_gap`).

**Data work needed.** History stores the two rates but not applicants by sex, so the panel uses a 1,000-total-applicant
floor instead of the college pages' 200-per-sex rule. Add `applicants_men` and `applicants_women` series (the columns
are already read) so the study can use the same rule and weight by applicants.

**Open questions.**
1. Is the West's reversal real or a panel artifact (the West has the fewest colleges in the panel)? Check with the
   fall 2001 start and with enrollment weighting.
2. Should selectivity be grouped by each college's rate *then* rather than today? Colleges that became more selective
   may be the ones whose gap changed.
3. How to phrase this without implying a policy: a gap can reflect who applies as much as how colleges choose.

## Adding a study
Copy this template into **Studies**, and add a line to the backlog's National trends section:

```md
### Study N: Title
**Question.** …  **Why it's interesting.** …  **Data.** (history series, years, floors)
**First look.** (a computed table, with the date and panel)  **To build.** …  **Data work needed.** …  **Open questions.** …
```

## Open questions
1. One "Trends" page with study cards, or fold studies into the Data page? (Recommendation: a separate page; the Data
   page is about sources.)
2. Should studies be generated with the history build (always current) or hand-reviewed per release (more editorial
   control)? Recommendation: generated, with the takeaway text reviewed whenever a release changes a headline number by
   more than a few points.
