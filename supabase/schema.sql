-- Run in the existing FluxPlanner Supabase project. Existing `plans` and `profiles`
-- tables remain untouched; all Project Manager tables use the pm_ prefix.
create extension if not exists pgcrypto;

create table if not exists public.pm_workspaces (
  id text primary key, name text not null, timezone text not null default 'Africa/Johannesburg', created_at timestamptz not null default now()
);
insert into public.pm_workspaces (id, name) values ('regency-shalina', 'Regency Â· Shalina Healthcare') on conflict do nothing;

create table if not exists public.pm_members (
  id uuid primary key default gen_random_uuid(), workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, display_name text not null, email text, role_slot text, is_admin boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.pm_campaigns (
  id uuid primary key default gen_random_uuid(), workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  flux_plan_id uuid references public.plans(id) on delete set null, brand text not null, division text not null, market text,
  name text not null, source text not null check (source in ('spreadsheet','fluxplanner','manual')), flux_snapshot jsonb, last_flux_sync_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists pm_campaign_flux_plan_unique on public.pm_campaigns(flux_plan_id) where flux_plan_id is not null;
create table if not exists public.pm_tasks (
  id uuid primary key default gen_random_uuid(), workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  campaign_id uuid references public.pm_campaigns(id) on delete cascade, activation_key text not null, task_type text not null check (task_type in ('Workflow','To-do','Post','Boost','Report')),
  title text not null, role_slot text, assignee_id uuid references public.pm_members(id) on delete set null, market text, platform text,
  due_date date not null, status text not null default 'Not started' check (status in ('Not started','In progress','Blocked','Done','Cancelled')),
  depends_on uuid references public.pm_tasks(id) on delete set null, budget numeric, duration_days integer, objective text, live_link text, report_state text,
  results jsonb not null default '{}'::jsonb, flux_row jsonb, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create unique index if not exists pm_task_activation_type_unique on public.pm_tasks(campaign_id, activation_key, task_type);
create table if not exists public.pm_task_activity (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.pm_tasks(id) on delete cascade, actor_id uuid references public.pm_members(id) on delete set null,
  event_type text not null, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.pm_sync_conflicts (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.pm_campaigns(id) on delete cascade, task_id uuid references public.pm_tasks(id) on delete cascade,
  field text not null, flux_value jsonb, project_manager_value jsonb, status text not null default 'Open' check (status in ('Open','Resolved')), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.pm_reporting_mappings (
  id uuid primary key default gen_random_uuid(), workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  brand text not null, market text not null, platform text not null, supermetrics_query_id text not null, enabled boolean not null default true,
  unique(workspace_id, brand, market, platform)
);
create table if not exists public.pm_notification_settings (
  workspace_id text primary key references public.pm_workspaces(id) on delete cascade, resend_sender text,
  teams_enabled boolean not null default false, teams_webhook_url text, reminder_hour smallint not null default 8 check (reminder_hour between 0 and 23)
);
create table if not exists public.pm_meetings (
  id uuid primary key default gen_random_uuid(), workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  source text not null default 'granola', external_meeting_id text not null, title text not null, meeting_date timestamptz,
  notes text, source_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, source, external_meeting_id)
);
alter table public.pm_tasks add column if not exists source_meeting_id uuid references public.pm_meetings(id) on delete set null;
alter table public.pm_tasks add column if not exists source_action_key text;
create unique index if not exists pm_tasks_source_action_unique on public.pm_tasks(workspace_id, source_meeting_id, source_action_key) where source_meeting_id is not null;
-- A compatibility snapshot used by the static client until a full authenticated data layer is enabled.
create table if not exists public.pm_workspace_snapshots (workspace_id text primary key references public.pm_workspaces(id) on delete cascade, data jsonb not null, updated_at timestamptz not null default now());

alter table public.pm_workspaces enable row level security;
alter table public.pm_members enable row level security;
alter table public.pm_campaigns enable row level security;
alter table public.pm_tasks enable row level security;
alter table public.pm_task_activity enable row level security;
alter table public.pm_sync_conflicts enable row level security;
alter table public.pm_reporting_mappings enable row level security;
alter table public.pm_notification_settings enable row level security;
alter table public.pm_workspace_snapshots enable row level security;
alter table public.pm_meetings enable row level security;
-- Initial internal-workspace policy. Replace with membership checks before inviting more workspaces.
create policy "Authenticated Regency staff can use PM" on public.pm_workspace_snapshots for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can read workspaces" on public.pm_workspaces for select to authenticated using (true);
create policy "Authenticated Regency staff can use members" on public.pm_members for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use campaigns" on public.pm_campaigns for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use tasks" on public.pm_tasks for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use task activity" on public.pm_task_activity for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use conflicts" on public.pm_sync_conflicts for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use reporting mappings" on public.pm_reporting_mappings for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use notification settings" on public.pm_notification_settings for all to authenticated using (true) with check (true);
create policy "Authenticated Regency staff can use meetings" on public.pm_meetings for all to authenticated using (true) with check (true);

