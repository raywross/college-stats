# Student Profile: Your Numbers

> Status: **planned**, built (2026-10-05, [below](#built-2026-10-05)): the form on `/me`, GPA normalization, a
> completeness meter, signed-out localStorage with a one-time import offer, ScoreChecker and Compare "You" markers,
> and Explore's `fit=` chips. Hooks (first-gen, legacy, Pell-likely) were left off the form per the open question
> below. Kept as "planned" here (not "built") so `lib/roadmap.ts` — which still lists this spec — and
> `tests/roadmap.test.mts` stay in sync; the lead flips this to "built" and removes the roadmap entry when
> integrating every accounts unit, the same way [accounts.md](accounts.md) did for its own foundation. After
> [accounts.md](accounts.md). Read by [chances-and-fit.md](chances-and-fit.md),
> [saved-lists.md](saved-lists.md), [net-price-estimator.md](net-price-estimator.md), and
> [scattergrams.md](scattergrams.md). Part of [product](README.md).

## Goal
One place for a student's own numbers and preferences, entered once and read everywhere: the profile's
`ScoreChecker` is prefilled, Explore can filter to "colleges where my scores are in the middle 50%", the net price
estimator knows the state of residence, and chances use the GPA. Today `ScoreChecker` asks for a score on every
profile and forgets it.

## Fields
| Group | Fields | Used by |
|---|---|---|
| **Basics** | graduation year; state of residence (including "Outside the U.S."); high school (NCES id, from [high-school-data.md](high-school-data.md); free text until then) | residency pricing, in-state rules, scattergrams, the admit rate for you ([cds-residency-admissions.md](../data-expansion/cds-residency-admissions.md): the profile card's "(you)" marker, Compare's "Acceptance rate for you", chances' base rate) |
| **Academics** | unweighted GPA (0–4.0) and the scale it's on (4.0, 5.0, 100-point) with a weighted GPA optional; class rank (percentile) optional; course rigor (count of AP/IB/dual-enrollment courses) optional | chances (GPA bands from [cds-admissions.md](../data-expansion/cds-admissions.md)) |
| **Tests** | SAT total and sections; ACT composite and sections; superscore flag; "I plan to apply test-optional" | ScoreChecker, Explore fit filter, chances |
| **Plans** | intended majors (up to 3, 2-digit CIP families from [majors.md](../data-expansion/majors.md)); early round interest (ED / EA / none) | majors and earnings-by-major views, [early-decision-strategy.md](early-decision-strategy.md) |
| **Preferences** | size buckets, setting (city / suburb / town / rural, from [campus-profile.md](../data-expansion/campus-profile.md)), regions or states, max average cost, type | "Fits you" filter and fit score ([chances-and-fit.md](chances-and-fit.md#fit)) |
| **Hooks** (optional, private by default) | first-generation; legacy at specific colleges; recruited athlete; Pell-likely | Chances wording only ("Colleges that consider legacy status: …"), never shown to guardians unless the student allows |

**GPA normalization.** Weighted scales differ by high school, so chances use the **unweighted 4.0 GPA** only. A
100-point or 5.0 GPA is converted with the student's scale and shown back as "about 3.7 unweighted (from 93/100)".
When [high-school-data.md](high-school-data.md) has the school's own scale, that conversion is used and cited.

## Behavior
- Works signed out: stored in `localStorage` under one key (`student-profile`), imported on sign-in
  ([accounts.md](accounts.md#sign-in)).
- Signed in: one row per `students.id` in `student_profiles` (`jsonb` for the groups above, plus `updated_at`).
  Guardians read it; they can edit when `can_edit` ([accounts.md](accounts.md#privacy-model)).
- A **completeness meter** on `/me` lists what each tool needs ("Add a GPA to see where you stand").
- Every tool shows which profile values it used, the way citations show sources: "Using your SAT 1450 and GPA 3.8
  (edit)".
- Numbers from the profile are **never** sent to analytics ([telemetry.md](telemetry.md#privacy)); only "profile
  has GPA: yes/no" style flags.

## Display
- `/me`: the profile form (grouped, each group collapsible), the completeness meter, links to lists and tools.
- **Profile pages:** the "Where would you land?" block uses the saved scores with a "You" marker and the verdict
  copy already written for `ScoreChecker`; a `GpaChecker` appears when the college has CDS GPA bands.
- **Explore:** a "Fits my scores" chip (`fit=scores`: colleges whose SAT or ACT middle 50% contains the student's
  score, or that are test-blind), and "Fits my preferences" (`fit=prefs`). Both are URL params like other filters
  and resolve server-side from the profile, so links stay shareable only for the same signed-in student (for anyone
  else they're ignored with a note).
- **Compare:** a "You" column in Test scores when the profile has scores.

## Files (planned)
- `lib/student-profile.ts` (types, GPA conversion, validation; pure, tested), `app/me/page.tsx`,
  `components/me/ProfileForm.tsx`, migration `…_student_profiles.sql`.
- `tests/student-profile.test.mts`: GPA conversions, fit filters with missing data (a college without SAT ranges is
  neither in nor out of "fits my scores"; test-blind counts as in).

## Open questions
1. Should the profile allow more than one "scenario" (e.g. "if I retake the SAT")? Recommendation: not in v1.
2. Hooks are sensitive; keep them off the form until chances can use them well.

## Built (2026-10-05)
Unit C of the accounts build (`feature/accounts-profile`, merged `feature/accounts` with units A/B/D already in it).

### Contracts (what later work uses)
| File | Exports |
|---|---|
| `lib/student-profile.ts` (pure) | `StudentProfileData` and its five group types (`StudentProfileBasics`, `StudentProfileAcademics`, `StudentProfileTests`, `StudentProfilePlans`, `StudentProfilePreferences`); `emptyProfile()`, `sanitizeProfile(input)` (never throws; drops invalid/out-of-range fields rather than coercing to 0 or clamping); `unweightedGpa4(gpa, scale)`, `gpaDisplay(academics)`; `completeness(data)` → `CompletenessItem[]`, `completenessScore(data)`; **`fitsScores(school, profile): Fit`**, **`fitsPreferences(school, profile): Fit`** where `Fit = "in" \| "out" \| "unknown"` (see the `Fit` doc comment for exactly what "unknown" means and why Explore's chips drop it along with "out"); `OUTSIDE_US`, `LOCAL_PROFILE_KEY`, `GPA_SCALES`, `MAX_INTENDED_MAJORS` |
| `lib/student-profile-store.ts` (`"use server"`) | `profilesICanSee(): Promise<ProfileAccess[]>` (every student the signed-in user can see, each with `{student, relation, canEdit, data, saved}`), `profileFor(studentId)`, `myOwnProfile()` (the signed-in user's own, not one they see as a guardian), `myScores(): Promise<MyScores>` (the minimal `{signedIn, satTotal, actComposite, plansTestOptional}` ScoreChecker/Compare prefill from), `saveProfile(studentId, raw)`, `importLocalProfile(studentId, localRaw)` (fills blanks only, never overwrites a saved value) |
| `app/me/actions.ts` (`"use server"`) | `saveStudentProfile` and `importLocalProfileAction`, the `useActionState` actions `components/me/ProfileForm.tsx` and `ImportLocalProfile.tsx` call; FormData ↔ `StudentProfileData` mapping lives here, not in the store module |
| `components/me/useLocalProfile.ts` | `useLocalProfile()`, `useShouldOfferImport()`, `getLocalProfile()`/`setLocalProfile()`, `markImportOffered()`, `clearLocalProfile()` — `useSyncExternalStore`-based (mirrors `lib/compare.ts`'s pattern), so there's no server/client hydration mismatch from reading `localStorage` |
| `components/me/ScoreCheckerWithProfile.tsx` | Drop-in replacement for `components/school/ScoreChecker` on profile pages; fetches `myScores()` client-side after mount and remounts `ScoreChecker` with `initialTest`/`initialValue`/`fromProfile` once it resolves |
| `components/me/YouScoreRow.tsx` | The "You" row under Compare's SAT/ACT middle-50% lists (`app/compare/page.tsx`'s `ScoreCompare`) |
| `components/me/ExploreFitChips.tsx` + `app/api/me/explore-fit/route.ts` | The `fit=scores`/`fit=prefs` chips and the route they call |

### Decisions made while building
- **GPA conversion** (student-profile.md "GPA normalization") uses the standard College Board/NACAC 100-point band
  table (97+→4.0, 93-96→3.7, …, below 65→0.0) and a proportional scale for 5.0 (`gpa / 5 * 4`), both rounded to one
  decimal. `high-school-data.md`'s per-school scale isn't built yet, so every 100-point conversion uses this one
  table regardless of school — noted as a known simplification, not a bug, for whoever builds that spec next.
- **`fitsScores`/`fitsPreferences` return a tri-state `Fit`, not a boolean.** "unknown" (the college doesn't report
  the figure being checked) is deliberately distinct from "out" in the type, but Explore's chips treat "out" and
  "unknown" the same way (both are left off the filtered list) because there's no good UI yet for a third bucket —
  this is called out in the `Fit` doc comment, the chip copy ("colleges without a reported range or preference
  aren't shown either way"), and here, for the next spec (`chances-and-fit.md`) that will want to tell them apart.
- **`fitsPreferences` requires every preference the student set to match** (AND, not OR); with none set, every
  college is trivially "in". One definite "out" wins over an "unknown" elsewhere, so a single clear mismatch still
  excludes a college even when another preference can't be checked for it.
- **Explore's fit chips are a client-side post-filter, not a server-side one** — the real deviation to flag. Explore
  (`app/explore/page.tsx`) is public and must stay static/cookie-free (enforced by `tests/accounts.test.mts`'s
  guard), so `lib/auth` can't run during its render. `components/me/ExploreFitChips.tsx` fetches the signed-in
  student's matching `unit_id`s from `/api/me/explore-fit` (an account route, so it may read cookies) **against the
  whole dataset**, then hides non-matching `[data-unit-id]` rows already in the server-rendered table/grid/list
  (added that attribute to `SchoolTable`, `SchoolCard`, `SchoolRow`). It does **not** change which page of results
  the server returns, so the "N colleges match" count above the table describes the filters before `fit` is
  applied — the chip row says so. A cleaner version would thread `fit` through Explore's own filter pipeline
  server-side, but that requires a way for a public page to learn the signed-in user without reading cookies during
  render, which the current guard doesn't offer; left as a note for whoever revisits Explore's architecture.
- **ScoreChecker's and Compare's "You" prefill are also client-side fetches**, for the same reason (both pages are
  public/static). `ScoreCheckerWithProfile` renders the plain `ScoreChecker` (no prefill) until the fetch resolves,
  then remounts it with a `key` change so its internal `useState` picks up the new initial value — no hydration
  mismatch, since the server-rendered and first-client-rendered output are identical. `ScoreChecker` itself gained
  `initialTest`/`initialValue`/`fromProfile` props and a "Using your SAT 1450 from your profile (edit below)" line
  that clears the moment the student edits the test toggle or the score field.
- **Compare's "You" row** reuses `RangeBar`'s existing `you` marker (the same pill ScoreChecker already draws)
  rather than inventing a new visual, with `low = high = you` and a transparent range fill so only the marker shows.
- **The one-time import offer only appears for `relation === "self"`.** A guardian's browser-local storage holds
  whatever *they* answered while signed out, not the student's; importing that into a student's profile would be
  wrong, so `app/me/page.tsx` only renders `ImportLocalProfile` when viewing your own profile.
- **A guardian's view of `/me` logs a read** the same way lists/notes do: `logStudentRead(studentId,
  "student_profiles")` from unit B's `lib/households.ts`, called once for the student actually selected (not for
  every student the picker lists, which would over-log). `/me`'s "Viewing as a guardian" banner is unit B's real
  `components/account/GuardianBanner.tsx` (it merged into `feature/accounts` while this was being built; an earlier
  placeholder in `components/me/` was deleted once that landed).
- **Export**: registered a `student_profiles` exporter in unit B's `lib/account-export.ts` `ACCOUNT_EXPORTERS`,
  scoped to `ctx.studentIds` (the user's own and managed students, matching every other per-student exporter there).
- **Migration** (`supabase/migrations/20261005130000_student_profiles.sql`) adds no new access rules: it's one table
  (`student_profiles(student_id pk, data jsonb, updated_at, updated_by)`) with policies built entirely from unit A's
  `can_read_student`/`can_edit_student`. `tests/student-profile-policies.test.mts` follows
  `tests/accounts-policies.test.mts`'s household fixture and proves the usual cases plus two guard tests (RLS
  disabled; a read policy swapped to the old-but-broken `is_guardian_of` that ignores membership status).
- **Not built**: GPA bands' per-school-scale conversion (needs `high-school-data.md`); more than one profile
  "scenario" (open question 1, left for later per the recommendation); hooks (open question 2, left off the form).

### Setup (owner)
1. **Apply the migration** to the dev project after `20261005120000_accounts.sql`: SQL Editor → paste
   `supabase/migrations/20261005130000_student_profiles.sql` → Run. Until then `/me` shows "Profiles aren't set up
   yet" and the ScoreChecker/Compare/Explore integrations just render with nothing to prefill (they catch the
   missing-table error and fall back silently).
2. Nothing else: this migration reuses accounts' helper functions and env vars, and needs no new ones.
