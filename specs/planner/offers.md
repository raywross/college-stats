# Stage 6, Decisions and Offers: Outcomes, Letters Side by Side, and the Choice

> Status: **planned** 2026-10-07; the award letter analyzer of 2026-10-02 (`product/award-letter-analyzer.md`) moved
> here and extended into the planner's last stage. After [applications.md](applications.md) and
> [net-price-estimator.md](../product/net-price-estimator.md) (shares cost of attendance, loan rates, and the
> four-year projection). Part of the [planner](README.md).

## Goal
From December to May the family's work changes: record what each college said, read the aid offers (which use
different words for the same things, leave out costs, and present loans as aid), compare the places that said yes,
choose one, and then do the things a choice creates. This stage takes a decision in one tap or one upload, puts
every offer into the federal College Financing Plan layout with four-year totals, sets each offer beside the
family's own estimate and the college's outcomes, compares the admits on the site's own compare pages, records the
choice, and generates the deposit, withdrawal, and summer tasks. It ends when the student says where they're going.

## Research (2026-10-02, extended 2026-10-07)
- **The federal College Financing Plan** (formerly the Shopping Sheet) is the standard layout: cost of attendance
  by component; grants and scholarships by source; net cost; work-study; loan options separated; graduation rate,
  median borrowing, repayment. Many colleges use it voluntarily; the Department of Education updates the template
  yearly. Using its categories means an upload from a compliant college maps one-to-one.
- **States are mandating standard letters:** New York's standard undergraduate award letter is required under a law
  signed December 2025; Minnesota's standardized letter from 2025–26. A federal Student Financial Clarity Act
  (H.R. 6498, 2025) is pending. The stage should accept standard letters perfectly and messy ones well.
- **Competitors:** Niche launched a free "Financial Aid Decoder" (March 2026, upload and side-by-side, with College
  Aid Pro); TuitionFit and Road2College crowdsource anonymized letters. Free decoders are table stakes; the edge is
  the cited context around each offer (true cost history, generosity, earnings, debt), the family's own estimate for
  comparison, and the choice being wired into the plan.
- **Admission letters are documents too.** Families get the decision in a portal and a PDF; the PDF carries the
  reply date, sometimes a scholarship, the deposit amount, and housing instructions. One upload path that classifies
  the document (admission, aid, other) and extracts what it finds saves the family typing the same dates twice.
- **After May 1.** Since the 2019 NACAC consent decree, colleges may keep recruiting students who have deposited
  elsewhere, and wait lists move into summer. The choice is a step with consequences (deposit, withdraw, decline,
  keep one wait list or not), not the end of the plan.
- Common traps the stage surfaces: loans listed under "aid"; Parent PLUS presented as covering the gap;
  scholarships with renewal conditions; first-year-only awards; work-study counted as money in hand; cost of
  attendance omitted or understated; tuition increases over four years.

## Recording decisions
The fastest path first. On the Decision expected task, the list row, or the stage panel: **Admitted · Denied ·
Waitlisted · Deferred**, with the date (default today). The built transitions apply (`applyOutcome`: deferred
returns to applied). Recording:
- **Admitted** creates the Reply-by task from C17 (or asks for the date from the letter), the housing-deposit task
  once enrolling, an "Add the aid offer" prompt, and moves the college into the comparison.
- **Waitlisted** creates the wait-list tasks ([applications.md](applications.md#status-per-college)) and shows the
  college's wait-list history (C2: offered, accepted a place, admitted) beside the row, cited.
- **Deferred** from ED I opens the ED II line ([early-rounds.md](early-rounds.md#open-questions)).
- **Denied** closes the college's tasks and says nothing else.
Decisions are the student's; a guardian with edit access can record one and it's attributed.

## Letters: one upload for admission and aid
Two paths end in the same structured data:
1. **Form** (first): a short form per offer with the College Financing Plan categories. Fast for standard letters.
2. **Upload** (Pro): PDF, photo, or screenshot. A model with structured output **classifies** the document
   (`admission | aid | other`) and extracts with a verbatim quote per value, the same pattern as
   [college-reported-data.md](../college-reported-data.md#how-it-works); the family **confirms** every field before
   anything is written or computed. An admission letter yields the outcome, the reply date, any scholarship line,
   and the deposit amount; an aid letter yields the offer below; a letter with both yields both. Files live in a
   private Supabase Storage bucket under the uploader's id, deleted with the account; extraction runs server-side
   and the document is never sent to analytics or kept by the model provider beyond the request.

```ts
offer: {
  item_id, award_year, letter_date, source: "form" | "upload",
  coa: { tuition_fees, housing_food, books, transport, personal, other, total, stated_by_college: boolean },
  gift: { kind: "federal" | "state" | "college_need" | "college_merit" | "outside", name, amount,
          renewable: boolean | null, renewal_condition: string | null, years: number | null }[],
  work_study: number | null,
  loans: { kind: "direct_sub" | "direct_unsub" | "parent_plus" | "private" | "institutional", amount }[],
  quotes?: Record<string, string>, confirmed_at
}
```

## Computation (`lib/planner/offers.ts`, pure)
- **Cost of attendance:** the letter's if stated; otherwise the site's full price for that college and residency,
  flagged "cost added from IPEDS, the letter didn't state it", with the year from lineage.
- **Net cost** = COA − gift aid. **Out of pocket** = net cost − work-study (shown separately as "if earned").
- **Borrowing:** loans the letter offers, by kind; Parent PLUS and private loans are flagged "not aid" and excluded
  from the headline.
- **Four years:** tuition and housing grow at the college's own trend (from history); each gift renews per its
  flag (unknown → shown both ways); federal loan limits step up by year; total cost, total borrowed, and the
  monthly payment on a 10-year standard plan at the award year's rates (the reference table shared with the
  estimator).
- **Context lines** per offer, each cited: the college's average total cost and aid generosity tier
  ([cost-outcomes.md](../cost-outcomes.md)); the family's estimate ("offer is $4K better than your estimate", to the
  guardian who owns it); median earnings and median debt of graduates; graduation rate; the student's standing; the
  visit rating and notes from [actions.md](actions.md#visits); the Dream star.
- **Questions to ask**, generated from flags: renewal conditions missing; COA omitted; a gap filled by PLUS; a
  need-based grant named "scholarship"; an outside scholarship that may displace college aid.
- **Appeal support** (Pro): when another offer or the estimate is better, a short cited summary the family can send
  ("College B offered $X more in grants; our estimated need at your college is $Y"). Not a letter generator.

## Comparing the admits
- **The offers table**: one column per admitted college with an offer: COA, gift aid, net cost, borrowing,
  four-year total, monthly payment, earnings, graduation rate, distance, visit rating; a `SlopeChart`-style view of
  four-year cost per offer. Admits without an offer yet appear with their published average cost and "add the offer".
- **Compare my admits**: one button opens the site's compare pages ([comparison.md](../comparison.md)) with the
  admitted colleges (four free, ten with Plus in the table view), so the family's comparison of the colleges
  themselves uses the pages that already exist, and this stage stays about the offers and the choice.
- **Pros and cons**: a free-text pair per admitted college, the student's; shown beside the numbers, never scored.
- Nothing is ranked. The table is sortable by any column, and the sort says which.

## The choice
**"I'm going to {College}"** sets `enrolling` (one per list), `committed_on`, and the stage's last tasks:
- Deposit by the reply date (C17) and the housing deposit with amount and refund rule, both parent-assigned by
  default.
- **Withdraw the others**: one task per other admitted or pending college ("Tell {College} you won't attend; it
  frees a place for someone"), required when the choice was an ED admit ("ED is binding: withdraw every other
  application now"). Marking it sets `withdrawn_on`.
- **Wait lists**: for each waitlisted college, "Stay on the wait list or withdraw?" with the C2 history beside it;
  staying keeps the task "a wait-list offer may come after May 1; you'd forfeit the deposit at {College}".
- A card for the household ("Alex chose Michigan") and, if the student likes, a share image with the crest and the
  class year, no numbers.

## After the choice
The summer list, from the cycle file's `committed` entries: final transcript, orientation registration, housing
application, placement tests, immunization records, FAFSA verification if requested, AP or IB scores, the first
bill's date. Each is a dated or windowed task like any other; the weekly email continues through July. Castleman and
Page's summer-melt trials are the evidence this list is worth the trouble ([README.md](README.md#research-2026-10-07)).

**Where they went**: with the student's consent (one checkbox, revocable), the outcome set (college, round, outcome,
enrolled yes/no, standing bucket, the student's state) joins the pooled self-reported outcomes that
[scattergrams.md](../product/scattergrams.md#self-reported-outcomes) defines, under its thresholds. Nothing else
leaves the household.

## Display
- **Stage panel**: the decisions row (each college with its outcome chip and date), the offers table, Compare my
  admits, the choice button, then the after-the-choice tasks. Before any decision: "Decisions start arriving
  {earliest notification date}" with the dates per college.
- **List row**: the outcome picker already there; "Offer: $X net" once an offer exists.
- **Parent's view**: the same panel; the family-estimate context line shows only to the guardian who owns the
  estimate; the appeal summary is drafted for whoever opens it.
- **The family dossier** (Pro): one PDF with the list, standing, the rounds plan, visits and notes, offers side by
  side, the four-year totals, and a sources page; the same renderer the counselor portal will use.
- **Phones**: offers as cards in a swipe rail; the table scrolls sideways inside its wrapper.
- **Glossary:** `cost-of-attendance`, `gift-aid`, `net-cost`, `work-study`, `parent-plus`, `renewable-award`,
  `award-displacement`, `wait-list`, `summer-melt`.

## Later: pooled offers
With consent, an anonymized offer (college, award year, gift total, the family's income band, standing bucket) can
join a pooled table so families see "what others got here" (TuitionFit's idea), shown only when 10+ offers exist
for a college and year, with income bands no finer than the Scorecard five. Opt-in per offer, revocable, and never
including names, amounts under $500 granularity, or free text. Separate decision when offers exist.

## Files (planned)
`lib/planner/offers.ts`, `lib/planner/letters-extract.ts` (model call, classification, schema, quotes),
`components/planner/OffersStage.tsx`, `OfferCard.tsx`, `OffersTable.tsx`, `ChooseButton.tsx`, the Storage bucket in
the planner migration, `lib/pdf/dossier.tsx`, `tests/planner-offers.test.mts` (CFP mapping, four-year math, flags,
the choice's generated tasks, ED withdraw rule; fixtures: one CFP letter, one messy letter, one New York standard
letter, one admission letter with a reply date and a scholarship line).

## Open questions
1. Upload extraction cost and accuracy: pilot with about 30 real letters (volunteers, redacted), now including
   admission letters, before launch; measure per-field accuracy and cost per letter the way the college-reported
   pilot does.
2. Tier: the form and one comparison free in March–May (when it matters and word of mouth is strongest), the
   four-year projection, upload, appeal summary, and dossier with Pro ([README.md](README.md#tiers-proposal-see-the-open-questions)).
3. Should "I'm going to" be shareable publicly (a page like the share link)? Recommendation: an image, not a page;
   a public page would be a place for strangers to see a minor's college.
