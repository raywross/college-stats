-- National trend files (specs/national-trends.md): data/history/trends/{name}.json, built by `npm run build-trends`
-- (and at the end of `npm run sync-history`), are published into history_files as rows named `trends/{name}`
-- (e.g. 'trends/index', 'trends/men-and-women'). The table's name check allowed only the four shared files, so it's
-- widened. No new table: `npm run publish-data` writes them with the shared files and removes rows for files that no
-- longer exist; the app reads one row at a time (lib/supabase.ts fetchTrendFile).

alter table public.history_files drop constraint if exists history_files_name_check;
alter table public.history_files add constraint history_files_name_check
  check (name in ('meta', 'national', 'facts', 'cpi') or name ~ '^trends/[a-z0-9-]+$');
