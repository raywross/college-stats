-- The planner redesign (PR #105) added three generated task kinds in lib/planner/types.ts (TaskKind): `cost_check`
-- (the parent's "check the cost together" before a binding round), and `test_register` / `test_day` (a test date the
-- student picked). The plan_tasks check constraint from 20261008120000_planner.sql was never widened, so every write
-- of those tasks failed ("violates check constraint plan_tasks_kind_check", found in QA 2026-10-11) and the plan
-- logged the error on each load. This widens the constraint to the full TaskKind list.

alter table public.plan_tasks drop constraint if exists plan_tasks_kind_check;

alter table public.plan_tasks add constraint plan_tasks_kind_check check (kind in (
  'apply', 'decision_expected', 'aid_forms', 'reply_by', 'housing_deposit', 'ed2_conditional',
  'cycle', 'decide_rounds', 'follow', 'request_info', 'write_visit_notes',
  'fee', 'send_scores', 'transcript', 'recommendation', 'supplement', 'submit', 'portal_setup', 'portal_check',
  'continued_interest', 'waitlist_accept', 'waitlist_deposit_elsewhere',
  'add_offer', 'deposit', 'withdraw', 'waitlist_decide', 'summer', 'own',
  'cost_check', 'test_register', 'test_day'
));
