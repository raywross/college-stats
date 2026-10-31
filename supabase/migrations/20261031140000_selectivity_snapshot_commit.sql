-- The data platform's publisher records tier history per snapshot (specs/data-platform/publish.md "The change log and
-- tier history"): a run is named `snapshot:<id>` in place of a git commit, as `dataset_publishes.git_commit` already
-- allows. selectivity_publishes.git_commit was checked against a bare sha; it now also takes `snapshot:<n>`.
-- `unique` stays, so record_selectivity_run still skips a snapshot it has recorded.
alter table public.selectivity_publishes drop constraint if exists selectivity_publishes_git_commit_check;
alter table public.selectivity_publishes add constraint selectivity_publishes_git_commit_check
  check (git_commit ~ '^([0-9a-f]{7,64}|snapshot:[0-9]+)$');
