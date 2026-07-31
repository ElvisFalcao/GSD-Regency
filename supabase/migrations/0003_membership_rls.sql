-- 0003: replace the `using (true)` policies with real membership checks.
--
-- The old policies granted every authenticated user of the FluxPlanner-Pro
-- project full read and write over all Regency project-manager data. Supabase's
-- linter flagged nine of them. This migration is the reason Phase 0 exists.
--
-- Design note on sensitive columns: RLS is row-level, so it cannot hide a
-- column. Everyone sees every task (agreed: the team needs to know two videos
-- ship Friday for Shaltoux), which means budget and pulled analytics cannot
-- live on pm_tasks and still be restricted. They move to their own tables,
-- where ordinary row policies do the work. No masking views, no revoked column
-- grants -- each table has one audience and one policy.

-- ---------------------------------------------------------------------------
-- 1. Helper missing from 0002.
-- ---------------------------------------------------------------------------
create or replace function public.pm_member_id(ws text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pm_members
   where workspace_id = ws and user_id = auth.uid()
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Sensitive data off pm_tasks.
-- ---------------------------------------------------------------------------
create table if not exists public.pm_task_financials (
  task_id uuid primary key references public.pm_tasks(id) on delete cascade,
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  budget numeric,
  actual_spend numeric,
  updated_at timestamptz not null default now()
);

-- Pulled reporting data only. Task notes stay in pm_tasks.results, which is
-- also where granola-task-sync writes meeting context -- that is not analytics
-- and must remain visible to everyone.
create table if not exists public.pm_task_metrics (
  task_id uuid primary key references public.pm_tasks(id) on delete cascade,
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  source text not null default 'supermetrics',
  metrics jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

alter table public.pm_tasks drop column if exists budget;

alter table public.pm_task_financials enable row level security;
alter table public.pm_task_metrics enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Drop the permissive policies.
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated Regency staff can read workspaces" on public.pm_workspaces;
drop policy if exists "Authenticated Regency staff can use members" on public.pm_members;
drop policy if exists "Authenticated Regency staff can use campaigns" on public.pm_campaigns;
drop policy if exists "Authenticated Regency staff can use tasks" on public.pm_tasks;
drop policy if exists "Authenticated Regency staff can use task activity" on public.pm_task_activity;
drop policy if exists "Authenticated Regency staff can use conflicts" on public.pm_sync_conflicts;
drop policy if exists "Authenticated Regency staff can use reporting mappings" on public.pm_reporting_mappings;
drop policy if exists "Authenticated Regency staff can use notification settings" on public.pm_notification_settings;
drop policy if exists "Authenticated Regency staff can use meetings" on public.pm_meetings;
drop policy if exists "Authenticated Regency staff can use PM" on public.pm_workspace_snapshots;
-- pm_workspace_snapshots is deliberately left with no policy. It is the legacy
-- whole-state blob that the frontend overwrites on every save; it is replaced
-- by the real tables in Phase 0 and dropped once app.js no longer references it.

-- ---------------------------------------------------------------------------
-- 4. Workspace. Readable by any signed-in user so a new starter can find it
--    and request access; it holds a name and a timezone, nothing sensitive.
-- ---------------------------------------------------------------------------
create policy pm_workspaces_read on public.pm_workspaces
  for select to authenticated using (true);
create policy pm_workspaces_manage on public.pm_workspaces
  for update to authenticated
  using (public.pm_is_manager(id)) with check (public.pm_is_manager(id));

-- ---------------------------------------------------------------------------
-- 5. Members and self-registration.
-- ---------------------------------------------------------------------------
create policy pm_members_read on public.pm_members
  for select to authenticated
  using (public.pm_is_active(workspace_id) or user_id = auth.uid());

-- Request access: create your own row, pending, and nothing else. Access level
-- is pinned in WITH CHECK so a new sign-up cannot arrive as an admin.
create policy pm_members_self_register on public.pm_members
  for insert to authenticated
  with check (user_id = auth.uid() and access_level = 'pending');

create policy pm_members_manager_insert on public.pm_members
  for insert to authenticated with check (public.pm_is_manager(workspace_id));
create policy pm_members_manager_update on public.pm_members
  for update to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));
create policy pm_members_manager_delete on public.pm_members
  for delete to authenticated
  using (public.pm_is_manager(workspace_id) and access_level <> 'owner');

-- WITH CHECK sees only the new row, so it cannot tell that an admin just
-- demoted the owner or promoted themselves. That comparison needs a trigger.
create or replace function public.pm_guard_member_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role and SQL editor run without a JWT; migrations must still work.
  if auth.uid() is null then return new; end if;

  if (old.access_level = 'owner' or new.access_level = 'owner')
     and coalesce(public.pm_access(new.workspace_id), '') <> 'owner' then
    raise exception 'Only the workspace owner can grant or remove owner access';
  end if;

  if new.user_id = auth.uid() and new.access_level is distinct from old.access_level then
    raise exception 'You cannot change your own access level';
  end if;

  return new;
end $$;

drop trigger if exists pm_members_guard on public.pm_members;
create trigger pm_members_guard before update on public.pm_members
  for each row execute function public.pm_guard_member_update();

-- ---------------------------------------------------------------------------
-- 6. Roles. Visible to the team, granted only by managers.
-- ---------------------------------------------------------------------------
create policy pm_member_roles_read on public.pm_member_roles
  for select to authenticated using (public.pm_is_active(workspace_id));
create policy pm_member_roles_manage on public.pm_member_roles
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));

-- ---------------------------------------------------------------------------
-- 7. Campaigns.
-- ---------------------------------------------------------------------------
create policy pm_campaigns_read on public.pm_campaigns
  for select to authenticated using (public.pm_is_active(workspace_id));
create policy pm_campaigns_manage on public.pm_campaigns
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));

-- ---------------------------------------------------------------------------
-- 8. Tasks. Everyone sees everything; only managers create, delete or assign.
--    An assignee may progress their own task.
-- ---------------------------------------------------------------------------
create policy pm_tasks_read on public.pm_tasks
  for select to authenticated using (public.pm_is_active(workspace_id));
create policy pm_tasks_manager_insert on public.pm_tasks
  for insert to authenticated with check (public.pm_is_manager(workspace_id));
create policy pm_tasks_manager_delete on public.pm_tasks
  for delete to authenticated using (public.pm_is_manager(workspace_id));
create policy pm_tasks_update on public.pm_tasks
  for update to authenticated
  using (public.pm_is_manager(workspace_id)
         or assignee_id = public.pm_member_id(workspace_id))
  with check (public.pm_is_manager(workspace_id)
         or assignee_id = public.pm_member_id(workspace_id));

-- Assignment is a manager action. Without this a member could pass their own
-- work to someone else, or move its due date, using the same update right that
-- lets them mark it Done.
create or replace function public.pm_guard_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.pm_is_manager(new.workspace_id) then return new; end if;

  if new.assignee_id is distinct from old.assignee_id then
    raise exception 'Only Shane, Elvis or Zaida can reassign a task';
  end if;
  if new.due_date is distinct from old.due_date then
    raise exception 'Only a manager can change a task due date';
  end if;
  if new.campaign_id is distinct from old.campaign_id
     or new.task_type is distinct from old.task_type then
    raise exception 'Only a manager can move a task between campaigns or types';
  end if;

  return new;
end $$;

drop trigger if exists pm_tasks_guard on public.pm_tasks;
create trigger pm_tasks_guard before update on public.pm_tasks
  for each row execute function public.pm_guard_task_update();

-- ---------------------------------------------------------------------------
-- 9. Activity log. Append-only, and you sign your own entries.
-- ---------------------------------------------------------------------------
create policy pm_task_activity_read on public.pm_task_activity
  for select to authenticated
  using (exists (select 1 from public.pm_tasks t
                  where t.id = task_id and public.pm_is_active(t.workspace_id)));
create policy pm_task_activity_insert on public.pm_task_activity
  for insert to authenticated
  with check (exists (select 1 from public.pm_tasks t
                       where t.id = task_id
                         and actor_id = public.pm_member_id(t.workspace_id)));

-- ---------------------------------------------------------------------------
-- 10. Money and analytics: restricted by role, not by tier alone.
-- ---------------------------------------------------------------------------
create policy pm_task_financials_read on public.pm_task_financials
  for select to authenticated using (public.pm_can_see_budget(workspace_id));
create policy pm_task_financials_write on public.pm_task_financials
  for all to authenticated
  using (public.pm_can_see_budget(workspace_id)) with check (public.pm_can_see_budget(workspace_id));

create policy pm_task_metrics_read on public.pm_task_metrics
  for select to authenticated using (public.pm_can_see_analytics(workspace_id));
create policy pm_task_metrics_write on public.pm_task_metrics
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));

-- ---------------------------------------------------------------------------
-- 11. Operational configuration. Managers only -- pm_reporting_mappings holds
--     Supermetrics query identifiers and pm_notification_settings holds the
--     Teams webhook URL.
-- ---------------------------------------------------------------------------
create policy pm_reporting_mappings_manage on public.pm_reporting_mappings
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));
create policy pm_notification_settings_manage on public.pm_notification_settings
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));

create policy pm_sync_conflicts_read on public.pm_sync_conflicts
  for select to authenticated
  using (exists (select 1 from public.pm_campaigns c
                  where c.id = campaign_id and public.pm_is_active(c.workspace_id)));
create policy pm_sync_conflicts_manage on public.pm_sync_conflicts
  for all to authenticated
  using (exists (select 1 from public.pm_campaigns c
                  where c.id = campaign_id and public.pm_is_manager(c.workspace_id)))
  with check (exists (select 1 from public.pm_campaigns c
                       where c.id = campaign_id and public.pm_is_manager(c.workspace_id)));

create policy pm_meetings_read on public.pm_meetings
  for select to authenticated using (public.pm_is_active(workspace_id));
create policy pm_meetings_manage on public.pm_meetings
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));
