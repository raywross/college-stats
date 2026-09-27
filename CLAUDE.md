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

### Commands
- **"start the server"**: Kill any running dev server (`lsof -ti:3000 | xargs kill -9`), then run `npm run dev` in the background.

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
