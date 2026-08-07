-- 0013: platform connections and custom metrics — the rails for Meta.
--
-- pm_platform_connections holds OAuth tokens. It has RLS enabled and NO
-- policies, which in Postgres means deny-everything: no browser client can
-- read a token under any misconfiguration short of leaking the service role
-- key itself. Only Edge Functions (service role) touch this table. The
-- interface sees connections through pm_list_connections, which returns
-- names and expiry — never tokens.
--
-- Interim stance per the org plan: tokens stored while the project sits in
-- the personally-owned free org are DEV tokens for assets Elvis admins.
-- Production Shalina agency tokens wait for the Regency-owned Pro org.

create table if not exists public.pm_platform_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  platform text not null,              -- 'meta' | 'tiktok' | 'google'
  kind text not null,                  -- 'user' | 'page' | 'instagram' | 'ad_account'
  external_id text not null,           -- the platform's id for the asset
  name text,
  access_token text not null,
  token_expires_at timestamptz,        -- null = does not expire (page tokens)
  connected_by text,                   -- email of the manager who connected
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, kind, external_id)
);
alter table public.pm_platform_connections enable row level security;
-- Deliberately no policies.

-- What the interface may know: that a connection exists, not what its token is.
create or replace function public.pm_list_connections(ws text)
returns table (platform text, kind text, external_id text, name text, token_expires_at timestamptz, connected_by text)
language sql stable security definer set search_path = public as $$
  select platform, kind, external_id, name, token_expires_at, connected_by
    from public.pm_platform_connections
   where workspace_id = ws and public.pm_is_manager(ws)
   order by platform, kind, name
$$;
revoke execute on function public.pm_list_connections(text) from public;
revoke execute on function public.pm_list_connections(text) from anon;
grant execute on function public.pm_list_connections(text) to authenticated;

-- Custom metrics: a name, a formula over metric fields and workspace
-- variables ("spend_zar = spend * fx_rate"), and the variables themselves.
-- Definitions are data, so a new metric never needs a deploy.
create table if not exists public.pm_custom_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  name text not null,
  formula text not null,
  description text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table if not exists public.pm_workspace_vars (
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  name text not null,
  value numeric not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, name)
);
alter table public.pm_custom_metrics enable row level security;
alter table public.pm_workspace_vars enable row level security;
create policy pm_custom_metrics_read on public.pm_custom_metrics
  for select to authenticated using (public.pm_can_see_analytics(workspace_id));
create policy pm_custom_metrics_manage on public.pm_custom_metrics
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));
create policy pm_workspace_vars_read on public.pm_workspace_vars
  for select to authenticated using (public.pm_is_active(workspace_id));
create policy pm_workspace_vars_manage on public.pm_workspace_vars
  for all to authenticated
  using (public.pm_is_manager(workspace_id)) with check (public.pm_is_manager(workspace_id));

-- Seed the example that motivated the feature.
insert into public.pm_workspace_vars (workspace_id, name, value)
values ('regency-shalina', 'fx_rate', 18.5)
on conflict do nothing;
