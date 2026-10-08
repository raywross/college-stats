-- Retire the dataset tables (specs/serving-architecture.md section 2): the deploy carries data/ and the app reads it
-- from the files, so nothing reads or writes the colleges, history, detail files, or short names in Supabase any
-- more. Drops the publish functions first, then the tables (none has a foreign key to another; staging before live).
--
-- Kept: dataset_publishes, dataset_changes, dataset_change_staging, stage_dataset_changes() and publish_changes()
-- (the change log; 20261007120000_publish_changes.sql), every high_school* table and function, and every user table.
--
-- Apply in the Supabase SQL Editor only after the build that reads the files is live, and after
-- 20261007120000_publish_changes.sql. Safe to run twice. Tested by tests/follows-policies.test.mts, which applies
-- every migration in order.

-- 20260928000000_dataset.sql
drop function if exists public.publish_dataset(json, json, json, text, text);
-- 20261002140000_school_staging.sql
drop function if exists public.stage_schools(json, integer, boolean);
drop function if exists public.publish_schools_staged(json, json, integer, text, text);
-- 20261005140000_follows.sql, 20261005145000_change_old_source.sql
drop function if exists public.publish_schools_staged_with_changes(json, json, integer, integer, text, text);
-- 20260928120000_history.sql, 20260928180000_history_staging.sql
drop function if exists public.publish_history(json, json);
drop function if exists public.stage_history(json, boolean);
drop function if exists public.publish_history_staged(json, integer);
-- 20261002120000_school_details.sql
drop function if exists public.stage_details(json, boolean);
drop function if exists public.publish_details_staged(integer);
-- 20261004120000_school_aliases.sql
drop function if exists public.publish_aliases(json);

drop table if exists public.school_staging;
drop table if exists public.schools;
drop table if exists public.dataset_files;
drop table if exists public.history_staging;
drop table if exists public.school_histories;
drop table if exists public.history_files;
drop table if exists public.detail_staging;
drop table if exists public.school_details;
drop table if exists public.school_aliases;
