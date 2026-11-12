-- Three reason codes for fall figures before the CDS (specs/college-reported-fall-figures.md;
-- specs/college-data-failures.md#reason-codes): a notice whose text doesn't name its term (`notice_no_term`), a notice
-- read with no first-year figures (`notice_no_figures`), and a season pass that found no notice (`season_none_found`).
-- Replaces the reason_code check of 20261010140000_college_data_failures.sql with the full list (REASON_CODES in
-- scripts/lib/college-failures.mts; tests/college-failures.test.mts keeps them in step). Apply in the Supabase SQL
-- Editor, dev first, before a run that writes the new codes is published.

alter table public.college_data_failures drop constraint if exists college_data_failures_reason_code_check;

alter table public.college_data_failures add constraint college_data_failures_reason_code_check check (reason_code in (
  'no_document_found', 'class_profile_only', 'class_profile_no_figures', 'robots_disallowed', 'host_blocked',
  'unreachable', 'edition_too_old', 'not_newer', 'edition_unknown', 'never_read', 'failed_checks',
  'read_no_values', 'malformed_url', 'discovery_error', 'notice_no_term', 'notice_no_figures', 'season_none_found'
));
