@AGENTS.md

# College Stats - Project Memory

## Project Overview
Higher Education Data Explorer - an interactive web app for visualizing U.S. college admissions, demographic, and financial data.

## Key Conventions

### Documentation
- **Always maintain markdown documentation** for features and functions
- Documentation lives in the `specs/` folder, organized by functionality
- Keep files focused and manageable in size - split by feature area
- Update specs when features change

### Data lineage (see `specs/data-lineage.md`)
- Every value must trace to its source and year. Register new stored or derived fields in `lib/fields.ts`; cite
  displayed values with `citeField(path, school)` (`MetricLabel cited=…`) and list them in the section's `fields`
- Never hard-code data years ("Fall 2024", "2023–24") or read `meta.sources`/`vintages` directly in UI code; years
  come from lineage so they update with each release
- Overrides (the `overrides.legacy` layer, applied last by the publisher's compose) must declare their source (`cds`
  or `_lineage`)
- Run `npm run verify` (typecheck, lint, tests incl. lineage guards, dataset lineage check) before committing; CI runs
  it plus `next build`

### Quad's estimate is proprietary (see `specs/chances/README.md`)
- How Quad computes a college's level (Reach / Target / Likely today; High reach / Reach / Target / Likely / Safe once
  `specs/chances/levels.md` ships) is never shown on the site: pages, the glossary, release notes, and the
  estimate's API responses describe its kinds of inputs and its outputs, not weights, thresholds, or rules
- Until launch the method lives here, in `specs/chances/method/` and server-only code (`lib/chances/model.ts`); the
  repository stays public for now (owner decision, 2026-10-10). At launch it moves to a private repository per the
  checklist in `specs/chances/estimate.md`
- The estimate runs on the server only, through `lib/chances/estimate.ts`, and its sentences come from the note catalog

### One worktree per session
Several Claude chats work on this repo at once, so each works in its own git worktree, never in the main checkout
(where one chat could switch branches or edit files under another).
- **Before changing anything** (editing files, creating a branch, committing), call `EnterWorktree` with a short name
  for the task. It creates `.claude/worktrees/<name>/` on a new branch from `origin/main`. Rename the branch to the
  repo's convention right away: `git branch -m feature/<name>` (or `docs/`, `data/`, `chore/`)
- Reading, searching, and read-only git (`status`, `log`, `diff`, `fetch`) are fine from the main checkout
- In a new worktree, run `npm ci` before building or testing. `.env.local` is copied in automatically (`.worktreeinclude`)
- Keep shell commands simple (one git command per call): Claude Code refuses commands in a worktree session when it
  can't verify they stay inside the worktree
- Finish with a PR and merge as usual; the main checkout's branch never needs to change. A SessionStart hook
  (`.claude/hooks/sync-main.mjs`) fetches and fast-forwards the main checkout when it's clean and on `main`, so each new
  session starts from the latest merged code and rules; `git pull --ff-only` is also allowed there
- Enforced by `.claude/hooks/require-worktree.mjs` (PreToolUse; tested in `tests/require-worktree.test.mts`): edits
  and branch-changing git in the main checkout are blocked. To override for one session, start Claude Code with
  `CLAUDE_ALLOW_MAIN_CHECKOUT=1`

### Building a roadmap section
- When asked to build a roadmap section (a `lib/roadmap.ts` group, wave, or several specs), follow the
  `build-roadmap-section` skill (`.claude/skills/build-roadmap-section/SKILL.md`): read every spec, write a plan, split
  it into units run by subagents on `feature/<section>-<unit>` sub-branches with a model chosen per unit, then merge into
  `feature/<section>`, verify, and open one PR

### Release notes (see `specs/release-notes.md`)
- **Every PR into `main` adds a release note**: `release-notes/<branch-name-without-prefix>.md`, with frontmatter
  `title`, `pr`, `date` (merge day), `kind` (`feature`, `improvement`, `data`, `fix`, `plans`, `infra`), and a
  one-sentence `summary`. It appears on `/release-notes` with no other registration
- Write it for readers of the site, not reviewers: plain-language "What's new" first, then "Behind the scenes"
- Open the PR first to get its number, then commit the note and push. CI's `release-note` job fails a PR without a
  note naming its own number

### Commands
- **"start the server"**: each worktree runs its own dev server on its own port; never kill another session's server.
  Stop a dev server this worktree started earlier, then run `npm run dev -- -p <port>` in the background with the
  first free port from 3000 up (`lsof -ti:<port>` prints nothing), and report the URL.

### Tech Stack
- Next.js 14 (App Router) with TypeScript
- Tailwind CSS + shadcn/ui
- Custom SVG/CSS chart components in `components/charts/` (see `specs/charts.md`)
- Data: the college dataset (~1,900 4-year colleges) is a published snapshot in Supabase Storage, not a file in this
  repository. `npm run fetch-snapshot -- --ensure` (run by `postinstall`) puts the bundled copy under
  `.data/snapshot/`; with nothing configured it copies the mini test fixture instead. The pipelines (`npm run
  sync-data` and the rest) write layers to the data store, and a publisher composes and uploads the snapshot; see
  `specs/data-platform/README.md`. Add a college's Common Data Set with `npm run import-cds`, which writes through
  the store (see `specs/sources-and-citations.md`); cite any new data with `<SourceNote>`

### Supabase and deployment
- The dataset no longer ships in git: Supabase is the source of truth (versioned layers written by the pipelines), a
  publisher composes and uploads a snapshot to Storage, and the deploy carries a bundled copy fetched at build time
  (`.data/snapshot/`, written by `npm run fetch-snapshot`). `lib/data.ts` reads that bundled copy, or the live
  snapshot once `DATA_SNAPSHOT_URL` is set, and hot-swaps to a newer snapshot without a redeploy; the search boxes
  still match in the browser over `/search-index.json`. Supabase also holds people's data, the high-school table
  (`HIGH_SCHOOLS_SOURCE=supabase|json`), and the change log that's recorded after each publish. See
  `specs/data-platform/README.md`, `specs/serving-architecture.md`, and `specs/supabase.md`. Two Supabase projects
  are planned: dev (now, for everything) and prod (at the formal release)
- Schema changes are new files in `supabase/migrations/`, applied to dev before prod
- Will deploy to Vercel; see `specs/migration-plan.md`

### Code Style
- TypeScript strict mode
- Functional React components
- Data access: `const data = await getData()` from `lib/data.ts`, then destructure queries (`lib/dataset.ts`); never
  read `data/` or `.data/` directly in app code
