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

## Letters
The owner's decision (2026-10-07): there are no letters to build a reader on yet, so the **form is the first
release**, and the form asks families to share their letters so a reader can be built and measured later.
1. **Form** (this pass): a short form per offer with the College Financing Plan categories, one screen, with the
   traps above surfaced as it's filled ("you listed a loan under grants; move it?"). An admission letter's facts
   (the outcome, the reply date, a scholarship line, the deposit amount) are the same few fields on the decision
   entry. Fast for standard letters; fine for messy ones.
2. **Share the letter** (this pass): after saving an offer or a decision, one question: "Would you share the letter
   itself? It helps us build a reader that fills this form from a photo." Yes stores the file (PDF or photo) in a
   private Supabase Storage bucket under the uploader's id (`plan_letters`, [model.md](model.md#tables)), deleted
   with the account, revocable from the offer, with a note that a person at Quad will read it, names covered, to
   check the reader's work; it is never shown to anyone else and never used for anything but that. The shared set is
   counted on the Data page's methods section once it exists.
3. **Upload and read** (later, its own roadmap item once **30 letters** are shared across several colleges,
   admission letters included; owner decision 2026-10-07): a model with structured
   output classifies the document (`admission | aid | other`) and extracts with a verbatim quote per value, the same
   pattern as [college-reported-data.md](../college-reported-data.md#how-it-works); the family confirms every field
   before anything is written or computed. Extraction runs server-side and the document is never sent to analytics
   or kept by the model provider beyond the request. The shape below is what both the form and the reader produce.

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
- **Appeal support**: when another offer or the estimate is better, a short cited summary the family can send
  ("College B offered $X more in grants; our estimated need at your college is $Y"). Not a letter generator.

## Comparing the admits
- **The offers table**: one column per admitted college with an offer: COA, gift aid, net cost, borrowing,
  four-year total, monthly payment, earnings, graduation rate, distance, visit rating; a `SlopeChart`-style view of
  four-year cost per offer. Admits without an offer yet appear with their published average cost and "add the offer".
- **Compare my admits**: one button opens the site's compare pages ([comparison.md](../comparison.md)) with the
  admitted colleges (four on the topic pages, the rest in the table view), so the family's comparison of the colleges
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
- **The family dossier**: one PDF with the list, standing, the rounds plan, visits and notes, offers side by
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
`lib/planner/offers.ts`, `components/planner/OffersStage.tsx`, `OfferForm.tsx`, `OfferCard.tsx`, `OffersTable.tsx`,
`ShareLetter.tsx`, `ChooseButton.tsx`, the Storage bucket in the planner migration, `lib/pdf/dossier.tsx`,
`tests/planner-offers.test.mts` (CFP mapping, four-year math, flags, the choice's generated tasks, the ED withdraw
rule, a shared letter readable only by its uploader; fixtures: one CFP letter, one messy letter, one New York
standard letter entered through the form). Later, with the reader: `lib/planner/letters-extract.ts` (model call,
classification, schema, quotes) and its fixtures.

## Open questions
1. When 30 letters are shared ([README.md](README.md#owner-decisions-2026-10-07)), the reader's pilot measures
   per-field accuracy and cost per letter the way the college-reported pilot does, before any family sees an
   extracted field. The Data page's methods section should show the running count so the threshold is visible.
2. Should "I'm going to" be shareable publicly (a page like the share link)? Recommendation: an image, not a page;
   a public page would be a place for strangers to see a minor's college.
3. A Common App dashboard screenshot read by the same reader to seed statuses is noted for later, not this pass
   (owner decision 2026-10-07).

## Built (2026-10-08, unit U7 on `feature/planner-offers-2`)
What exists:
- **Pure math** `lib/planner/offers.ts`: `cfpView` (the CFP mapping: the letter's cost, else the sum of its lines, else
  the site's full price `cost.sticker` for the student's residency, flagged "cost added from IPEDS" with its year from
  lineage; gifts by source; net cost; out of pocket = net − work-study; loans by kind, Parent PLUS and private as "not
  aid", outside the headline), `offerFlags` → `questionsToAsk` (COA missing or without housing, a loan typed under
  grants, PLUS filling the gap, a private loan, renewal unknown or unwritten, first-year-only awards, a need grant
  called a scholarship, outside-scholarship displacement, work-study), `fourYears` (tuition and living costs at the
  college's own nominal trend, a total-only cost at the full-price trend; gifts per their flag, unknown shown both
  ways; the student's federal loans step up with the annual limits when year 1 is at the limit; Parent PLUS inside its
  annual and aggregate caps; the **10-year standard payment** at the award year's rate, labelled as such, with the
  tiered term the balance would get beside it), `growthRate`, `sortOffers` + `OFFER_SORTS` (the sort is named; unknown
  values last), `appealSummary`, `normalizeDraft` (the form's and the server's parser), `waitListLine`/`waitListOdds`,
  `validateLoanReference`, `ratesFor` (an award year not announced yet uses the newest published rate and says so).
- **Reference** `data/reference/federal-loans.json`: undergraduate and Parent PLUS rates for the 2023–24 to 2026–27
  award years, dependent undergraduate annual limits, the Parent PLUS limits from July 2026 ($20,000 a year, $65,000 per
  student), and the Tiered Standard terms for loans made from July 2026 (10/15/20/25 years by balance), each with its
  source URL (FSA electronic announcements, the Federal Register's fixed-rate notice, FSA's loan-limits FAQ of May 2026,
  and the RISE final rule, 34 CFR 685.208(c)(1)). Loan fees weren't confirmed at an official source, so they're left out.
- **Server facts** `lib/planner/offers-server.ts`: `offerFacts` (admitted colleges only: the full price by residency,
  the cost trend from history, average cost, aid generosity tier, earnings, debt, graduation rate, each cited),
  `waitListFacts` (C2, cited), `offerColumns`. History has no housing series: housing is full price − tuition, year by
  year, nominal.
- **Generator** `lib/planner/generators/offers.ts`: `add_offer` per admit; after the choice (`enrolling` and
  `committed_on`), `deposit` by the chosen college's C17 reply date (the same rule as the college generator's
  `reply_by`), `withdraw` per other admitted or pending college ("Tell {College} you won't attend; it frees a place"),
  after an ED admit "ED is binding: withdraw your application to {College} now" for every other application,
  wait lists included and dated the day of the choice; `waitlist_decide` per wait list otherwise; the summer list from
  the cycle file's `committed` entries as `summer` tasks keyed `{list}:summer:{entry key}`. `reply_by` and
  `housing_deposit` stay the college generator's; the store ticks them. A guardian's own list gets nothing.
- **Store** `lib/planner/store-offers.ts`: `recordDecision` (`applyOutcome` + date; ticks `{item}:decision_expected:-`
  except for a deferral; a denial dismisses the college's open steps), `saveOffer` (one per college; ticks
  `add_offer`), `deleteOffer`, `setProsCons`, `shareLetter` / `revokeLetter`, `choose` (ticks `reply_by`), `unchoose`,
  `withdrawCollege` (sets `withdrawn_on`, ticks the withdraw step), `consentOutcomeShare`; each regenerates.
- **UI**: `components/planner/stages/OffersStage.tsx` (decisions row with "Decisions start arriving {date}" and each
  college's date cited; wait lists with their C2 history cited; `OffersTable` with the slope view; per college the
  context lines, flags, questions to ask, the appeal summary with Copy, shared letters, pros and cons; Compare my
  admits; the choice; the household card; the after-the-choice steps with "I've withdrawn"; the summer list; the
  opt-in), `OffersTable.tsx` (cards in a swipe rail on phones, the table from `sm` scrolling inside its wrapper),
  `OfferForm.tsx` (one screen, traps inline, live net cost), `ShareLetter.tsx`, `ChooseButton.tsx`, `OutcomePicker.tsx`,
  `OfferControls.tsx`, `row/offers.tsx` (outcome picker; "Offer: $X net"), and the dossier
  `app/household/[person]/plan/print/page.tsx` (linked from the stage and the Plan menu).
- **Migration** `supabase/migrations/20261008141000_planner_offers.sql`: `lists.outcome_share_consented_at` and
  `outcome_share_consented_by`, changed only by the student's own account, or by a guardian who can edit a student
  without an account (trigger + `can_consent_outcome_share`); the signed-in user and the database's clock are recorded.
- **Glossary** `gift-aid`, `net-cost`, `work-study`, `parent-plus`, `renewable-award`, `award-displacement`,
  `summer-melt` (`cost-of-attendance` and `wait-list` already existed). **Telemetry** `plan_offer_added` (first save
  of a college's offer) and `plan_choice_made`, from the client.
- **Tests** `tests/planner-offers.test.mts` (CFP mapping over a CFP letter, a messy letter, and a New York standard
  letter typed through the form's parser; four-year math; flags; the reference file and a guard; the choice's tasks;
  the ED rule; wait lists; summer keys; sorting; the appeal line) and `tests/planner-offers-policies.test.mts` (PGlite:
  a letter row readable only by its uploader and the list's readers; the consent rules; guards that break each).

Decisions the build made:
- The table's headline borrowing is the student's federal loans plus the college's own; Parent PLUS and private loans
  are shown on their own line as "not aid".
- An offer for an award year whose rates aren't announced (rates come each May) uses the newest published rate and the
  table says which year's.
- Pros and cons live on the college's offer row; an admit without an offer gets a notes-only row (not confirmed), which
  the table doesn't count as an offer.
- Compare my admits opens `/compare?ids=` with the first four admits; beyond four, "All the numbers" links open
  `/compare/table?ids=` for each further group of four (the compare routes take at most four).
- Deferred: `applyOutcome` stores a deferral as Applied with no outcome; the decision date is kept, and the decisions
  row reads that as "Deferred {date}: waiting". The ED II line after an ED I deferral is U6's generator's.
- The share image ("Alex chose Michigan" with the crest and class year) is deferred: the household card says so.
- Withdraw tasks are generated for a college after it's withdrawn too, so ticking one doesn't orphan it.
- Shared letters are at most 4 MB (`experimental.serverActions.bodySizeLimit` is 4.4 MB in `next.config.ts`, under
  Vercel's request cap).

Owner setup:
1. Apply `supabase/migrations/20261008141000_planner_offers.sql` (SQL Editor, dev first, then prod). Until it's
   applied, the opt-in checkbox is hidden.
2. Run `supabase/storage/planner-letters.sql` in the SQL Editor (not a migration): it creates the private
   `plan-letters` bucket and its storage.objects policies (upload, read, and delete only in the uploader's own folder;
   the service role reads everything). Until it runs, "Share the letter" answers "Sharing letters isn't set up yet."
3. Follow-up: the account purge deletes `plan_letters` rows (they cascade with the user) but not the files; remove the
   purged user's folder from the bucket with the service role.
4. Each late May, add the new award year's rates to `data/reference/federal-loans.json` from FSA's announcement.
