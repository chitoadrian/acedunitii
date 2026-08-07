create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null,
  evaluation_type text not null default 'Examen',
  evaluation_date date not null,
  evaluation_time time without time zone,
  topics text[] not null default '{}'::text[],
  description text,
  status text not null default 'pending',
  priority text not null default 'medium',
  show_in_calendar boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evaluations_title_not_blank check (length(btrim(title)) > 0),
  constraint evaluations_type_check check (evaluation_type = any (array['Examen', 'Prueba', 'Lección', 'Quiz', 'Exposición', 'Evaluación práctica', 'Otro'])),
  constraint evaluations_status_check check (status = any (array['pending', 'preparing', 'prepared', 'completed'])),
  constraint evaluations_priority_check check (priority = any (array['low', 'medium', 'high']))
);

comment on table public.evaluations is 'Per-user academic evaluations shown in Evaluaciones and optionally in the internal calendar.';
comment on column public.evaluations.evaluation_time is 'Optional student-local time in America/Guayaquil.';
comment on column public.evaluations.show_in_calendar is 'When true, the frontend projects this row into the internal calendar without duplicating it in events.';

create index if not exists evaluations_user_date_idx
  on public.evaluations (user_id, evaluation_date, evaluation_time);
create index if not exists evaluations_user_status_idx
  on public.evaluations (user_id, status);
create index if not exists evaluations_subject_id_idx
  on public.evaluations (subject_id);

alter table public.evaluations enable row level security;

grant select, insert, update, delete on table public.evaluations to authenticated;
revoke all on table public.evaluations from anon;

create policy evaluations_select_own
  on public.evaluations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy evaluations_insert_own
  on public.evaluations
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and subject_id is not null
    and exists (
      select 1
      from public.subjects
      where subjects.id = subject_id
        and subjects.user_id = (select auth.uid())
    )
  );

create policy evaluations_update_own
  on public.evaluations
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and subject_id is not null
    and exists (
      select 1
      from public.subjects
      where subjects.id = subject_id
        and subjects.user_id = (select auth.uid())
    )
  );

create policy evaluations_delete_own
  on public.evaluations
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
