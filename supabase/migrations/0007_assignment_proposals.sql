-- 0007: pre-assignment as a proposal, not a fact.
--
-- An import routes work by asset type, but routing is a suggestion the plan
-- makes, not a decision a person made. Until someone confirms it, a task is
-- proposed: visible and owned on paper, but not yet agreed. Without this the
-- interface cannot tell "Kesia has been given this" from "the spreadsheet
-- guessed Kesia".

alter table public.pm_tasks
  add column if not exists assignment_state text not null default 'confirmed';

alter table public.pm_tasks
  drop constraint if exists pm_tasks_assignment_state_check;
alter table public.pm_tasks
  add constraint pm_tasks_assignment_state_check
  check (assignment_state in ('proposed', 'confirmed'));

-- Existing rows predate the idea, and a task somebody typed by hand was always
-- a deliberate assignment. Only imports produce proposals.
comment on column public.pm_tasks.assignment_state is
  'proposed = routed by an import and awaiting a manager''s confirmation; confirmed = agreed.';

create index if not exists pm_tasks_proposed
  on public.pm_tasks (workspace_id, assignment_state)
  where assignment_state = 'proposed';

-- 'Content' is the produced asset itself, grouped per activation rather than
-- per platform row: one Teaser video serves TikTok, Instagram, YouTube and
-- Facebook, and must not become four identical tasks.
alter table public.pm_tasks drop constraint if exists pm_tasks_task_type_check;
alter table public.pm_tasks
  add constraint pm_tasks_task_type_check
  check (task_type in ('Workflow', 'To-do', 'Post', 'Boost', 'Report', 'Content'));

-- Finer creative roles so routing can separate the two Creative Leads: an AI
-- video and a static keyline are different crafts and different people.
insert into public.pm_member_roles (workspace_id, member_id, role_slot)
select 'regency-shalina', m.id, r.role_slot
from public.pm_members m
join (values
  ('hello@regency.global',     'AI Video'),
  ('creatives@regency.global', 'Static Design')
) as r(email, role_slot) on lower(m.email) = r.email
where m.workspace_id = 'regency-shalina'
on conflict do nothing;
