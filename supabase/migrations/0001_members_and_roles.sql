-- 0001: real Regency staff, job titles, and per-campaign role assignment.
--
-- A person's title is who they are; a role assignment is what they do on a
-- given campaign. They are not the same thing. One role may be held by several
-- people (internal approval is Elvis, Shane or Zaida) and one person may hold
-- several roles (Elvis coordinates process and owns paid media).

-- 1. Title is descriptive and stable. role_slot on pm_members is retained only
--    as a convenience default; pm_member_roles below is the source of truth.
alter table public.pm_members add column if not exists title text;

-- 2. Without this, re-running the seed silently duplicates the whole team.
create unique index if not exists pm_members_workspace_email_unique
  on public.pm_members (workspace_id, lower(email))
  where email is not null;

-- 3. Role assignments. campaign_id null means the workspace-wide default; a row
--    carrying a campaign_id overrides that default for that campaign only.
create table if not exists public.pm_member_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.pm_workspaces(id) on delete cascade,
  member_id uuid not null references public.pm_members(id) on delete cascade,
  campaign_id uuid references public.pm_campaigns(id) on delete cascade,
  role_slot text not null,
  created_at timestamptz not null default now()
);

-- Split into two partial indexes because null campaign_id would otherwise never
-- collide with itself, letting the same default be inserted repeatedly.
create unique index if not exists pm_member_roles_workspace_default_unique
  on public.pm_member_roles (workspace_id, member_id, role_slot)
  where campaign_id is null;
create unique index if not exists pm_member_roles_campaign_unique
  on public.pm_member_roles (workspace_id, member_id, role_slot, campaign_id)
  where campaign_id is not null;

create index if not exists pm_member_roles_lookup
  on public.pm_member_roles (workspace_id, role_slot, campaign_id);

alter table public.pm_member_roles enable row level security;

-- 4. The team. Emails are stored lower-case; regency.global addresses are
--    shared-function mailboxes, not personal ones.
insert into public.pm_members (workspace_id, display_name, email, title, is_admin) values
  ('regency-shalina', 'Elvis Falcao',        'socialpr@regency.global',  'Paid Media Owner',         true),
  ('regency-shalina', 'Shane Killeen',       'shanek@regency.global',    'Strategic Director',       true),
  ('regency-shalina', 'Kesia Burdett',       'hello@regency.global',     'Creative Lead',            false),
  ('regency-shalina', 'Tshwaraganyo Lekabe', 'creatives@regency.global', 'Creative Lead',            false),
  ('regency-shalina', 'Leon-Erasmus Maree',  'designer@regency.global',  'Video Producer & Editor',  false),
  ('regency-shalina', 'Sian Touzel',         'digital@regency.global',   'Community Manager',        false),
  ('regency-shalina', 'Zaida Kays',          'comms@regency.global',     'Process Coordinator',      false),
  ('regency-shalina', 'Nikki Dickson',       'admin@regency.global',     'Bookkeeping',              false)
-- The predicate must be restated: a partial index can only arbitrate a
-- conflict when the inference clause matches its WHERE.
on conflict (workspace_id, lower(email)) where email is not null do nothing;

-- 5. Workspace-default role assignments.
insert into public.pm_member_roles (workspace_id, member_id, role_slot)
select 'regency-shalina', m.id, r.role_slot
from public.pm_members m
join (values
  ('socialpr@regency.global',  'Paid Media Owner'),
  ('socialpr@regency.global',  'Approval Coordinator'),
  ('shanek@regency.global',    'Strategy'),
  ('shanek@regency.global',    'Approval Coordinator'),
  ('comms@regency.global',     'Approval Coordinator'),
  ('hello@regency.global',     'Creative'),
  ('creatives@regency.global', 'Creative'),
  ('designer@regency.global',  'Video Editor'),
  ('designer@regency.global',  'Production'),
  ('digital@regency.global',   'Community Manager'),
  ('admin@regency.global',     'Bookkeeping')
) as r(email, role_slot) on lower(m.email) = r.email
where m.workspace_id = 'regency-shalina'
on conflict do nothing;
