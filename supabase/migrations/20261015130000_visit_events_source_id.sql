-- Visit events, round 3: the per-vendor event id. Slate's is a GUID, but Element451's is "<client>.events.<n>" plus an
-- occurrence id, and TargetX's is a Salesforce record id, so the column becomes text. Existing values keep their
-- lower-cased GUID text; visit_events.id (host || ':' || slate_id) is unchanged.

alter table public.visit_events alter column slate_id type text using slate_id::text;
alter table public.visit_events add constraint visit_events_slate_id_shape check (char_length(slate_id) between 1 and 200);
