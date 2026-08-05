-- 0012: task types describe the team's work, not just the plan's output.
--
-- The check constraint enumerated six types, which meant a migration every
-- time the team's actual work — designing an image, cutting a video, research,
-- preparing a schedule or a presentation, comms — needed a name. The special
-- types keep their meaning in code (Post/Boost/Report drive the pipeline,
-- Content drives asset routing); the database only insists a type is a
-- reasonable label.
alter table public.pm_tasks drop constraint if exists pm_tasks_task_type_check;
alter table public.pm_tasks
  add constraint pm_tasks_task_type_check
  check (length(trim(task_type)) between 1 and 40);
