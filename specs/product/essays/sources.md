# Part 6, Prompts We Can't Read From the College: Likely, Confirmed, and Who Says So

> Status: **planned** 2026-10-30. Part 6 of [essays](README.md). Extends [prompts.md](prompts.md) (the reader, the
> `school.essays` block, and its one rule: quote the college's own page) to the colleges that never publish their
> prompts; feeds the Essays tab ([tab.md](tab.md)) and the essays move ([moves.md](moves.md)). Part of
> [product](../README.md).

## The owner's brief (2026-10-30)
Looking at the University of Florida on the Essays tab: "University of Florida asks its questions inside the
application. What does that mean? Why don't we have the question?" Then, after the facts below: "What if we scraped
questions from these other sites, mark them as likely instead of definite. Then allow students or parents to change
them. We could then do something where we sort of crowdsource the questions from our own users where if there's a
consensus of the same override we use that instead of the scraped value from those coach sites?" Agreed, with the
one secondhand source read under permission ("scrape from the essay guy as proposed as well"), and the reader's
misses fixed.

## The facts this rests on (2026-10-30)
- Of the Common App members read so far, **20 published** their prompts, **3 say they have none**, and **20 came back
  as "refers to the form"**. That last group is two different things:
  - Colleges whose questions exist **only inside the application**: Florida, Florida State, Texas A&M, Texas Tech,
    Rutgers, Indiana, Delaware, Missouri, Washington's "How to apply" page says only that an essay is required, and
    others. Florida's own site was read end to end (the freshman page, its own Common App guide, the Honors and
    Innovation Academy pages, the counselors' brochure, and the Common App Explore page): none prints a prompt; UF's
    guide sends applicants to the form.
  - **Reader misses**: Harvard's page lists its five questions under the sentence the reader quoted; Cornell, Dartmouth,
    Boston University, and the University of Washington publish prompts one link past the how-to-apply page the reader
    stopped at; Villanova's reader landed on the law school. These are fixed in the reader
    ([Reader fixes](#reader-fixes) below), not here.
- The questions **are** readable to a signed-in person: inside a Common App account, a college's Questions and Writing
  sections print each prompt with its limit. The public Explore page shows yes/no flags only. Common App's terms forbid
  bots, scraping, and data mining, and the permission we hold ([../../data-expansion/common-app.md](../../data-expansion/common-app.md#permission))
  covers the Requirements Grid and the Explore pages, not the form. An automated reader behind the login is out.
- The essay-coaching sites (College Essay Guy, CollegeVine, College Transitions, Ivy Coach, College Essay Advisors)
  copy the in-form questions out each August. They lag and disagree: on the same day two of them named different
  prompts as UF's required one for this cycle. **College Essay Guy** keeps the broadest, best-dated list. Its website
  terms say content is "for informational purposes only" and that nothing may be "copied, reproduced, republished …
  or used for public or commercial purposes" without written permission; its attribution page welcomes reuse by
  counselors with its logo and a link, and names help@collegeessayguy.com for "customizing and adapting content to
  an outside platform"; its robots.txt allows crawling with a 10-second delay. So, as with Common App: **a letter
  first**, then code.

## The design
Three sources of a prompt, each with its own confidence, all landing in the same `school.essays` block so the tab,
the move, the picker, and the package read them the same way:

| Confidence | Where it came from | Card wording |
|---|---|---|
| **published** | The college's own page (the reader, as built) | as today: the prompt, "as {College} publishes it, read {date}" |
| **confirmed** | A person read it inside the form (the owner's hand read), or two or more families reported the same text from the form and the owner approved it | "From the application form, confirmed {date}" |
| **likely** | College Essay Guy's page for the college, under permission | "Likely this year's prompt, as listed by College Essay Guy on {date}. Confirm it in the application." with their logo and link |

Precedence per college and cycle: published > confirmed > likely. A `likely` prompt is replaced the moment a
`confirmed` one arrives for the same college; a `published` block always wins. A college whose page says it has no
supplement (`none`) is not overridden by a secondhand source: the college is the authority on its own page, and the
coaching sites sometimes list last cycle's prompts for a college that dropped them.

### 1. Likely: College Essay Guy, under permission
- **First, the letter** (drafted in `~/Projects/college-stats/essays-next-build/letter-college-essay-guy.md`; the owner
  sends it from the site's address): what we would read (prompt text, limit, required, the cycle the page names),
  how it would appear (marked likely, their logo and homepage link, shown only when the college itself publishes
  nothing), how we would read it (one request per college page per week in season, the honest user agent, robots.txt
  and its crawl delay honored), what we offer (attribution, same-day removal, our students' confirmations back to
  them). Until the answer, nothing is read from their site and the card keeps the "asks in the application" line.
- **Then the reader**: a second recipe type in the college-reported engine, `coach-prompts`, run only for colleges whose
  own block is `refers_to_form` or `not_on_file` after the reader's own pass, and only for colleges on at least one
  family's list (so the volume stays small: a few dozen pages, not two thousand). Discovery is their site's own college
  index, not search. The read is the same model read as `essay-prompts` with the same checks (verbatim quote per
  prompt, a limit from the page's words, the cycle the page names); a page that names an older cycle than the open one
  is held, not stored. Stored at `data/essay-prompts/secondhand/<unit_id>.json` with `source: "college-essay-guy"`,
  `source_url`, `retrieved`, and the page's cycle line; merged into `school.essays` with `confidence: "likely"` and a
  lineage record whose `url` is their page.
- **Discovery, for every college**: their college index also links to each college's own prompts page when one exists.
  The `essay-prompts` reader may use that link as a **candidate** for its own discovery (the finder-not-source rule
  from the collegedata.fyi evaluation): the page it then reads and quotes is the college's. This is how most of the
  "not found" colleges get found, and it needs no new permission because nothing of theirs is stored.

### 2. Confirmed: a person's read, and the families' consensus
- **The hand read.** Each August, a person with an ordinary Common App account opens the in-form colleges that
  families actually list (the ones with a `refers_to_form` or `likely` block and at least one plan item; fifteen to
  twenty today) and copies each prompt, its limit, and whether it is required into
  `data/essay-prompts/confirmed/<unit_id>.json` with `source: "form-by-hand"`, the date, and the reader's initials.
  A person reading the application they have an account for is the ordinary use the terms describe; nothing is
  automated. The file is merged like any record and cited "From the application form, read by hand on {date}". A
  checklist of the colleges to read lives on the admin Essays page (below).
- **Sharing from the workspace.** When a student adds their own prompt for a college ("Add what {College} asks",
  [tab.md](tab.md)), the picker offers one unchecked box: **"This is the question exactly as the form shows it. Share it
  to help other families."** Checking it sends the prompt's text, limit, required flag, the college, and the cycle to
  a new table, `prompt_reports`, with the household's id hashed with a per-cycle salt (so two reports from one
  household count once, and no report can be traced back). Never the draft, never the student's name, never the
  guardian's. A parent reading the draft can see the box's state but not change it (the student's words, the
  student's choice). Unchecking later deletes the report.
- **Consensus.** A report's text is normalized (whitespace, quotes, dashes, trailing punctuation, case) and grouped by
  college and cycle. When **two or more distinct households** report the same normalized text, the group becomes a
  **proposal** in the Data Steward's review queue ([../data-steward.md](../data-steward.md) "Proposals"): the text as
  the first reporter typed it, the count, the limit if the reports agree, and the current block (likely or none) it
  would replace. A College Essay Guy `likely` prompt counts as one voice toward a group it matches, never as a
  blocker. The owner approves or declines in one tap; approval writes a `confirmed` record with `source:
  "form-by-families"`, `reports: N`, and the date, and the card reads "From the application form, confirmed by N
  families on {date}". A later group with different text for the same college and cycle reopens the review (a
  college can change its question mid-season) rather than replacing silently.
- **A student can always edit their own copy.** The shared record changes only through consensus and review; the
  student's draft keeps whatever title and prompt they wrote.

### 3. What the student and parent see
- The Essays tab card for a college with a `likely` block: the prompts as rows, each marked "likely" in the row's
  fold with the College Essay Guy credit and link, and the card's note "These are the questions College Essay Guy
  lists for this cycle; the application has the final word." Start works on them as on any prompt.
- A `confirmed` block: the rows as for a published college, the note "From the application form, confirmed {date}".
- A `refers_to_form` college with nothing else: today's line, reworded to say why: "{College} doesn't publish its
  questions on its site; they're inside the application. Add each one here as you meet it, and share it if you'd
  like." The share box appears on the add.
- The college's public admissions page ("What it takes to apply") shows `likely` prompts under a fold headed "As
  listed by College Essay Guy" with the credit; `confirmed` prompts under "From the application form". Never a
  `likely` prompt presented as the college's own words.
- The essays move counts `likely` and `confirmed` prompts as work to do, the same as published ones; `required` from
  the source, `choose` as the source states it.

### 4. The admin side
A small section on the admin Essays page (or the Operations page): the colleges by confidence with counts; the hand-read
checklist for the cycle (in-form colleges on families' lists, with "read" ticks and dates); the pending proposals with
their counts; the College Essay Guy permission's state (asked, granted, terms) and the last read's date and cost.

## Rules
- Nothing automated ever signs in to an application platform. The form is read by people: the owner by hand, or the
  student who is filling it in.
- Every stored prompt names its source, its date, and its confidence; a `likely` prompt is never shown as the college's
  own words, and the credit and link College Essay Guy's attribution page asks for appear wherever one shows.
- Sharing is opt-in per prompt, unchecked by default, reversible, and carries no name, draft, or household id in
  clear. Reports never reach analytics as text.
- Consensus never publishes on its own: the owner approves every `confirmed` record that comes from families.
- The college's own page wins over everything; its `none` is never overridden by a secondhand source.
- The permission's scope is the ceiling: if College Essay Guy declines, the `likely` tier is simply empty and the rest
  of this part stands.

## Reader fixes
Separate from this part and built first (branch `fix/essay-prompts-misses`): discovery never accepts a graduate or
professional school's page (Villanova's law school); a how-to-apply page that mentions the supplement is followed one
more level to an essays or writing-supplement link on the college's own hosts before `refers_to_form` is accepted
(Cornell, Dartmouth, Boston University, Washington); a `refers_to_form` whose quote counts questions ("five required
short-answer questions") or describes the Common App's own essay is held for a person rather than stored (Harvard,
Washington); the read instructions say outright that a page printing the questions is `published` even when it also
says the answers go in the application. The next run then re-reads every non-published college.

## Telemetry
`essay_prompt_shared {checked: boolean}` (the box, no text), `prompt_report_consensus {reports}` (server, on a group
reaching two), `prompt_review_decided {decision}` (admin). Never a prompt's text or college in a property.

## Files (planned)
- `scripts/lib/essay-prompts/`: `secondhand.mts` (the College Essay Guy recipe, index discovery, the read, the
  older-cycle hold), `confirmed.mts` (the hand-read file's checks), `merge.mts` (precedence and `confidence`),
  `discover.mts` (coach-index links as candidates). `data/essay-prompts/{secondhand,confirmed}/`.
- `lib/types.ts`: `SchoolEssays.confidence: "published" | "confirmed" | "likely"`, `SchoolEssays.credit?: { name,
  url, logo }`; `lib/fields.ts` the new sources (`college-essay-guy`, `form-by-hand`, `form-by-families`).
- `supabase/migrations/<date>_prompt_reports.sql`: `prompt_reports (id, unit_id, cycle, text, normalized, limit_kind,
  limit_max, required, household_hash, created)`, `prompt_proposals (unit_id, cycle, normalized, text, reports, state,
  decided_at, decided_by)`; RLS: a student inserts and deletes their own report (by essay id), nobody reads the table
  but the service role; the admin reads proposals.
- `lib/essays/store.ts` (`shareOwnPrompt`, `unshareOwnPrompt`), `lib/essays/consensus.ts` (pure: normalize, group,
  threshold), a nightly job that turns groups into proposals, the admin review rows in the Data Steward's queue.
- `components/essays/PromptPicker.tsx` (the share box), `CollegeEssayCard.tsx` and `components/school/EssayPrompts.tsx`
  (confidence wording and credit), `lib/essays/tab-view.ts` (the reworded in-form line), the admin Essays section.
- Tests: precedence and `none` never overridden; the older-cycle hold; normalization and the two-household threshold
  (one household twice is one); RLS for reports; the share box unchecked by default; the credit present wherever a
  `likely` prompt shows; the essays move counting likely prompts.

## Build order
1. The letter (owner sends). 2. Reader fixes (in progress). 3. The hand-read file and its merge, so Florida and the
other in-form colleges can be filled this week. 4. The share box, reports, consensus, and review. 5. The College Essay
Guy recipe, once the answer is yes.

## Complexity
Medium: one more recipe in an existing engine, two small tables, a consent control, and a review row in a queue that
exists.

## Open questions
1. Should a `likely` prompt count as required work in the essays move, or only as "something to check"? Recommendation:
   it counts; the student will have to write it either way, and the card says to confirm it.
2. Threshold of two households: enough? Recommendation: two to propose, the owner's approval to publish; raise to three
   if the queue shows noise.
3. Should the hand read also cover the Coalition's and a college's own form when a college isn't on the Common App?
   Recommendation: yes, the same file, `source` says which form.
