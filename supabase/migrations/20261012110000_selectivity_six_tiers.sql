-- Quad's selectivity, six tiers (specs/chances/selectivity-index.md "Second version"; owner, 2026-10-12): the old
-- Highly selective band splits, and "Very selective" sits between Highly selective and Selective. The top tier's
-- stored key stays 'elite' (its name on the site is "Ultra selective"). Additive: every stored value stays valid.
alter table public.application_snapshots drop constraint application_snapshots_selectivity_tier_check;
alter table public.application_snapshots add constraint application_snapshots_selectivity_tier_check
  check (selectivity_tier in ('elite', 'highly_selective', 'very_selective', 'selective', 'accessible', 'open'));
