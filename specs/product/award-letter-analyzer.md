# Award Letter Analyzer: Offers Side by Side

> Status: **planned** (not built). After [net-price-estimator.md](net-price-estimator.md) (shares cost of attendance,
> loan rates, and the four-year projection) and [saved-lists.md](saved-lists.md). Part of [product](README.md).

## Goal
In spring, a family holds four to eight aid offers that use different words for the same things, leave out costs,
and present loans as if they were aid. The analyzer puts every offer into one standard layout, computes what the
family pays and borrows each year and over four years, and sets each offer beside the college's median earnings and
the family's own estimate. It also says what to ask the college.

## Research (2026-10-02)
- **The federal College Financing Plan** (formerly the Shopping Sheet) is the standard layout: cost of attendance
  by component; grants and scholarships by source; net cost; work-study; loan options separated; graduation rate,
  median borrowing, repayment. Many colleges use it voluntarily; the Department of Education updates the template
  yearly. Using its categories means an upload from a compliant college maps one-to-one.
- **States are mandating standard letters:** New York's standard undergraduate award letter is required from the
  2016–17 year under a law signed December 2025; Minnesota's standardized letter is required from 2025–26. A
  federal Student Financial Clarity Act (H.R. 6498, 2025) is pending. Standardization is spreading, so the analyzer
  should accept standard letters perfectly and messy ones well.
- **Competitors:** Niche launched a free "Financial Aid Decoder" (March 2026, upload and side-by-side, with College
  Aid Pro); TuitionFit and Road2College crowdsource anonymized letters so families can see what others got at the
  same college. Free decoders are now table stakes; Quad's edge is the cited context around each offer (true cost
  history, generosity, earnings, debt) and the family's own estimate for comparison.
- Common traps the tool must surface: loans listed under "aid"; Parent PLUS loans presented as covering the gap;
  scholarships with renewal conditions (a GPA minimum, a major); first-year-only awards; work-study counted as
  money in hand; cost of attendance omitted or understated (books, travel); tuition increases over four years.

## Input
Two paths, both ending in the same structured offer:
1. **Form** (first): a short form per offer with the College Financing Plan categories. Fast for standard letters.
2. **Upload** (second): PDF or photo. Extracted by a model with structured output and a verbatim quote per number,
   the same pattern as [college-reported-data.md](../college-reported-data.md#how-it-works), then shown to the
   family for confirmation before anything is computed. Files are stored in Supabase Storage under the uploader's
   user id (private bucket, RLS), deleted with the account. Extraction runs server-side and the document is never
   sent to analytics or kept by the model provider beyond the request.

```ts
offer: {
  unit_id, award_year, letter_date, source: "form" | "upload",
  coa: { tuition_fees, housing_food, books, transport, personal, other, total, stated_by_college: boolean },
  gift: { kind: "federal" | "state" | "college_need" | "college_merit" | "outside", name, amount,
          renewable: boolean | null, renewal_condition: string | null, years: number | null }[],
  work_study: number | null,
  loans: { kind: "direct_sub" | "direct_unsub" | "parent_plus" | "private" | "institutional", amount }[],
  quotes?: Record<string, string>
}
```

## Computation (`lib/offers.ts`, pure)
- **Cost of attendance:** the letter's if stated; otherwise the site's full price for that college and residency,
  flagged "cost added from IPEDS 2023–24, the letter didn't state it".
- **Net cost** = COA − gift aid. **Out of pocket** = net cost − work-study (shown separately as "if earned").
- **Borrowing:** loans the letter offers, by kind; Parent PLUS and private loans are flagged as "not aid" and
  excluded from the headline.
- **Four years:** tuition and housing grow at the college's own trend (from history); each gift renews per its
  flag (unknown → shown both ways); federal loan limits step up by year; total cost, total borrowed, and the
  monthly payment on a 10-year standard plan at the award year's rates (reference table shared with the
  estimator).
- **Context lines** per offer, each cited: the college's average total cost for all first-years and its aid
  generosity tier ([cost-outcomes.md](../cost-outcomes.md)); the family's estimate from
  [net-price-estimator.md](net-price-estimator.md) ("offer is $4K better than your estimate"); median earnings and
  median debt of graduates; graduation rate; the student's standing.
- **Questions to ask**, generated from flags: renewal conditions missing; COA omitted; a gap filled by PLUS; a
  grant named "scholarship" that is need-based (ask whether it changes if income changes); an outside scholarship
  that may displace college aid.
- **Appeal support:** when another offer or the estimate is better, a short cited summary the family can send
  ("College B offered $X more in grants; our estimated need at your college is $Y"). Not a letter generator.

## Display
- `/me/offers`: one card per offer (CFP layout), then a comparison table: COA, gift aid, net cost, borrowing,
  four-year total, monthly payment, earnings, graduation rate. A `SlopeChart`-style view of four-year cost per
  offer. Phones: cards in a swipe rail, table scrolls.
- A list row gains "Offer: $X net" once an offer exists ([saved-lists.md](saved-lists.md#display)).
- The guardian and the student both see offers ([accounts.md](accounts.md#privacy-model)); the family-estimate
  context line shows only to the guardian who owns the estimate.
- **Glossary:** `cost-of-attendance`, `gift-aid`, `net-cost`, `work-study`, `parent-plus`, `renewable-award`,
  `award-displacement`.

## Later: pooled offers
With consent, an anonymized offer (college, award year, gift total, the family's income band, standing bucket) can
join a pooled table so families see "what others got here" (TuitionFit's idea), shown only when 10+ offers exist
for a college and year, with income bands no finer than the Scorecard five. Opt-in per offer, revocable, and never
including names, amounts under $500 granularity, or free text. Separate decision when offers exist.

## Files (planned)
- `lib/offers.ts`, `lib/offers-extract.ts` (model call, schema, quotes), `app/me/offers/`, `components/offers/`,
  migration `…_offers.sql` plus a private Storage bucket, `tests/offers.test.mts` (CFP mapping, four-year math,
  flags; fixtures: one CFP letter, one messy letter, one New York standard letter).

## Open questions
1. Upload extraction cost and accuracy: pilot with ~30 real letters (volunteers, redacted) before launch; measure
   per-field accuracy and cost per letter the way the college-reported pilot does.
2. Pro feature per the idea document; recommendation: the form and one comparison free in April–May (when it
   matters and when word of mouth is strongest), the four-year projection and upload with Pro
   ([commercialization.md](commercialization.md#feature-map)).
