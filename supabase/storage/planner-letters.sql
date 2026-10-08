-- The private Storage bucket for shared letters (specs/planner/offers.md "Letters", step 2 "Share the letter").
--
-- RUN BY THE OWNER in the Supabase SQL Editor (dev first, then prod), once. This is NOT a migration: it touches the
-- `storage` schema, which only exists on a Supabase project, so it lives outside supabase/migrations/ and the PGlite
-- policy tests (which apply every migration) never see it. Safe to run again: each statement replaces what it creates.
--
-- What it sets up:
-- - Bucket `plan-letters`: private (no public URLs), 4 MB per file (the Server Action's limit), PDFs and photos only.
-- - Files live under the uploader's own folder: `{auth.uid()}/{item id}/{random}.{ext}` (lib/planner/store-offers.ts
--   shareLetter writes them with the uploader's own session).
-- - Only the uploader can upload, read, or delete files in their folder. Nobody else in the household reads the
--   file through Storage (the plan_letters row, readable by the list's readers, says a letter was shared; the file
--   stays the uploader's). The service role (a person at Quad checking the letter reader's work) reads everything;
--   it bypasses these policies by design.
-- - Revoking from the offer deletes the file and its plan_letters row. When an account is purged, its plan_letters
--   rows go with it (uploaded_by cascades); the files under its folder must be removed with the service role (the
--   purge doesn't do that yet: see specs/planner/offers.md "Built", owner follow-ups).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plan-letters',
  'plan-letters',
  false,
  4194304,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Plan letters: upload to own folder" on storage.objects;
drop policy if exists "Plan letters: read own folder" on storage.objects;
drop policy if exists "Plan letters: delete own folder" on storage.objects;

create policy "Plan letters: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plan-letters' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Plan letters: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'plan-letters' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Plan letters: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plan-letters' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- No update policy: a letter is replaced by revoking it and sharing again, never overwritten in place.
