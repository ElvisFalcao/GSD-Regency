-- 0010: carry the brand with the published plan.
--
-- FluxPlanner has no structured brand; the brand lived only in whatever the
-- author typed as the campaign name, which forced a second manual brand pick
-- at import and produced confusing validation errors until it was made.
-- Publishing now records the brand once, and GSD pre-selects it.
alter table public.plans add column if not exists gsd_brand text;
