-- Real weekly academic activity for the student dashboard.
-- Applied to Supabase as migration: create_real_weekly_academic_activity

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.user_activity_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    activity_type text not null check (
        activity_type in (
            'task_created',
            'task_completed',
            'grade_recorded',
            'resource_added',
            'event_created',
            'attendance_recorded'
        )
    ),
    activity_points smallint not null check (activity_points between 1 and 10),
    source_id uuid not null,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (user_id, activity_type, source_id)
);

create index if not exists user_activity_events_user_occurred_idx
    on public.user_activity_events (user_id, occurred_at desc);

create index if not exists user_activity_events_user_type_occurred_idx
    on public.user_activity_events (user_id, activity_type, occurred_at desc);

alter table public.user_activity_events enable row level security;
revoke all on table public.user_activity_events from anon, authenticated;
grant select on table public.user_activity_events to authenticated;

drop policy if exists "Users read own academic activity" on public.user_activity_events;
create policy "Users read own academic activity"
    on public.user_activity_events
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create or replace function private.record_academic_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    event_type text;
    event_points smallint;
begin
    if tg_table_name = 'tasks' then
        if tg_op = 'INSERT' then
            event_type := 'task_created';
            event_points := 1;
        elsif tg_op = 'UPDATE'
          and new.status = 'completed'
          and old.status is distinct from 'completed' then
            event_type := 'task_completed';
            event_points := 3;
        end if;
    elsif tg_table_name = 'grades' and tg_op = 'INSERT' then
        event_type := 'grade_recorded';
        event_points := 2;
    elsif tg_table_name = 'resources' and tg_op = 'INSERT' then
        event_type := 'resource_added';
        event_points := 2;
    elsif tg_table_name = 'events' and tg_op = 'INSERT' then
        event_type := 'event_created';
        event_points := 1;
    elsif tg_table_name = 'attendance' and tg_op = 'INSERT' then
        event_type := 'attendance_recorded';
        event_points := 1;
    end if;

    if event_type is not null and new.user_id is not null and new.id is not null then
        insert into public.user_activity_events (
            user_id,
            activity_type,
            activity_points,
            source_id,
            occurred_at
        )
        values (
            new.user_id,
            event_type,
            event_points,
            new.id,
            now()
        )
        on conflict (user_id, activity_type, source_id) do nothing;
    end if;

    return new;
end;
$$;

revoke all on function private.record_academic_activity() from public, anon, authenticated;

drop trigger if exists record_task_academic_activity on public.tasks;
create trigger record_task_academic_activity
after insert or update of status on public.tasks
for each row execute function private.record_academic_activity();

drop trigger if exists record_grade_academic_activity on public.grades;
create trigger record_grade_academic_activity
after insert on public.grades
for each row execute function private.record_academic_activity();

drop trigger if exists record_resource_academic_activity on public.resources;
create trigger record_resource_academic_activity
after insert on public.resources
for each row execute function private.record_academic_activity();

drop trigger if exists record_event_academic_activity on public.events;
create trigger record_event_academic_activity
after insert on public.events
for each row execute function private.record_academic_activity();

drop trigger if exists record_attendance_academic_activity on public.attendance;
create trigger record_attendance_academic_activity
after insert on public.attendance
for each row execute function private.record_academic_activity();

insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
)
select user_id, 'task_created', 1, id, created_at
from public.tasks
where user_id is not null and created_at is not null
on conflict (user_id, activity_type, source_id) do nothing;

insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
)
select user_id, 'grade_recorded', 2, id, created_at
from public.grades
where user_id is not null and created_at is not null
on conflict (user_id, activity_type, source_id) do nothing;

insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
)
select user_id, 'resource_added', 2, id, created_at
from public.resources
where user_id is not null and created_at is not null
on conflict (user_id, activity_type, source_id) do nothing;

insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
)
select user_id, 'event_created', 1, id, created_at
from public.events
where user_id is not null and created_at is not null
on conflict (user_id, activity_type, source_id) do nothing;

insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
)
select user_id, 'attendance_recorded', 1, id, created_at
from public.attendance
where user_id is not null and created_at is not null
on conflict (user_id, activity_type, source_id) do nothing;

create or replace function public.get_weekly_activity()
returns table (
    day_index integer,
    day text,
    full_day text,
    points bigint,
    activity_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
    with week_context as (
        select date_trunc(
            'week',
            timezone('America/Guayaquil', now())
        )::date as week_start
    ),
    days as (
        select
            series.day_offset::integer as day_offset,
            (week_context.week_start + series.day_offset::integer) as local_day
        from week_context
        cross join generate_series(0, 6) as series(day_offset)
    ),
    totals as (
        select
            timezone('America/Guayaquil', activity.occurred_at)::date as local_day,
            sum(activity.activity_points)::bigint as points,
            count(*)::bigint as activity_count
        from public.user_activity_events as activity
        cross join week_context
        where activity.user_id = (select auth.uid())
          and timezone('America/Guayaquil', activity.occurred_at)::date
              between week_context.week_start and week_context.week_start + 6
        group by 1
    )
    select
        days.day_offset + 1 as day_index,
        (array['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])[days.day_offset + 1] as day,
        (array['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])[days.day_offset + 1] as full_day,
        coalesce(totals.points, 0)::bigint as points,
        coalesce(totals.activity_count, 0)::bigint as activity_count
    from days
    left join totals using (local_day)
    order by days.day_offset;
$$;

revoke all on function public.get_weekly_activity() from public, anon;
grant execute on function public.get_weekly_activity() to authenticated;
