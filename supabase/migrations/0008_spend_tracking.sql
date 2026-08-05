-- 0008: spend tracking.
--
-- Budget plans carry two figures per row: BUDGET in dollars and RAND VALUE in
-- rand, the same money at the rate used when the plan was built. Reporting
-- needs both — media is bought in dollars, but the agency reconciles in rand.
-- Storing only one means recomputing the other at a rate nobody recorded.

alter table public.pm_task_financials
  add column if not exists rand_value numeric;

-- Spend is entered against the boost, not the post, and never against every
-- task in the row. Recorded so the intent survives someone reading the table
-- cold and assuming the budget belongs wherever it appears.
comment on table public.pm_task_financials is
  'One row per paid placement, attached to the Boost task. budget and rand_value come from the plan; actual_spend is entered once the placement has run.';

alter table public.pm_task_financials
  add column if not exists spend_note text;
