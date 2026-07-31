-- 0002: access levels, self-registration gate, and the helper functions that
-- RLS policies will be built on in 0003.
--
-- Roles (pm_member_roles) describe the work someone does. Access level
-- describes what they may see and do. Sian taking on posts is a role change;
-- Leon not seeing analytics is an access rule. They move independently.

-- 1. Access level replaces is_admin. Two sources of truth for permissions is a
--    bug waiting to happen, so is_admin is dropped rather than kept in sync.
--    'pending' is the landing state for self-registration: the account exists
--    but is not yet linked to the team by a manager.
alter table public.pm_members
  add column if not exists access_level text not null default 'pending';

alter table public.pm_members
  drop constraint if exists pm_members_access_level_check;
alter table public.pm_members
  add constraint pm_members_access_level_check
  check (access_level in ('owner', 'admin', 'member', 'pending', 'disabled'));

-- A person can only be linked to one auth account, and vice versa.
create unique index if not exists pm_members_user_unique
  on public.pm_members (workspace_id, user_id)
  where user_id is not null;

-- 2. Seed levels. Shane owns the company; Elvis and Zaida hold identical
--    capability. 'owner' exists so an admin cannot demote or remove him.
update public.pm_members set access_level = 'owner'
  where workspace_id = 'regency-shalina' and lower(email) = 'shanek@regency.global';
update public.pm_members set access_level = 'admin'
  where workspace_id = 'regency-shalina'
    and lower(email) in ('socialpr@regency.global', 'comms@regency.global');
update public.pm_members set access_level = 'member'
  where workspace_id = 'regency-shalina' and access_level = 'pending';

alter table public.pm_members drop column if exists is_admin;

-- 3. Helper functions for RLS.
--
--    SECURITY DEFINER is required, not stylistic: a policy on pm_members that
--    queries pm_members would re-enter its own policy and recurse. Definer
--    rights bypass that. search_path is pinned so the functions cannot be
--    redirected by a caller-supplied schema.

create or replace function public.pm_access(ws text)
returns text language sql stable security definer set search_path = public as $$
  select access_level from public.pm_members
   where workspace_id = ws and user_id = auth.uid()
   limit 1
$$;

-- Signed in, linked to the team, and not disabled.
create or replace function public.pm_is_active(ws text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.pm_access(ws) in ('owner', 'admin', 'member'), false)
$$;

-- May assign work, approve, import plans and change workspace settings.
create or replace function public.pm_is_manager(ws text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.pm_access(ws) in ('owner', 'admin'), false)
$$;

create or replace function public.pm_has_role(ws text, slot text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.pm_member_roles r
      join public.pm_members m on m.id = r.member_id
     where r.workspace_id = ws
       and r.role_slot = slot
       and m.user_id = auth.uid()
  )
$$;

-- Capability grants derived from tier or role, so access follows a role change
-- automatically instead of needing a second edit somewhere else.
create or replace function public.pm_can_see_analytics(ws text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.pm_is_manager(ws) or public.pm_has_role(ws, 'Community Manager')
$$;

create or replace function public.pm_can_see_budget(ws text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.pm_is_manager(ws) or public.pm_has_role(ws, 'Bookkeeping')
$$;

revoke execute on function public.pm_access(text) from anon;
revoke execute on function public.pm_has_role(text, text) from anon;
