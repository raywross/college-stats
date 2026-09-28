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
- Overrides in `data/overrides.json` must declare their source (`cds` or `_lineage`)
- Run `npm run verify` (typecheck, lint, tests incl. lineage guards, dataset lineage check) before committing; CI runs
  it plus `next build`

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

### Commands
- **"start the server"**: each worktree runs its own dev server on its own port; never kill another session's server.
  Stop a dev server this worktree started earlier, then run `npm run dev -- -p <port>` in the background with the
  first free port from 3000 up (`lsof -ti:<port>` prints nothing), and report the URL.

### Tech Stack
- Next.js 14 (App Router) with TypeScript
- Tailwind CSS + shadcn/ui
- Custom SVG/CSS chart components in `components/charts/` (see `specs/charts.md`)
- Data: `data/schools.json` (~1,900 4-year colleges) built by `npm run sync-data` from College Scorecard + IPEDS; see `specs/data-sync.md`. API key lives in `.env.local` (git-ignored). Add a college's Common Data Set with `npm run import-cds` (see `specs/sources-and-citations.md`); cite any new data with `<SourceNote>`

### Future Migration
- Will deploy to Vercel with Supabase database
- Will integrate College Scorecard API (needs API key from api.data.gov)
- See `specs/migration-plan.md` for all changes needed

### Code Style
- TypeScript strict mode
- Functional React components
- Data access abstracted through `lib/data.ts` for easy DB swap later
