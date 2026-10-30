-- Essays, part 4 (specs/product/essays/moves.md "Files"): the one list-wide essays move is a plan_tasks row of kind
-- 'essays' (key "{list}:essays:next", source 'season'). The kind check from 20261014120000_next_steps.sql lists every
-- kind by name, so the new one is added here; nothing else changes. Applied to the dev project by the owner.

alter table public.plan_tasks drop constraint if exists plan_tasks_kind_check;

alter table public.plan_tasks add constraint plan_tasks_kind_check check (kind in (
  'apply', 'decision_expected', 'aid_forms', 'reply_by', 'housing_deposit', 'ed2_conditional',
  'cycle', 'decide_rounds', 'follow', 'request_info', 'write_visit_notes',
  'fee', 'send_scores', 'transcript', 'recommendation', 'supplement', 'submit', 'portal_setup', 'portal_check',
  'continued_interest', 'waitlist_accept', 'waitlist_deposit_elsewhere',
  'add_offer', 'deposit', 'withdraw', 'waitlist_decide', 'summer', 'own',
  'cost_check', 'test_register', 'test_day',
  'playbook', 'ed_decide', 'ed2_decide', 'visit_ed', 'show_interest', 'shape_gap', 'shape_cost',
  'confirm_complete', 'compare_offers', 'decide_by', 'outcome_share', 'story',
  'essays'
));
