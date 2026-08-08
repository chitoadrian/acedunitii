create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null,
  description text,
  start_date date,
  due_date date,
  priority text not null default 'medium',
  status text not null default 'pending',
  show_in_calendar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_title_not_blank check (length(btrim(title)) > 0),
  constraint projects_priority_check check (priority = any (array['low', 'medium', 'high'])),
  constraint projects_status_check check (status = any (array['pending', 'in_progress', 'paused', 'completed'])),
  constraint projects_dates_check check (start_date is null or due_date is null or start_date <= due_date),
  constraint projects_calendar_date_check check (not show_in_calendar or due_date is not null),
  unique (id, user_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text,
  target_date date,
  priority text not null default 'medium',
  status text not null default 'pending',
  progress smallint not null default 0,
  show_in_calendar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_title_not_blank check (length(btrim(title)) > 0),
  constraint goals_priority_check check (priority = any (array['low', 'medium', 'high'])),
  constraint goals_status_check check (status = any (array['pending', 'in_progress', 'completed'])),
  constraint goals_progress_check check (progress between 0 and 100),
  constraint goals_calendar_date_check check (not show_in_calendar or target_date is not null)
);

create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  due_date date,
  status text not null default 'pending',
  show_in_calendar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_stages_title_not_blank check (length(btrim(title)) > 0),
  constraint project_stages_position_check check (position >= 0),
  constraint project_stages_status_check check (status = any (array['pending', 'in_progress', 'completed'])),
  constraint project_stages_calendar_date_check check (not show_in_calendar or due_date is not null),
  unique (id, project_id),
  unique (id, user_id)
);

create table public.project_subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  description text,
  due_date date,
  priority text not null default 'medium',
  status text not null default 'pending',
  show_in_calendar boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_subtasks_stage_project_fkey foreign key (stage_id, project_id)
    references public.project_stages(id, project_id) on delete cascade,
  constraint project_subtasks_title_not_blank check (length(btrim(title)) > 0),
  constraint project_subtasks_position_check check (position >= 0),
  constraint project_subtasks_priority_check check (priority = any (array['low', 'medium', 'high'])),
  constraint project_subtasks_status_check check (status = any (array['pending', 'in_progress', 'completed'])),
  constraint project_subtasks_calendar_date_check check (not show_in_calendar or due_date is not null)
);

create index projects_user_due_idx on public.projects(user_id, due_date);
create index projects_subject_idx on public.projects(subject_id);
create index goals_user_target_idx on public.goals(user_id, target_date);
create index goals_project_idx on public.goals(project_id);
create index project_stages_project_position_idx on public.project_stages(project_id, position);
create index project_subtasks_stage_position_idx on public.project_subtasks(stage_id, position);
create index project_subtasks_task_idx on public.project_subtasks(task_id) where task_id is not null;

alter table public.projects enable row level security;
alter table public.goals enable row level security;
alter table public.project_stages enable row level security;
alter table public.project_subtasks enable row level security;

grant select, insert, update, delete on public.projects, public.goals, public.project_stages, public.project_subtasks to authenticated;
revoke all on public.projects, public.goals, public.project_stages, public.project_subtasks from anon;

create policy projects_select_own on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid()))));
create policy projects_update_own on public.projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid()))));
create policy projects_delete_own on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy goals_select_own on public.goals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy goals_insert_own on public.goals for insert to authenticated
  with check ((select auth.uid()) = user_id
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))));
create policy goals_update_own on public.goals for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))));
create policy goals_delete_own on public.goals for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy project_stages_select_own on public.project_stages for select to authenticated
  using ((select auth.uid()) = user_id);
create policy project_stages_insert_own on public.project_stages for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy project_stages_update_own on public.project_stages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy project_stages_delete_own on public.project_stages for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy project_subtasks_select_own on public.project_subtasks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy project_subtasks_insert_own on public.project_subtasks for insert to authenticated
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.project_stages s where s.id = stage_id and s.project_id = project_id and s.user_id = (select auth.uid()))
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))));
create policy project_subtasks_update_own on public.project_subtasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and exists (select 1 from public.project_stages s where s.id = stage_id and s.project_id = project_id and s.user_id = (select auth.uid()))
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()))));
create policy project_subtasks_delete_own on public.project_subtasks for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.projects is 'User-owned academic projects projected into the internal calendar when enabled.';
comment on table public.goals is 'Independent or project-linked user goals with manually managed progress.';
comment on table public.project_stages is 'Ordered stages belonging to a user-owned project.';
comment on table public.project_subtasks is 'Ordered stage subtasks optionally linked to a real task.';
