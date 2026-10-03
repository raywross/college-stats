# Guides: Common Questions Answered as Living Lists

> Status: **idea** (2026-10-03). Needs nothing that isn't built; richer with the wave-4 CDS specs and
> [student-profile.md](../product/student-profile.md). Part of [ideas](README.md).

## Question it answers
*Which colleges give merit aid to most students? Where is a 1300 SAT above the middle? Which publics admit most
out-of-state applicants? Where do four years really mean four?* Families begin with a question like these, not with a
filter panel, and today the places that answer them are editors' lists that are opinion, stale, or paid for.

## Why it's fresh
A guidebook, re-issued every edition. Each guide is a **published query** over the dataset: its criteria, floors, and
sort are stated on the page in plain language and are the same `lib/params.ts` filters Explore uses, so the reader can
open the query in Explore and change it. The list is recomputed at every data publish and says which release it used.
No editor's picks, no sponsorship, no "best". Where the top-10 lists ([trends/top-10-lists.md](../trends/top-10-lists.md))
rank *change over ten years*, guides answer *where to look now*.

Borrowed patterns: the buying guide (Wirecutter, DPReview's "best for"), Lonely Planet's expert guides becoming an app,
Google Flights' "typical" context. Rejected: editorial ranking, affiliate links, paid placement (CollegeIQ's "Featured"
search flag), and anything a reader can't reproduce from the page.

## What a guide is
```
guide: {
  slug, title, question,                       // "Where merit aid is the norm"
  criteria: Filters (lib/params.ts) + floors,   // e.g. merit share without need >= 40%, first-years >= 300
  sort: SortKey + direction,                    // e.g. average merit award as a share of full price, descending
  limit: 25,
  method: string,                               // plain-language note rendered under the list
  fields: FieldPath[],                          // the figures shown per row, cited with citeField
  since: publish_id                             // first publish that could compute it
}
```
Registry `lib/guides.ts` (typed, tested). A build step `scripts/build-guides.mts` runs at publish and writes
`data/guides.json` (the rows per guide with the publish id), so the pages are static and `tests/guides.test.mts`
recomputes every guide from `schools.json` and compares.

## First guides
| Guide | Criteria (floors in parentheses) | Needs |
|---|---|---|
| Where merit aid is the norm | Share of no-need first-years with a non-need award ≥ 40%, sorted by average award ÷ full price (first-years ≥ 300) | [cds-financial-aid.md](../data-expansion/cds-financial-aid.md) |
| Four years means four | Share finishing within 4 years ≥ 70%, sorted by cost to a degree ([cost-to-a-degree.md](cost-to-a-degree.md)) | Built (OM) |
| Publics that admit most out-of-state applicants | Public; out-of-state admit rate ≥ 0.9 × in-state rate; sorted by out-of-state share of first-years | [cds-residency-admissions.md](../data-expansion/cds-residency-admissions.md) |
| Where a 1300 SAT is above the middle | SAT 75th percentile ≤ 1300; admit rate ≥ 40%; six-year graduation ≥ 60%; sorted by applicants | Built |
| Still test-required next cycle | C8 policy "required" for the coming cycle; sorted by applicants | [cds-test-scores-and-policy.md](../data-expansion/cds-test-scores-and-policy.md) |
| Under $20K a year, most students finishing | Average paid (all students) ≤ $20,000; six-year graduation ≥ 70%; sorted by average paid | Built |
| Nursing with a real program | ≥ 100 bachelor's in nursing (CIP 51.38) a year; the program's median earnings ≥ $70,000; sorted by graduates | Built (majors, field of study) |
| Applications fell, prices too | Applicants down ≥ 20% in ten years and average paid down after inflation; sorted by applicants | Built (trends) |
| Need met in full | CDS average percent of need met ≥ 95%; sorted by applicants | cds-financial-aid |
| Early decision fills half the class | Share of the class admitted through ED ≥ 50% | [early-decision-strategy.md](../product/early-decision-strategy.md) |

Each guide shows the figures its criteria use, with their years, and states its floors, so a college where 40 of 45
students finished doesn't lead a list.

## Personal variants
Signed in with a [student profile](../product/student-profile.md), a guide offers "for you": the student's state
replaces "in-state", their score replaces 1300, their max cost replaces $20,000, their intended major replaces nursing.
The page states which profile values it used, as every tool does. The variant resolves server-side from the profile
(like Explore's fit filters), so the URL means nothing to anyone else.

## Display
- `/guides`: a card per guide (the question, the count, "updated with the {release} data").
- `/guides/{slug}`: the question; the criteria as one sentence with the numbers; the list as `SchoolRow`s with the
  cited figures; the method note; "Open in Explore" with the same filters; related guides.
- Home: three guide cards under the facts. Profile: "In guides: Where merit aid is the norm" chips, so a college's
  membership is discoverable from its page.
- A reader's own query stays a shareable Explore URL; a named private guide under `/me` is the saved search proposed
  for [follow-colleges.md](../product/follow-colleges.md), not part of this idea.

## Tier
Free. Guides are public pages over public data; they are the top of the funnel, and each one is a durable answer to a
question people type into a search engine.

## Complexity
Medium: a typed registry, a build step at publish, one page template, a recompute test, and a personal variant that
reads the profile.

## Open questions
1. Which guides first? Recommendation: the five that need nothing unbuilt, then one per wave-4 spec as it ships.
2. Should a guide ever exclude a college by name (closed, online-first)? Reuse the top-10 lists' reviewed exclusion
   files rather than inventing a second mechanism.
3. "Guides" or "Lists"? Guides, because each answers a question and explains itself.
