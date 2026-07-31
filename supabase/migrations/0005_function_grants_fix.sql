-- 0005: finish what 0004 started.
--
-- 0004 assumed anon reached these functions only by inheriting the default
-- PUBLIC grant, so revoking from PUBLIC would be enough. It was not. Supabase
-- ships ALTER DEFAULT PRIVILEGES on the public schema that grant EXECUTE
-- explicitly to anon, authenticated and service_role, so a new function
-- carries a direct anon grant that a PUBLIC revoke does not touch.
--
-- The proof is in the linter: pm_access and pm_has_role came out clean because
-- 0002 happened to revoke them from anon by name, while every function that
-- only got the PUBLIC revoke in 0004 stayed exposed.

revoke execute on function public.pm_access(text) from anon;
revoke execute on function public.pm_is_active(text) from anon;
revoke execute on function public.pm_is_manager(text) from anon;
revoke execute on function public.pm_member_id(text) from anon;
revoke execute on function public.pm_has_role(text, text) from anon;
revoke execute on function public.pm_can_see_analytics(text) from anon;
revoke execute on function public.pm_can_see_budget(text) from anon;

revoke execute on function public.pm_guard_member_update() from anon;
revoke execute on function public.pm_guard_task_update() from anon;
revoke execute on function public.pm_guard_member_update() from authenticated;
revoke execute on function public.pm_guard_task_update() from authenticated;

-- The helpers keep their authenticated grant deliberately. RLS evaluates policy
-- expressions as the querying role, so removing it would make every policy that
-- calls them fail closed and lock the whole team out. They are also cheap to
-- expose: each one answers a question about the caller's own access and reveals
-- nothing about anyone else.
