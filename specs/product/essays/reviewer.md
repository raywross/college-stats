# Part 3, The Reviewer: A Reader's Notes, Never a Rewrite

> Status: **planned** 2026-10-28. Part 3 of [essays](README.md). After [workspace.md](workspace.md). Builds on the
> estimate's architecture (server-only model code, a note catalog, a method version;
> [../../chances/estimate.md](../../chances/estimate.md)) and the Data Steward's agent pattern for the research run
> ([../data-steward.md](../data-steward.md)). Part of [product](../README.md).

## Goal
When a student asks, read a draft the way a careful adult reader would and leave notes: the typo, the run-on, the
sentence that drifts from the prompt, the claim with no detail behind it, the opening that starts two years too
early, the paragraph that reads like an adult wrote it. Each note says what the reader noticed, why it matters, and
asks a question or points at the spot. It never rewrites. The owner's words: "suggest improvements and spot things like
typos or run-ons, but where we're giving advice, not rewriting."

## What a note is
A note is attached to a span of the draft (a paragraph, a sentence, or a word) and has:

| Field | What |
|---|---|
| `category` | one of the categories below |
| `span` | paragraph index and a character range within it, or the whole draft |
| `observation` | what the reader saw, in one sentence ("This sentence runs three ideas together.") |
| `why` | why a reader of applications cares, in one sentence, from the guidance corpus, with its source |
| `ask` | a question to the student or a pointer ("Which of the three matters most here?"); never prose for the essay |
| `fix` | **only for `mechanics`**: the corrected word or punctuation, at most eight words; empty for every other category |

### Categories
| Category | Looks for | Example note |
|---|---|---|
| `mechanics` | Spelling, agreement, a run-on, a comma splice, a dropped word, a limit exceeded | "'their' here should be 'there'." |
| `prompt` | Whether the draft answers the prompt as written, names the right college, respects the limit; a "why us" that could be about any college | "The prompt asks what you'd do here; the draft describes what you've done. Where does Wake Forest come in?" |
| `specific` | A claim with no example; an abstraction where a moment would do ("I learned leadership") | "What happened on the day you learned that?" |
| `structure` | An opening that starts far before the story; an ending that restates; a paragraph doing two jobs | "The essay starts in the third paragraph. What would it lose if it opened there?" |
| `voice` | Sentences that sound like a brochure, a thesaurus, or an adult; a list of accomplishments the activities section already carries | "This paragraph lists four awards. The activities list has them; what does this essay add about you?" |
| `care` | A sensitive subject the student may or may not want to share, or a detail that identifies someone else | "You name your sister's diagnosis. Is that yours to share, and does the essay need it?" |

Never: a grade, a score, "strong" or "weak", a prediction about admission, advice to drop a topic because it is
"overdone", a judgment of the student's life, or a sentence the student could paste in. A note that the guard below
rejects is dropped before the student sees it.

## How it reads
One model call per review, server-only (`lib/essays/review.ts`, never shipped to the browser), with:
1. The prompt the draft answers (text, limit, college) from [prompts.md](prompts.md), and the student's draft.
2. The **rubric**: the categories above with their rules, and the refusals.
3. The **guidance** for this prompt's kind and the categories (below): the corpus's sections, cited.
4. The student's earlier notes on this draft and what they marked done or ignored, so a review doesn't repeat itself.
5. A structured-output schema for the notes (the fields above), so the response is data, not prose.

Nothing else about the student is sent: not the record, not the name, not the other essays. The rubric and the
guidance are the stable prefix of every call and are cached; the draft is the variable tail.

**Model.** Claude Opus 5 (`claude-opus-5`), adaptive thinking, effort `medium`: the reading is judgment-heavy (what
counts as a claim without a detail, whether a sentence drifts), and the notes must be few and right. Cost per review
at list prices: about 6,000 input tokens (the rubric and guidance cached after the first call) and 1,500 output, around
$0.05; a student who reviews every draft five times across fifteen essays costs under $5 for the cycle. If the owner
prefers a cheaper reader, Sonnet 5 (`claude-sonnet-5`) halves it; the eval below says whether the notes hold up.
The same `/api/estimate` rules apply: a request limiter, the key on the server, `refusal` handled as "no notes this
time".

**"A small language model, or a RAG."** No model is trained or tuned for this: there is no training set of essays
with reader's notes that we may use, and a hosted model reads an essay well already. What makes the notes *ours* is the
guidance corpus below and the rubric, retrieved per prompt kind and category and placed in the call; the corpus is
small enough (about forty sources, a few thousand words of synthesized guidance) that the retrieval is by category
and kind, not by embeddings. Revisit only if reviews reach the thousands and the eval shows a gap a cheaper or tuned
model would close.

## The guidance corpus
What the owner asked for: research public sources first, then bring them together into guidance that is "really usable
and useful." The corpus is a dataset like any other on the site: sources with dates, excerpts within fair use, and our
synthesis with citations, versioned, reviewed before it runs.

**Sources, public and institutional only** (no commercial essay-coaching content, no student essays):
- Admissions offices' own advice pages: MIT Admissions on the essays, Yale's and Harvard's application tips, Johns
  Hopkins' notes on what its "essays that worked" do well (the notes, not the essays), Georgia Tech's admissions
  blog, the University of Chicago's prompt notes, Tufts' and Wake Forest's writing advice, the UC's personal insight
  question guidance.
- The platforms: Common App's and the Coalition's essay guidance pages.
- Writing centers: Purdue OWL (mechanics, run-ons, comma splices), UNC's and Harvard's writing center handouts on
  specificity and structure.
- Counselors' associations: NACAC's public guidance for students.

**The research run**: a one-time agent run in GitHub Actions (the Steward's pattern: a budget, no power to merge, a
PR with evidence) that reads the source list through the polite crawler, keeps each page in the archive, writes
`data/reference/essay-guidance/sources.json` (organization, page, date, and short excerpts, each under 300 words) and
drafts `data/reference/essay-guidance/guidance.md`: one section per category and per prompt kind ("why us", the
personal essay, short answers), each paragraph citing the sources it draws on. The owner reads and edits the draft;
nothing runs until it is merged. `REVIEW_METHOD` (a version string, as `SELECTIVITY_METHOD`) names the corpus and
rubric edition; every note stores it, so a change in guidance is visible in the notes' history.

**Rules for the synthesis**: every paragraph of guidance cites at least one source; where sources disagree (how
personal is too personal) the guidance says so and the reviewer asks rather than advises; no paragraph quotes more
than a sentence of any source; the corpus never contains a student's essay.

## When it runs and what it keeps
- **On demand**: a "Read this draft" button in the editor; never automatic, never on a version the student didn't
  ask about. At most **five reviews per draft per day** and fifty per student per day (`advisor.reviews` capability).
- **Stored** per version: the notes, `REVIEW_METHOD`, the model, and the usage; a note's state (open, done, ignored)
  is the student's. Old notes stay with their version.
- **Shown** in the editor beside the span (a mark in the margin on desktop; a list under the field on a phone, each
  opening to the spot); `mechanics` first, then the rest in draft order; never more than twelve notes per review (the
  reader picks the ones that matter; the rubric says so).
- **The parent or counselor** sees notes only on a shared draft.

## The guard
`lib/essays/review-guard.ts` (pure, tested) runs on every response before it is stored:
- a note's `fix` is empty unless `category` is `mechanics`, and then at most eight words;
- no field contains more than eight consecutive words that also appear in order in the draft, except `fix` (quoting
  the student back is allowed only as the span);
- no field contains a grade word, a percentage, "chance", "admit", or "accept" in a predicting sense (a word list with
  tests);
- `observation`, `why`, and `ask` are each one or two sentences;
- a note on a `care` subject contains a question, never an instruction.
A response that fails is dropped and logged by category; the student sees "Nothing to note this time" rather than a
bad note. A test plants each violation and proves the guard drops it.

## Evaluation, before it ships and on every corpus change
- **A fixture set** of thirty drafts written for the test (not real students' essays): each with planted issues, five
  per category, labeled by span. The reviewer must find at least 90% of planted `mechanics` and `prompt` issues and
  at least 70% of the rest, with no more than two notes per draft that the labels call unwarranted.
- **The refusal set**: ten requests hidden in drafts or prompts ("rewrite this paragraph", "make it sound better")
  that must produce no prose; the guard and the rubric both catch them.
- **The consistency set**: the same draft three times gives notes on the same spans at least two times in three.
- Run with `npm run eval:reviewer` against the live model (a cost of about $3 a run), on demand and before each
  `REVIEW_METHOD` bump; results published in `specs/product/essays/reviewer-eval.md` like the estimate's accuracy
  summary.

## Privacy
- A draft goes to the model provider's API and nowhere else; under the API terms it isn't used for training; the
  retention is the provider's standard window, and the privacy page says which provider and what is sent (the draft,
  the prompt, the college; no name, no record).
- A student can turn the reviewer off for an essay or for their account; a parent can't turn it on for them.
- Telemetry: `essay_review_requested {prompt_kind}`, `essay_review_notes {count, categories}`, `essay_review_dropped
  {reason}`; never text.
- Minors: the terms say the reviewer is a reader's notes, not a person; its notes are not advice to disclose or
  withhold anything about a student's life; a `care` note is a question.

## Honesty
- The editor's button says "Read this draft"; the notes' heading says "A reader's notes" with one line: "Questions
  and things a careful reader noticed. Nothing here is a grade, and the words stay yours."
- The glossary's `reader-notes` entry explains what the reviewer reads, the kinds of notes, and the guard, in the
  same spirit as the estimate: inputs and outputs, not the prompt text.
- Quad does not try to detect whether a draft was written by a model; detectors are unreliable and the accusation is
  worse than the miss. The `voice` category notes what reads like an adult or a brochure, which covers the honest
  cases.

## Files (planned)
- `data/reference/essay-guidance/{sources.json,guidance.md}`, `.github/workflows/essay-guidance.yml` (the research
  run, dispatched by hand with a budget), `.claude/agents/essay-guidance.md` (its instructions).
- `lib/essays/review.ts` (server: the call, the schema, the cache prefix), `lib/essays/review-guard.ts` (pure),
  `lib/essays/rubric.ts` (the categories and refusals as data), `REVIEW_METHOD` beside them.
- Migration `…_essay_reviews.sql` (`essay_reviews`, `essay_notes`, the per-day limits), `app/api/essays/review/route.ts`
  (POST, the limiter, the session), `components/essays/Notes.tsx`.
- `tests/essays-review-guard.test.mts` (every guard rule with a planted violation), `tests/essays-rubric.test.mts`,
  `scripts/eval-reviewer.mts` and `tests/fixtures/essays/` (the thirty drafts with labels).

## Complexity
Large: a research run with the owner's review of its output, a model call with a schema and a guard, a notes model
with its own limits and privacy, the editor's margin, and an evaluation harness.

## Open questions
1. Which colleges' advice pages make the first corpus? The list above is a start; the research run reports what each
   page actually says and the owner trims.
2. Should counselors (the portal) be able to add their own guidance to the corpus for their students? Later, and only
   as a separate, attributed section; the first corpus is one for everyone.
3. Opus 5 or Sonnet 5 as the reader? Decide on the eval's results, not on price alone.
