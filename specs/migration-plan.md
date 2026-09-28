# Migration Plan: Local -> Vercel + Supabase + College Scorecard API

This document tracks everything that needs to change when moving from local development to production.

## 1. Vercel Deployment

| Item | Current (Local) | Target (Vercel) | Files Affected |
|---|---|---|---|
| Hosting | `npm run dev` | ✅ Live at https://college-stats-nine.vercel.app (auto-deploy from GitHub) | No `vercel.json`; Node 24.x via `engines` |
| Env vars | `.env.local` | ✅ For now Production → dev project, Preview → JSON. Later Production → prod, `REVALIDATE_SECRET` | [supabase.md](supabase.md#setup-phase-3) |
| Build | `npm run build` | Vercel CI/CD | No code changes |
| Fresh data | Rebuild | ✅ `/api/revalidate` after each publish and each production deploy | `app/api/revalidate/route.ts`, `.github/workflows/publish-data.yml` |
| Domain | localhost:3000 | Custom domain or .vercel.app | Vercel dashboard |

**Changes needed:** Minimal. Next.js deploys to Vercel with zero config. The settings to enter are in
[supabase.md](supabase.md#setup-phase-3).

---

## 2. Supabase Database

Design, environments, keys and the phased transition are in [supabase.md](supabase.md). In short, `data/*.json`
stay in git as the reviewed source, `npm run publish-data` uploads them to Supabase, and `DATA_SOURCE=supabase`
makes the app read from there.

| Item | Current (Local) | Target (Supabase) | Files Affected |
|---|---|---|---|
| Data source | ✅ `DATA_SOURCE=json` (default) or `supabase` | `supabase` in Vercel | `lib/data.ts`, `lib/supabase.ts` |
| Data access | ✅ Async `getData()`, in-memory queries on either source | Same | `lib/dataset.ts`, pages, components |
| Auth | None | Supabase Auth (when accounts are built) | New files |
| Env vars | ✅ `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (`.env.example`) | Vercel: URL + publishable key | `.env.local` |

### Code
- [x] Install `@supabase/supabase-js`
- [x] Supabase client and dataset reader in `lib/supabase.ts`
- [x] Query functions in `lib/dataset.ts` (`createDataset`), loaded by `getData()` in `lib/data.ts`
- [x] Pages and components `await getData()`; insight functions take the dataset as their first argument
- [x] `npm run publish-data`: lineage check, shrink guard, one-transaction publish, exact read-back

### Database schema
- [x] `schools`, `dataset_files`, `dataset_publishes` with RLS, and `publish_dataset()`
  (`supabase/migrations/20260928000000_dataset.sql`)
- [x] Apply to the dev project and publish (phase 1 in [supabase.md](supabase.md#transition-plan))
- [ ] Prod project created and migrated (deferred 2026-09-28; Production reads dev until then)
- [x] Publish on merge (`.github/workflows/publish-data.yml`), on-demand revalidation (`/api/revalidate`), and a
  per-request version check so no instance renders an older publish (phase 3; [supabase.md](supabase.md#revalidation))
- [x] Vercel deployed and verified against the dev project ([current state](supabase.md#current-state-production-reads-dev))
- [ ] First prod publish (`npm run publish-data:prod`), point Vercel Production at prod, GitHub secrets
  ([setup](supabase.md#setup-phase-3))

---

## 3. College Scorecard API Integration

| Item | Current (Local) | Target (API) | Files Affected |
|---|---|---|---|
| Data source | ✅ `data/schools.json` from Scorecard + IPEDS | Same files, published to Supabase | `scripts/sync-data.mts`, `scripts/publish-data.mts` |
| API key | ✅ `COLLEGE_SCORECARD_API_KEY` in `.env.local` | Same, in Vercel env vars | `.env.local` |
| Data freshness | Manual `npm run sync-data` | Scheduled sync (weekly/monthly) | Vercel Cron or GitHub Action |

### Steps (see [data-sync.md](data-sync.md)):
- [x] Get API key from https://api.data.gov/signup/
- [x] Scorecard client in `scripts/sync-data.mts` (field mapping, 100/page pagination, retry with backoff on 429/5xx)
- [x] Add IPEDS Admissions (ADM) bulk file as second source for counts, scores, submission rates
- [x] Manual overrides layer (`data/overrides.json`)
- [x] Write `data/schools.json` and log stats (with rate, with SAT, skipped)
- [x] Publish to Supabase from the JSON files (`npm run publish-data`); the sync keeps writing JSON for review
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
| `lib/data.ts` | ✅ Loader: JSON or Supabase (`DATA_SOURCE`) | High |
| `lib/dataset.ts`, `lib/supabase.ts` | ✅ New | High |
| `scripts/publish-data.mts`, `supabase/migrations/` | ✅ New | High |
| `scripts/sync-data.mts` | ✅ Unchanged: writes JSON, which is then published | High |
| Pages and data-reading components | ✅ `await getData()` | Medium |
| `.env.local` | Add Supabase keys ([supabase.md](supabase.md#keys)) | High |
| `app/api/revalidate/route.ts`, `lib/revalidate.ts`, `lib/dataset-loader.ts` | ✅ New: revalidation and version check | Medium |
| `.github/workflows/publish-data.yml` | ✅ New: publish to prod on merge, revalidate after deploys | Medium |
