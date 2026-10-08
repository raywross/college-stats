-- The rounds stage's priority attribution (specs/planner/early-rounds.md "Ranking"): "Reordered by Dad", and the
-- student can put it back. Additive to 20261008120000_planner.sql; the lists policies already decide who may update.
--
--   priority_at        when the priority order last changed (lib/planner/store-rounds.ts setPriorityOrder)
--   priority_by        who changed it: set by the trigger from the session, never from the request
--   priority_previous  the order before that change, [{ "id": item uuid, "priority": int | null }], for "Put it back"

alter table public.lists
  add column priority_at timestamptz,
  add column priority_by uuid references auth.users (id) on delete set null,
  add column priority_previous jsonb check (priority_previous is null or jsonb_typeof(priority_previous) = 'array');

create function public.lists_priority_by() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.priority_at is distinct from old.priority_at then
    new.priority_by := auth.uid();
  -- Clearing it is allowed (the user's account was deleted: on delete set null); naming someone else isn't.
  elsif new.priority_by is distinct from old.priority_by and new.priority_by is not null then
    new.priority_by := old.priority_by;
  end if;
  return new;
end;
$$;

create trigger lists_priority_by before update on public.lists
  for each row execute function public.lists_priority_by();
