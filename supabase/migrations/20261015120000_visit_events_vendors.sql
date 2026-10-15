-- Visit events, round 3 (specs/product/visit-events.md, "Round 3: TargetX and Element451"): the hosts table learns which
-- system a college's calendar runs on. `slate_hosts` keeps its name (every reader, check, and admin query uses it);
-- `vendor` says which reader reads the row, and `config` holds what that reader needs beyond the host: the site path
-- and flavour for a TargetX site, the public tokens a college's own pages carry for an Element451 site. Rows that
-- exist are Slate.

alter table public.slate_hosts
  add column vendor text not null default 'slate' check (vendor in ('slate', 'targetx', 'element451')),
  add column config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object');

create index slate_hosts_vendor_idx on public.slate_hosts (vendor, status);
