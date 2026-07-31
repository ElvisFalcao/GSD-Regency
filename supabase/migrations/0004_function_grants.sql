-- 0004: stop the RLS helpers being callable as public RPC endpoints.
--
-- INCOMPLETE, and the reasoning below is wrong. See 0005, which finishes the
-- job and explains why revoking from PUBLIC alone left anon access in place.
--
-- 0002 tried `revoke execute ... from anon` and achieved nothing. PostgreSQL
-- grants EXECUTE on new functions to PUBLIC by default, and anon inherits that
-- grant, so revoking the role-specific grant leaves the inherited one intact.
-- The revoke has to target PUBLIC.
--
-- Without this, /rest/v1/rpc/pm_is_manager and friends are callable by anyone
-- holding the anon key -- which is every visitor, since it ships in the browser.

revoke execute on function public.pm_access(text) from public;
revoke execute on function public.pm_is_active(text) from public;
revoke execute on function public.pm_is_manager(text) from public;
revoke execute on function public.pm_member_id(text) from public;
revoke execute on function public.pm_has_role(text, text) from public;
revoke execute on function public.pm_can_see_analytics(text) from public;
revoke execute on function public.pm_can_see_budget(text) from public;

-- RLS policy expressions are evaluated as the querying role, so authenticated
-- must keep EXECUTE or every policy that calls these would deny everything.
grant execute on function public.pm_access(text) to authenticated;
grant execute on function public.pm_is_active(text) to authenticated;
grant execute on function public.pm_is_manager(text) to authenticated;
grant execute on function public.pm_member_id(text) to authenticated;
grant execute on function public.pm_has_role(text, text) to authenticated;
grant execute on function public.pm_can_see_analytics(text) to authenticated;
grant execute on function public.pm_can_see_budget(text) to authenticated;

-- Trigger functions are only ever fired by the trigger. PostgreSQL does not
-- check EXECUTE against the user whose statement fired it, so these need no
-- grant back and should not be reachable over RPC at all.
revoke execute on function public.pm_guard_member_update() from public;
revoke execute on function public.pm_guard_task_update() from public;
