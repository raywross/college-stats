-- A sibling connection per college (owner, 2026-10-12; specs/planner/redesign/list.md "The capture panel",
-- specs/chances/inputs-beyond-academics.md "Legacy"): "A brother or sister went here", set from the row's Connections
-- line beside the parent/grandparent legacy toggle. The estimate reads it like legacy, gated by the college's C7
-- alumni-relation rating and any state ban, with a smaller weight (method/standing.md).
--
-- Additive and backward-compatible (specs/supabase.md "Migrations"): one new column with a default, no rewrite of
-- existing rows, no new policy. list_items' existing row-level security covers it: the student and an edit-access
-- guardian may set it, a view-only guardian reads it, nobody else sees it. Until this is applied the app reads the
-- column as false (lib/planner/read-plan.ts, lib/chances/snapshot-write.ts, lib/account-export.ts) and the Sibling
-- chip's write fails with "That didn't work". Apply to dev first, then prod, pasted into the SQL Editor.

alter table public.list_items add column legacy_sibling boolean not null default false;
