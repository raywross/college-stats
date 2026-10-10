-- The planner redesign (specs/planner/redesign/standing.md "Suggested until changed", rounds.md "Suggested until
-- changed"; build brief specs/planner/redesign/build-plan.md "Database").
--
-- A college's group (Reach / Target / Likely) and application round now start as the site's suggestion and stay
-- that way until the student (or a parent with edit access) changes them. Two columns record whose value is stored:
--   category_source: 'auto' while list_items.category is the standing model's suggestion; 'student' once picked.
--   round_source:    'auto' while list_items.round is the starting round; 'student' once picked.
-- The plan rewrites only 'auto' values (lib/planner/plan-view.ts autoWrites); a 'student' value is never changed by
-- the site. "Use the suggestion" / "Use the starting round" set the source back to 'auto'.
--
-- Backfill: a category the student already chose (anything but 'unsorted') and a round already stored are the
-- student's; everything else becomes 'auto' and is filled in on the next plan open.
--
-- No policy changes: the list_items row policies already cover every column. Until this file is applied, the app
-- reads lists without these columns and treats every row as the student's (lib/planner/read-plan.ts).

alter table public.list_items add column category_source text not null default 'auto' check (category_source in ('auto','student'));
alter table public.list_items add column round_source    text not null default 'auto' check (round_source in ('auto','student'));

-- backfill: a chosen category (not 'unsorted') is the student's; a stored round is the student's
update public.list_items set category_source = 'student' where category <> 'unsorted';
update public.list_items set round_source = 'student' where round is not null;
