-- 0011: publishing opens to every FluxPlanner session; GSD curates the list.
--
-- FluxPlanner is deliberately usable without an account — Google Drive and
-- guest sessions. Publishing from those now rides on Supabase anonymous
-- sign-ins: the click silently creates a session, the plan is copied into the
-- database owned by it, and every existing policy applies unchanged. Nothing
-- here loosens RLS — an anonymous user owns only what they created.
--
-- The trade is that anyone on the public FluxPlanner page can put a plan in
-- GSD's import dropdown. Import itself is manager-only, so junk cannot become
-- tasks — but managers need a way to clear the list. Unpublishing a plan is a
-- lighter right than editing it: this function clears the flag and touches
-- nothing else, so a manager can curate without gaining write access to
-- anyone's plan.
--
-- NOTE: requires "Allow anonymous sign-ins" to be enabled in Supabase Auth
-- settings — a dashboard toggle, not a migration.

create or replace function public.pm_unpublish_plan(plan_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare ws text;
begin
  select gsd_workspace_id into ws
    from public.plans where id = plan_id and published_to_gsd;
  if ws is null then
    raise exception 'That plan is not published to GSD';
  end if;
  if not public.pm_is_manager(ws) then
    raise exception 'Only Shane, Elvis or Zaida can remove a plan from the import list';
  end if;
  -- gsd_brand and gsd_workspace_id survive so republishing from FluxPlanner
  -- does not ask the brand question again.
  update public.plans set published_to_gsd = false, published_at = null
   where id = plan_id;
end $$;

revoke execute on function public.pm_unpublish_plan(uuid) from public;
revoke execute on function public.pm_unpublish_plan(uuid) from anon;
grant execute on function public.pm_unpublish_plan(uuid) to authenticated;
