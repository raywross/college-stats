---
name: build-roadmap-section
description: How to build a section of the roadmap (a group in lib/roadmap.ts, such as "National trends", or several of its specs). Use whenever the user asks to build, implement, or "get started on" a roadmap section, group, wave, or body of work. Reads every spec, writes a plan, splits it into units handed to subagents on sub-branches with a model picked per unit, then merges, verifies, and opens one PR.
---

# Building a roadmap section

The owner's standing instruction (2026-10-04): a roadmap section is never built in one long serial session. Read the
specs, plan, split the plan into units of work, give each unit to a subagent on its own sub-branch with a model that
fits its complexity, and integrate the results. This is how data waves 2–3, the profile redesign, CDS round 3, and
campus life were built; this file records the method so every session does it the same way.

## 1. Read before planning
- Every spec in the group (`lib/roadmap.ts`: entries with that `group`), the hub or README they hang off, and every spec
  they link to for data or design (data-lineage, charts, mobile, design-system as relevant).
- The code each spec names: registries, builders, loaders, components it reuses. Note what exists and what is new.
- The memory index for lessons from earlier builds (wave 2, wave 3, profile, CDS round 3, campus life).
- Each spec's own "Build order" and open questions. Spec recommendations are the default answer to open questions;
  record each one you adopt as an owner assumption for the PR description, and only stop to ask when a question
  changes what gets built and the spec gives no recommendation.

## 2. Write the plan
Write it to the session scratchpad as `brief.md`, the shared brief every agent reads first. It holds:
- **Shared contracts**: types, file names, function signatures, output file shapes, and route names that more than one
  unit touches, decided up front so parallel agents don't invent conflicting ones.
- **Units**: one per spec or per natural seam (data/build step, page, component). For each: goal, spec sections, files
  it owns, files it may touch only additively (registries), tests it must add, and done criteria.
- **Waves**: a foundation unit first when later units share infrastructure; then independent units in parallel; then
  units that depend on those. Give units disjoint files wherever possible.
- **Model per unit** (rubric below) and **branch per unit**.
- **Owner assumptions** adopted from spec recommendations.

Tell the user the plan in a short table (unit, model, wave, branch), then start; don't wait for approval unless they
asked to review the plan first.

### Picking a model
| Model | Use for |
|---|---|
| `opus` | Foundation and shared infrastructure; new pipelines or build steps; anything with judgment-heavy rules (exclusion lists, panels, data correctness); merge resolution when it isn't mechanical |
| `sonnet` | A unit that follows a pattern the foundation established (one more study, page, card, or list from a template); UI with a clear spec |
| `haiku` | Mechanical chores: copy edits across files, registry entries, renames, screenshot runs from a ready script |

When unsure between two, pick the stronger one for anything that writes data other pages read.

## 3. Branches and worktrees
- **Integration branch** `feature/<section>` in my own worktree (EnterWorktree, then `git branch -m`). I own it; agents
  never commit to it.
- **Unit branches** `feature/<section>-<unit>`. Spawn every unit agent with `isolation: "worktree"` (agents can't run
  git in worktrees made by hand). Their worktree branches from `origin/main`, so each agent first renames its branch,
  then merges the integration branch (`git merge feature/<section>`) to pick up the foundation, and copies
  `.env.local` (and `.cache/` when the unit downloads source files) from my worktree.
- Commit the integration branch before spawning so agents can merge it; push it if they need it from origin.

## 4. The agent prompt
Each agent gets: the path to `brief.md`, its unit section, the spec files to read, the files it owns, and these rules:
- Run `npm ci` first; start any dev server on a free port and stop it before finishing.
- Follow the repo's conventions (CLAUDE.md, data lineage, glossary terms for every term, mobile rules, charts spec).
- Add tests for its unit; prove each new guard fails when its rule is broken.
- Run `npm run verify` and fix everything before the final commit; commit on its own branch; don't push, open PRs, or
  touch `lib/roadmap.ts` statuses, release notes, or other units' files.
- Keep shell commands simple (one git command per call; no `;`-chained git, loops, or heredocs naming git).
- Stop every background process it started.
- Report: branch, commits, files changed, decisions it made that the brief didn't cover, anything left undone.

Run agents in the background; launch a whole wave in one message.

## 5. Integrate
- Merge each finished unit into the integration branch with `git merge --no-ff`, in dependency order. Shared
  registries (`lib/types.ts`, `lib/fields.ts`, `lib/glossary.ts`, build scripts) conflict every time: keep both sides,
  then check brace depth and that members stayed inside their interface. Generated data: take one side, regenerate.
- After each merge run `npm run verify`. When a wave is merged, commit, then launch the next wave (its agents merge
  the updated integration branch).
- Rebuild generated data once after all merges, then run `npm run verify` and `npx next build`. The full rebuild has
  found real bugs every time.
- Browser QA with Playwright from the scratchpad (desktop and 390 px phone; wait for chart animations) on the new
  pages. A `sonnet` agent can run it from a ready script.
- Remove stale agent worktrees' background processes; leave the worktrees for the user to clean up.

## 6. Finish
- Mark built specs `> Status: **built** <date>` and remove their `lib/roadmap.ts` entries (and an emptied group:
  the roadmap test forbids empty groups); drop built slugs from other entries' `after`.
- One release note for the section (`release-notes/<branch-without-prefix>.md`), written for readers.
- Open one PR into `main`, listing the units, their branches and models, owner assumptions, and what the user should
  check by hand. Before merging (only after the user approves): merge `origin/main`, re-run tests, let CI rerun.
- Save a memory for the build: branches, decisions, and lessons for the next section.
