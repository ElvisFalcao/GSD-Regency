-- 0006: approving a registration, as one statement.
--
-- Linking is not a single update. A registration creates its own pm_members
-- row holding the auth user id, while the person's real row (roles, title,
-- access level) was seeded months earlier. Approval has to move the auth id
-- across and drop the request.
--
-- Doing that from the browser would be three round trips with no transaction:
-- a crash between them leaves either two rows claiming one account or a person
-- with no row at all. It also has to delete before it updates, because
-- pm_members_user_unique forbids the same user_id sitting on both rows even
-- momentarily. That ordering is easy to get wrong once and never notice.

create or replace function public.pm_link_member(pending_member_id uuid, target_member_id uuid)
returns public.pm_members
language plpgsql security definer set search_path = public as $$
declare
  request public.pm_members;
  target public.pm_members;
begin
  select * into request from public.pm_members where id = pending_member_id;
  if not found then raise exception 'That access request no longer exists'; end if;
  select * into target from public.pm_members where id = target_member_id;
  if not found then raise exception 'That team member no longer exists'; end if;

  -- Checked here rather than left to RLS: SECURITY DEFINER runs as the owner,
  -- so the table policies do not apply to anything this function does.
  if not public.pm_is_manager(target.workspace_id) then
    raise exception 'Only Shane, Elvis or Zaida can approve access';
  end if;
  if request.workspace_id <> target.workspace_id then
    raise exception 'Those two records belong to different workspaces';
  end if;
  if request.access_level <> 'pending' then
    raise exception 'That request has already been handled';
  end if;
  if request.user_id is null then
    raise exception 'That request has no account attached to it';
  end if;
  if target.user_id is not null then
    raise exception '% is already linked to an account', target.display_name;
  end if;

  delete from public.pm_members where id = request.id;

  -- The request carries the address they registered with in display_name,
  -- because requestAccess cannot write email without colliding with the very
  -- row being linked here. Keep the seeded address if there is one.
  update public.pm_members
     set user_id = request.user_id,
         email = coalesce(target.email, request.display_name)
   where id = target.id
  returning * into target;

  return target;
end $$;

revoke execute on function public.pm_link_member(uuid, uuid) from public;
revoke execute on function public.pm_link_member(uuid, uuid) from anon;
grant execute on function public.pm_link_member(uuid, uuid) to authenticated;
