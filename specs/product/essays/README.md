# Essays: The Prompts, the Workspace, and a Reader's Notes

> Overview of the essay specs (not a work item itself). Written 2026-10-28 from the owner's brief: the site knows almost
> nothing about what colleges ask students to write; Quad should hold the prompts, give students "a very easy to use
> editor" that works with Google Docs and Word and across desktop and phones, and offer "something agentic that will
> suggest improvements and spot things like typos or run-ons, but where we're giving advice, not rewriting," with
> guidance "honed" from research into public sources. Each part below is a separate work item on the
> [roadmap](../../roadmap.md), group "Essays".

## Why
Writing is the part of applying that families underestimate most. The Common App's personal essay is one piece; the
supplements are the rest: a list of fifteen colleges asks for a dozen more essays and short answers, each with its own
prompt and limit, most of them "why us" in some costume. Today the site shows one yes/no column from the Requirements
Grid, which this cycle's grid leaves blank, so a student's advisor can say nothing about the writing ahead. Students
draft in Google Docs or Notes, lose track of which draft went where, and paste into the form at the deadline.

Quad can be the workspace up to the button: every prompt the student's colleges publish, one draft per prompt with
versions and word counts, the same essay reused where several colleges ask the same thing, a round trip with the
tools students already write in, a package per college when it is time to paste, and a reader who marks what a
careful adult would mark, without writing a word of it. The submission stays in the student's hands, in the real form:
there is no API to submit for a student on Common App, the Coalition, or a college's own form, a robot that fills
those forms is a bot under their terms, and the student signs an affirmation that the work and the submission are
their own ([../../data-expansion/coalition-app.md](../../data-expansion/coalition-app.md) records the search for an API).

## The parts
| Part | Spec | Adds | Complexity |
|---|---|---|---|
| 1 | [prompts.md](prompts.md) | Every supplemental essay and short-answer prompt a college publishes, with its limit and whether it is required, read from the college's own site by the college-reported agent, quoted and cited; the Common App's and the Coalition's own prompts; a line on the "What it takes to apply" card and a count across the plan | Medium |
| 2 | [workspace.md](workspace.md) | The editor: plain text, autosave, versions, a count against each prompt's limit, built for a phone first; one draft reused across prompts; Word and Google Docs round trips by download and upload, then a Google Drive connection; a per-college package to paste from; sharing a draft with a parent or counselor for comments | Large |
| 3 | [reviewer.md](reviewer.md) | A reader's notes on a draft, on demand: typos, run-ons, a sentence that doesn't answer the prompt, a claim without a detail, an opening that starts too far back; each note a question or an observation, never a rewrite; the rules behind it written from public guidance by admissions offices and writing centers, cited, versioned, and reviewed by the owner before they run | Large |

## Design principles
In addition to the planner's ([../../planner/README.md](../../planner/README.md)) and Plan v3's
([../../planner/v3/README.md](../../planner/v3/README.md#design-principles)):
1. **The student's own words, always.** Quad never writes a sentence of a student's essay: not a rewrite, not a
   "stronger version", not a first draft. The reviewer's notes are questions and observations; its only proposed text
   is a corrected word. This is a product rule and a guard test, not a tone.
2. **Quad is the workspace; the platform is the signature.** Everything up to the button happens here; the submission
   happens in the real form, by the student.
3. **Prompts as the college publishes them.** Every prompt is quoted from the college's own page with the page and the
   date, and the card says the application may ask a few short questions beyond the published ones.
4. **A phone is the first screen.** Students write on phones and in Notes; the editor is a big plain text field with a
   count, no toolbar, and the draft is never lost.
5. **The student decides who reads.** A draft is the student's: a parent or counselor sees it when the student shares
   it, as the story is today (owner, 2026-10-16); the reviewer runs when the student asks, never on its own.
6. **Nothing is graded.** No score for an essay, no "strong" or "weak", no prediction. A note names a thing a reader
   noticed and why it matters.

## Build order
```
prompts ─► workspace (editor, versions, download/upload, package) ─► reviewer (the guidance corpus first, then the notes)
                └─► Google Drive connection (after Google sign-in exists, specs/backlog.md "Platform")
```
The prompts are useful the day they land (the card, the count). The workspace needs them for its "which prompt" picker
but works with the Common App's main essay alone. The reviewer needs the workspace and the corpus research, which is
its own unit of work before any model runs.

## Where it shows
- **The college's admissions page**: the prompts under "What it takes to apply".
- **The plan**: "Your list asks for 14 essays and short answers" on the Colleges tab; a **Write your essays** move from
  the summer before senior year ([../../planner/record/ranking.md](../../planner/record/ranking.md) ranks the summer's
  writing already), opening the workspace.
- **`/advisor/essays`**: the workspace, with one page per draft and a package per college.
- **The parent's view**: the drafts the student shared, with comments; counts for the rest.

## Tier
Part of Quad Advisor ([../commercialization.md](../commercialization.md#feature-map)): the prompts are public facts and
show on every college's page free; the workspace and the reviewer are the advisor's. The reviewer has a daily cap per
essay, since each review is a model call.
