-- 0014: managers can remove a platform connection.
--
-- The OAuth grant sweeps in every asset the consent screen approves, which on
-- a personal Meta login includes pages that have nothing to do with the
-- client. pm_platform_connections is service-role only, so removal goes
-- through a definer function gated on manager rather than any client policy.
--
-- Removing here governs what GSD holds. To keep an asset out permanently,
-- untick it on Facebook's consent screen when reconnecting — a reconnect
-- re-imports whatever Facebook grants.
create or replace function public.pm_remove_connection(ws text, p_platform text, p_kind text, p_external_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.pm_is_manager(ws) then
    raise exception 'Only Shane, Elvis or Zaida can remove connections';
  end if;
  delete from public.pm_platform_connections
   where workspace_id = ws and platform = p_platform
     and kind = p_kind and external_id = p_external_id;
end $$;

revoke execute on function public.pm_remove_connection(text, text, text, text) from public;
revoke execute on function public.pm_remove_connection(text, text, text, text) from anon;
grant execute on function public.pm_remove_connection(text, text, text, text) to authenticated;
