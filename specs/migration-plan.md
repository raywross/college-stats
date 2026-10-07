# Migration Plan: Local -> Vercel + Supabase + College Scorecard API

This document tracks everything that needs to change when moving from local development to production.

## 1. Vercel Deployment

| Item | Current (Local) | Target (Vercel) | Files Affected |
|---|---|---|---|
| Hosting | `npm run dev` | ✅ Pre-release dev site at https://college-stats-nine.vercel.app (auto-deploy from GitHub) | `vercel.json` holds only the digest cron; Node 24.x via `engines`; the serving path changes per [serving-architecture.md](serving-architecture.md) |
| Env vars | `.env.local` | ✅ Pre-release: Production → dev project for accounts and high schools. At the formal release: Production → prod | [supabase.md](supabase.md#setup-at-the-formal-release) |
| Build | `npm run build` | Vercel CI/CD; the build reads only the repo's files | No code changes |
| Fresh data | Rebuild | ✅ Every data merge deploys; the deploy carries the data (since 2026-10-07) | [serving-architecture.md](serving-architecture.md) |
| Domain | localhost:3000 | Custom domain or .vercel.app | Vercel dashboard |

**Changes needed:** Minimal. Next.js deploys to Vercel with zero config. The settings to enter are in
[supabase.md](supabase.md#setup-at-the-formal-release).

---

## 2. Supabase Database

Design, environments and keys are in [supabase.md](supabase.md). In short, `data/*.json` stay in git as the
reviewed source and ship with every deploy; Supabase holds people's data, the high-school table, and the change log
([serving-architecture.md](serving-architecture.md), 2026-10-07).

| Item | Current (Local) | Target | Files Affected |
|---|---|---|---|
| College data | ✅ `data/*.json` read from disk once per instance | Same (traced into every function) | `lib/data.ts`, `next.config.ts` |
| Data access | ✅ Async `getData()`, in-memory queries | Same | `lib/dataset.ts`, pages, components |
| High schools | ✅ `HIGH_SCHOOLS_SOURCE`: the table when keys are set, else the files | The table | `lib/high-schools.ts` |
| Auth | ✅ Supabase Auth | Same | [accounts.md](product/accounts.md) |
| Env vars | ✅ `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (`.env.example`) | Vercel: URL + publishable key | `.env.local` |

### Code
- [x] Install `@supabase/supabase-js`
- [x] Query functions in `lib/dataset.ts` (`createDataset`), loaded by `getData()` in `lib/data.ts`
- [x] Pages and components `await getData()`; insight functions take the dataset as their first argument
- [x] `npm run publish-changes` (the change log after each deploy) and `npm run publish-high-schools`
- [x] The dataset tables and `npm run publish-data` retired (2026-10-07)

### Database schema
- [x] `dataset_publishes`, `dataset_changes`, `publish_changes()`; the high-school tables; the user tables
- [ ] Prod project created and migrated (at the formal release; [backlog.md](backlog.md#platform))
- [x] Vercel deployed against the dev project ([current state](supabase.md#current-state-pre-release-dev-only))
- [ ] Point Vercel Production at prod, GitHub secrets ([setup](supabase.md#setup-at-the-formal-release))

---

## 3. College Scorecard API Integration

| Item | Current (Local) | Target (API) | Files Affected |
|---|---|---|---|
| Data source | ✅ `data/schools.json` from Scorecard + IPEDS | Same files, deployed with the site | `scripts/sync-data.mts` |
| API key | ✅ `COLLEGE_SCORECARD_API_KEY` in `.env.local` | Same, in Vercel env vars | `.env.local` |
| Data freshness | Manual `npm run sync-data` | Scheduled sync (weekly/monthly) | Vercel Cron or GitHub Action |

### Steps (see [data-sync.md](data-sync.md)):
- [x] Get API key from https://api.data.gov/signup/
- [x] Scorecard client in `scripts/sync-data.mts` (field mapping, 100/page pagination, retry with backoff on 429/5xx)
- [x] Add IPEDS Admissions (ADM) bulk file as second source for counts, scores, submission rates
- [x] Manual overrides layer (`data/overrides.json`)
- [x] Write `data/schools.json` and log stats (with rate, with SAT, skipped)
- [x] The sync writes JSON for review; a merge deploys it (no publish step since 2026-10-07)
- [ ] Set up Vercel Cron or GitHub Action for periodic sync

### Field mapping
The authoritative mapping is `toSchool()` in `scripts/sync-data.mts`; [data-sync.md](data-sync.md) lists which
source supplies each field.

---

## 4. CDS Data Integration (Phase 2)

- [ ] Build PDF parser for Common Data Set documents
- [ ] Extract Section C7 (admissions factors importance)
- [ ] Extract Section B (enrollment demographics, Pell details)
- [ ] Store in Supabase `cds_data` table linked to `schools`
- [ ] Add admissions factors visualization to school profile

---

## Summary: Files That Will Change

| File | Change Type | Priority |
|---|---|---|
| `lib/data.ts` | ✅ Loader: the files on disk, once per instance | High |
| `lib/dataset.ts`, `lib/supabase.ts` | ✅ Queries; the Supabase client and change-log reader | High |
| `scripts/publish-changes.mts`, `scripts/publish-high-schools.mts`, `supabase/migrations/` | ✅ The change log and the high-school table | High |
| `scripts/sync-data.mts` | ✅ Unchanged: writes JSON, which a merge deploys | High |
| Pages and data-reading components | ✅ `await getData()` | Medium |
| `.env.local` | Add Supabase keys ([supabase.md](supabase.md#keys)) | High |
| `app/api/revalidate/route.ts`, `lib/revalidate.ts` | ✅ Manual revalidation (unused in the normal path) | Low |
| `.github/workflows/publish-changes.yml` | ✅ Record changes after each production deploy; publish high schools on their merges | Medium |
