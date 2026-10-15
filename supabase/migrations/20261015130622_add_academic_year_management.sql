-- April rollover in mainland Ecuador. March remains part of the previous cycle.
-- No UUID, academic content, reminder delivery, or profile is replaced.
create or replace function public.current_academic_start_year(p_at timestamptz default now())
returns integer language sql stable security invoker set search_path = '' as $$
  select extract(year from p_at at time zone 'America/Guayaquil')::integer
    - case when extract(month from p_at at time zone 'America/Guayaquil') < 4 then 1 else 0 end;
$$;
revoke all on function public.current_academic_start_year(timestamptz) from public, anon;
grant execute on function public.current_academic_start_year(timestamptz) to authenticated, service_role;

create table public.user_academic_years (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_year integer not null check (start_year >= 2026),
  end_year integer generated always as (start_year + 1) stored,
  label text generated always as (start_year::text || ' - ' || (start_year + 1)::text) stored,
  start_date date generated always as (make_date(start_year, 4, 1)) stored,
  end_date date generated always as (make_date(start_year + 1, 3, 1) - 1) stored,
  xp integer not null default 0 check (xp >= 0),
  streak integer not null default 0 check (streak >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, start_year),
  unique (id, user_id)
);
alter table public.user_academic_years enable row level security;
revoke all on public.user_academic_years from public, anon, authenticated;
grant select, insert, update on public.user_academic_years to authenticated;
grant all on public.user_academic_years to service_role;
create policy academic_years_select_own on public.user_academic_years for select to authenticated
  using (user_id = (select auth.uid()));
create policy academic_years_insert_own on public.user_academic_years for insert to authenticated
  with check (user_id = (select auth.uid()) and start_year <= public.current_academic_start_year());
create policy academic_years_update_own on public.user_academic_years for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.user_academic_year_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_academic_year_id uuid not null,
  last_current_start_year integer not null,
  updated_at timestamptz not null default now(),
  foreign key (selected_academic_year_id, user_id)
    references public.user_academic_years(id, user_id)
);
create index academic_year_preferences_selection_idx
  on public.user_academic_year_preferences(selected_academic_year_id, user_id);
alter table public.user_academic_year_preferences enable row level security;
revoke all on public.user_academic_year_preferences from public, anon, authenticated;
grant select, insert, update on public.user_academic_year_preferences to authenticated;
grant all on public.user_academic_year_preferences to service_role;
create policy academic_year_preferences_own on public.user_academic_year_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and last_current_start_year between 2026 and public.current_academic_start_year());

-- Every existing account starts with the same baseline, including accounts without content.
insert into public.user_academic_years(user_id, start_year, xp, streak)
select u.id, 2026, greatest(coalesce(p.xp, 0), 0), greatest(coalesce(p.streak, 0), 0)
from auth.users u left join public.profiles p on p.id = u.id
on conflict (user_id, start_year) do nothing;

insert into public.user_academic_year_preferences(user_id, selected_academic_year_id, last_current_start_year)
select user_id, id, 2026 from public.user_academic_years where start_year = 2026
on conflict (user_id) do nothing;

-- Backfill under the migration transaction. Temporarily disabling user triggers
-- avoids touching timestamps, activity ledgers, or reminder schedules during the backfill.
do $$
declare t text;
begin
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources',
    'grades','projects','goals','project_stages','project_subtasks','user_activity_events',
    'recent_activity','internal_notifications','google_calendar_manual_links','academic_notification_states']
  loop
    execute format('alter table public.%I add column academic_year_id uuid', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I e set academic_year_id=y.id from public.user_academic_years y where y.user_id=e.user_id and y.start_year=2026 and e.academic_year_id is null', t);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column academic_year_id set not null', t);
    execute format('alter table public.%I add constraint %I foreign key (academic_year_id,user_id) references public.user_academic_years(id,user_id)', t, t || '_academic_year_owner_fkey');
    execute format('create index %I on public.%I(user_id,academic_year_id)', t || '_user_academic_year_idx', t);
  end loop;
end $$;

alter table public.grade_items add column academic_year_id uuid;
update public.grade_items i set academic_year_id=g.academic_year_id from public.grades g where g.id=i.grade_id;
alter table public.grade_items alter column academic_year_id set not null;
alter table public.grade_items add constraint grade_items_academic_year_fkey
  foreign key(academic_year_id) references public.user_academic_years(id);
create index grade_items_academic_year_grade_idx on public.grade_items(academic_year_id,grade_id);

-- Preserve original FKs and their PostgREST relationship names used by workers.
-- Derived children use this trigger so the indexed year can never diverge from the parent.
create or replace function private.enforce_academic_year()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent_year uuid;
  ref_year uuid;
  owner_id uuid;
  entity_table text;
  entity_id uuid;
  record_json jsonb := to_jsonb(new);
  cycle integer := public.current_academic_start_year();
begin
  if tg_table_name = 'grade_items' then
    select g.academic_year_id, g.user_id into parent_year, owner_id from public.grades g where g.id=new.grade_id;
    if parent_year is null then raise exception 'Grade parent is unavailable' using errcode='23503'; end if;
  else
    owner_id := new.user_id;
    if tg_table_name in ('project_stages','project_subtasks') then
      select p.academic_year_id into parent_year from public.projects p where p.id=new.project_id and p.user_id=owner_id;
      if parent_year is null then raise exception 'Project parent is unavailable' using errcode='23503'; end if;
    elsif tg_table_name = 'internal_notifications' and record_json->>'task_id' is not null then
      select t.academic_year_id into parent_year from public.tasks t where t.id=new.task_id and t.user_id=owner_id;
    elsif tg_table_name in ('google_calendar_manual_links','academic_notification_states','user_activity_events') then
      if tg_table_name='google_calendar_manual_links' then
        entity_table := case new.entity_type when 'task' then 'tasks' when 'event' then 'events' when 'evaluation' then 'evaluations' when 'project' then 'projects' when 'goal' then 'goals' when 'stage' then 'project_stages' end;
        entity_id := new.entity_id;
      elsif tg_table_name='academic_notification_states' then
        entity_table := case split_part(new.notification_key,':',1) when 'task' then 'tasks' when 'event' then 'events' when 'evaluation' then 'evaluations' when 'project' then 'projects' when 'stage' then 'project_stages' when 'subtask' then 'project_subtasks' end;
        entity_id := split_part(new.notification_key,':',2)::uuid;
      else
        entity_table := case new.activity_type when 'task_created' then 'tasks' when 'task_completed' then 'tasks' when 'grade_recorded' then 'grades' when 'resource_added' then 'resources' when 'event_created' then 'events' when 'attendance_recorded' then 'attendance' end;
        entity_id := new.source_id;
      end if;
      if entity_table is not null then
        execute format('select academic_year_id from public.%I where id=$1 and user_id=$2',entity_table) into parent_year using entity_id,owner_id;
      end if;
      if parent_year is null and tg_op='INSERT' then raise exception 'Academic source is unavailable' using errcode='23503'; end if;
    end if;
  end if;
  if parent_year is not null then
    if new.academic_year_id is not null and new.academic_year_id<>parent_year then
      raise exception 'Academic year must match the parent' using errcode='23514';
    end if;
    new.academic_year_id := parent_year;
  end if;
  if new.academic_year_id is null then
    -- Compatibility for existing server producers. New clients always pass the selected year.
    select selected_academic_year_id into new.academic_year_id from public.user_academic_year_preferences
      where user_id=owner_id and last_current_start_year>=cycle;
    if new.academic_year_id is null then
      insert into public.user_academic_years(user_id,start_year) values(owner_id,cycle) on conflict(user_id,start_year) do nothing;
      select id into new.academic_year_id from public.user_academic_years where user_id=owner_id and start_year=cycle;
    end if;
  end if;
  if tg_op='UPDATE' and old.academic_year_id is distinct from new.academic_year_id then
    raise exception 'An academic record cannot be moved to another year' using errcode='23514';
  end if;
  if record_json->>'subject_id' is not null then
    select s.academic_year_id into ref_year from public.subjects s where s.id=(record_json->>'subject_id')::uuid and s.user_id=owner_id;
    if ref_year is distinct from new.academic_year_id then raise exception 'Subject belongs to another academic year or account' using errcode='23514'; end if;
  end if;
  if tg_table_name='goals' and record_json->>'project_id' is not null then
    select p.academic_year_id into ref_year from public.projects p where p.id=new.project_id and p.user_id=owner_id;
    if ref_year is distinct from new.academic_year_id then raise exception 'Project belongs to another academic year or account' using errcode='23514'; end if;
  end if;
  if tg_table_name='project_subtasks' then
    select s.academic_year_id into ref_year from public.project_stages s where s.id=new.stage_id and s.project_id=new.project_id and s.user_id=owner_id;
    if ref_year is distinct from new.academic_year_id then raise exception 'Stage belongs to another academic year or account' using errcode='23514'; end if;
    if new.task_id is not null then
      select t.academic_year_id into ref_year from public.tasks t where t.id=new.task_id and t.user_id=owner_id;
      if ref_year is distinct from new.academic_year_id then raise exception 'Task belongs to another academic year or account' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_academic_year() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades',
    'grade_items','projects','goals','project_stages','project_subtasks','user_activity_events',
    'recent_activity','internal_notifications','google_calendar_manual_links','academic_notification_states']
  loop
    execute format('create trigger enforce_academic_year before insert or update on public.%I for each row execute function private.enforce_academic_year()',t);
  end loop;
end $$;

-- Calendar/year identity is immutable; progress remains editable through the existing XP flow.
create function private.protect_academic_year_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.id,new.user_id,new.start_year) is distinct from (old.id,old.user_id,old.start_year) then
    raise exception 'Academic year identity is immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.protect_academic_year_identity() from public,anon,authenticated;
create trigger protect_academic_year_identity before update on public.user_academic_years
for each row execute function private.protect_academic_year_identity();

create function public.ensure_academic_year_for_user() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); cycle integer := public.current_academic_start_year(); current_id uuid; pref public.user_academic_year_preferences;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.user_academic_years(user_id,start_year) values(owner_id,cycle) on conflict(user_id,start_year) do nothing;
  select id into current_id from public.user_academic_years where user_id=owner_id and start_year=cycle;
  insert into public.user_academic_year_preferences(user_id,selected_academic_year_id,last_current_start_year)
    values(owner_id,current_id,cycle) on conflict(user_id) do nothing;
  select * into pref from public.user_academic_year_preferences where user_id=owner_id for update;
  if pref.last_current_start_year<cycle then
    update public.user_academic_year_preferences set selected_academic_year_id=current_id,last_current_start_year=cycle,updated_at=now()
      where user_id=owner_id returning * into pref;
  end if;
  return jsonb_build_object('current_id',current_id,'selected_id',pref.selected_academic_year_id,
    'years',(select jsonb_agg(to_jsonb(y) order by start_year desc) from public.user_academic_years y where user_id=owner_id));
end $$;
revoke all on function public.ensure_academic_year_for_user() from public,anon;
grant execute on function public.ensure_academic_year_for_user() to authenticated;

create function public.increment_academic_year_progress(p_year_id uuid,p_delta integer,p_bump_streak boolean default false)
returns public.user_academic_years language sql security invoker set search_path='' as $$
  update public.user_academic_years set xp=greatest(0,xp+p_delta),
    streak=case when p_bump_streak then greatest(1,streak) else streak end
  where id=p_year_id and user_id=(select auth.uid()) returning *;
$$;
revoke all on function public.increment_academic_year_progress(uuid,integer,boolean) from public,anon;
grant execute on function public.increment_academic_year_progress(uuid,integer,boolean) to authenticated;

-- Keep the established five-day blocks, adding an explicit cycle parameter.
create function public.get_five_day_activity(p_academic_year_id uuid)
returns table(activity_date date,day_key text,day_label text,full_day text,points integer,activity_count integer)
language sql stable security invoker set search_path='' as $$
  with context as (
    select date '2026-07-31' + (floor(((now() at time zone 'America/Guayaquil')::date-date '2026-07-31')::numeric/5)::integer*5) as block_start
  ), days as (
    select block_start+n as activity_date,n from context cross join generate_series(0,4) n
  ), totals as (
    select (a.occurred_at at time zone 'America/Guayaquil')::date activity_date,sum(a.activity_points)::integer points,count(*)::integer activity_count
    from public.user_activity_events a cross join context c
    where a.user_id=(select auth.uid()) and a.academic_year_id=p_academic_year_id
      and a.occurred_at >= (c.block_start::timestamp at time zone 'America/Guayaquil')
      and a.occurred_at < ((c.block_start+5)::timestamp at time zone 'America/Guayaquil') group by 1
  ) select d.activity_date,(array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from d.activity_date)::integer+1],
    (array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'])[extract(dow from d.activity_date)::integer+1],
    (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from d.activity_date)::integer+1],
    coalesce(t.points,0),coalesce(t.activity_count,0) from days d left join totals t using(activity_date) order by d.n;
$$;
revoke all on function public.get_five_day_activity(uuid) from public,anon;
grant execute on function public.get_five_day_activity(uuid) to authenticated,service_role;

-- Older callers also resolve a cycle rather than aggregating all of the user's years.
create or replace function public.get_five_day_activity()
returns table(activity_date date,day_key text,day_label text,full_day text,points integer,activity_count integer)
language sql stable security invoker set search_path='' as $$
  select * from public.get_five_day_activity((select selected_academic_year_id
    from public.user_academic_year_preferences where user_id=(select auth.uid())));
$$;

notify pgrst, 'reload schema';

-- Scope the existing Calendar action without changing its removal semantics.
create function public.remove_from_academic_calendar(p_entity_type text,p_entity_id uuid,p_academic_year_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare entity_table text; found_id uuid;
begin
  entity_table := case p_entity_type when 'task' then 'tasks' when 'event' then 'events'
    when 'evaluation' then 'evaluations' when 'project' then 'projects' when 'goal' then 'goals' when 'stage' then 'project_stages' end;
  if entity_table is null then raise exception 'Unsupported calendar entity' using errcode='22023'; end if;
  execute format('select id from public.%I where id=$1 and user_id=$2 and academic_year_id=$3',entity_table)
    into found_id using p_entity_id,auth.uid(),p_academic_year_id;
  if found_id is null then raise exception 'Calendar entity is outside the selected year' using errcode='42501'; end if;
  return public.remove_from_academic_calendar(p_entity_type,p_entity_id);
end $$;
revoke all on function public.remove_from_academic_calendar(text,uuid,uuid) from public,anon;
grant execute on function public.remove_from_academic_calendar(text,uuid,uuid) to authenticated;
