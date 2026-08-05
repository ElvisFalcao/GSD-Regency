-- 0009: "Publish to GSD" — the bridge between FluxPlanner and the Project
-- Manager.
--
-- FluxPlanner's plans table is strictly owner-only: auth.uid() = user_id on
-- every operation, so a plan is invisible to everyone but its author. That is
-- right for private drafts and wrong for the whole point of this product —
-- a plan built in FluxPlanner should be readable in GSD the moment its author
-- decides it is ready.
--
-- Publishing is explicit, not automatic: drafts stay private until the author
-- presses the button. The flag lives on the plan row and the grant is a
-- SELECT-only policy for active GSD workspace members. Nobody in GSD gains
-- write access to plans; date write-back stays with the fluxplanner-sync
-- function under the service role.

alter table public.plans
  add column if not exists published_to_gsd boolean not null default false;
alter table public.plans
  add column if not exists gsd_workspace_id text references public.pm_workspaces(id);
alter table public.plans
  add column if not exists published_at timestamptz;

-- Permissive policies OR together, so the owner's own_select continues to
-- apply unchanged; this adds readers rather than replacing any.
drop policy if exists plans_gsd_read on public.plans;
create policy plans_gsd_read on public.plans
  for select to authenticated
  using (
    published_to_gsd
    and gsd_workspace_id is not null
    and public.pm_is_active(gsd_workspace_id)
  );

create index if not exists plans_published_gsd
  on public.plans (gsd_workspace_id, updated_at desc)
  where published_to_gsd;
