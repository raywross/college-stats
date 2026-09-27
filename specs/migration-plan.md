# Migration Plan: Local -> Vercel + Supabase + College Scorecard API

This document tracks everything that needs to change when moving from local development to production.

## 1. Vercel Deployment

| Item | Current (Local) | Target (Vercel) | Files Affected |
|---|---|---|---|
| Hosting | `npm run dev` | Vercel auto-deploy from GitHub | `vercel.json` (if needed) |
| Env vars | `.env.local` | Vercel dashboard env vars | No code changes |
| Build | `npm run build` | Vercel CI/CD | No code changes |
| Domain | localhost:3000 | Custom domain or .vercel.app | Vercel dashboard |

**Changes needed:** Minimal. Next.js deploys to Vercel with zero config.

---

## 2. Supabase Database

| Item | Current (Local) | Target (Supabase) | Files Affected |
|---|---|---|---|
| Data source | `data/sample-schools.json` | Supabase PostgreSQL | `lib/data.ts` |
| Data access | Sync JSON read + in-memory filter | Async Supabase queries | `lib/data.ts`, all pages |
| Auth | None | Supabase Auth (optional) | New files |
| Env vars | None | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `.env.local` |

### Changes needed in `lib/data.ts`:
- [ ] Install `@supabase/supabase-js`
- [ ] Create Supabase client in `lib/supabase.ts`
- [ ] Convert `getSchools()` to async Supabase query with filters
- [ ] Convert `getSchoolById()` to async Supabase query
- [ ] Convert `getSchoolsByIds()` to async Supabase query
- [ ] Update all page components to `await` data functions

### Database schema:
- [ ] Create `schools` table matching `School` TypeScript type
- [ ] Create indexes on `state`, `acceptance_rate`, `name`
- [ ] Write seed script to import sample data
- [ ] Write import script for College Scorecard bulk data

---

## 3. College Scorecard API Integration

| Item | Current (Local) | Target (API) | Files Affected |
|---|---|---|---|
| Data source | ✅ `data/schools.json` from Scorecard + IPEDS | Supabase table, same sync | `scripts/sync-data.mts`, `lib/data.ts` |
| API key | ✅ `COLLEGE_SCORECARD_API_KEY` in `.env.local` | Same, in Vercel env vars | `.env.local` |
| Data freshness | Manual `npm run sync-data` | Scheduled sync (weekly/monthly) | Vercel Cron or GitHub Action |

### Steps (see [data-sync.md](data-sync.md)):
- [x] Get API key from https://api.data.gov/signup/
- [x] Scorecard client in `scripts/sync-data.mts` (field mapping, 100/page pagination, retry with backoff on 429/5xx)
- [x] Add IPEDS Admissions (ADM) bulk file as second source for counts, scores, submission rates
- [x] Manual overrides layer (`data/overrides.json`)
- [x] Write `data/schools.json` and log stats (with rate, with SAT, skipped)
- [ ] Upsert into Supabase `schools` table instead of the JSON file
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
| `lib/data.ts` | Major rewrite (JSON -> Supabase) | High |
| `lib/supabase.ts` | New file | High |
| `scripts/sync-data.mts` | ✅ Done (writes JSON; switch output to Supabase upsert) | High |
| `app/page.tsx` | Add `await` to data calls | Medium |
| `app/schools/[id]/page.tsx` | Add `await` to data calls | Medium |
| `app/compare/page.tsx` | Add `await` to data calls | Medium |
| `.env.local` | Add Supabase + API keys | High |
