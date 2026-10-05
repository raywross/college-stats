-- Student profile (specs/product/student-profile.md): one JSON document per student (GPA, scores, major,
-- preferences...), read by ScoreChecker, Explore's "fit=" chips, and Compare's "You" column. Builds on
-- supabase/migrations/20261005120000_accounts.sql's `students` table and its can_read_student/can_edit_student
-- helpers, which already encode "own record, a managed record I created, or an active guardian in a shared
-- household" (and, for edit, that the guardian's membership has can_edit). This migration adds no new rules of its
-- own: it only applies those two functions to a new table.
--
-- The document shape itself (lib/student-profile.ts StudentProfileData) isn't enforced by the database beyond
-- "valid JSON"; `lib/student-profile-store.ts` sanitizes with `sanitizeProfile()` before every write, the same
-- function used for localStorage import, so a hand-edited row can never produce an invalid shape the app can't
-- render.
--
-- Tested against real Postgres (PGlite) in tests/student-profile-policies.test.mts.
--
-- Apply in the Supabase SQL Editor (dev first, then prod), after 20261005120000_accounts.sql.

create table public.student_profiles (
  student_id uuid primary key references public.students (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- Who last wrote it (the student themself, or an editing guardian), for "Added by Mom"-style attribution later.
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.student_profiles enable row level security;

create policy "Student profile: read" on public.student_profiles for select to authenticated
  using (public.can_read_student(student_id));

create policy "Student profile: insert" on public.student_profiles for insert to authenticated
  with check (public.can_edit_student(student_id) and (updated_by is null or updated_by = auth.uid()));

create policy "Student profile: update" on public.student_profiles for update to authenticated
  using (public.can_edit_student(student_id))
  with check (public.can_edit_student(student_id) and (updated_by is null or updated_by = auth.uid()));

-- No delete policy: a student profile is removed only by deleting the student record itself (cascade above), so
-- a guardian can never erase a student's numbers outright, only edit them.

revoke all on public.student_profiles from anon, authenticated;
grant select, insert, update on public.student_profiles to authenticated;
grant all on public.student_profiles to service_role;
