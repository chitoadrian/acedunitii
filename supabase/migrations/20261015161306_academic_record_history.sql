-- Deleted academic records are retained for reports only. Live workspace queries stay unchanged.
create table public.academic_record_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  academic_year_id uuid not null,
  entity_type text not null check(entity_type in ('subjects','tasks','events','evaluations','attendance','resources','grades','grade_items','goals','projects','project_stages','project_subtasks')),
  record_id uuid not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  metadata jsonb not null default '{}'::jsonb,
  source_operation text not null default 'DELETE' check(source_operation='DELETE'),
  deleted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key(academic_year_id,user_id) references public.user_academic_years(id,user_id) on delete cascade,
  unique(user_id,academic_year_id,entity_type,record_id),
  check(snapshot->>'id'=record_id::text and snapshot->>'academic_year_id'=academic_year_id::text)
);
-- The unique index also covers owner/year report lookups; no redundant scope index.
create index academic_record_history_entity_idx on public.academic_record_history(entity_type,record_id);
alter table public.academic_record_history enable row level security;
revoke all on public.academic_record_history from public,anon,authenticated,service_role;
grant select on public.academic_record_history to authenticated,service_role;
create policy academic_history_select_own on public.academic_record_history for select to authenticated
using(user_id=(select auth.uid()) and academic_year_id in (select id from public.user_academic_years where user_id=(select auth.uid())));
comment on table public.academic_record_history is 'Append-only deletion snapshots. No client writes. Account/year removal cascades for privacy; not a recovery or workspace table.';

-- Definer is required only for the trigger to insert into the write-revoked ledger.
-- It is private, has a fixed search_path and cannot be called as an API endpoint.
create function private.archive_academic_record() returns trigger
language plpgsql security definer set search_path='' as $$
declare record_json jsonb:=to_jsonb(old); owner_id uuid; year_id uuid:=(record_json->>'academic_year_id')::uuid;
  context jsonb:='{}'::jsonb;
begin
  if tg_table_schema<>'public' or tg_op<>'DELETE' then raise exception 'Invalid archive source'; end if;
  if tg_table_name='grade_items' then
    -- A cascading DELETE runs after the grade has disappeared. Its BEFORE snapshot is already present.
    select g.user_id into owner_id from public.grades g where g.id=old.grade_id and g.academic_year_id=year_id;
    if owner_id is null then
      select h.user_id into owner_id from public.academic_record_history h
      where h.entity_type='grades' and h.record_id=old.grade_id and h.academic_year_id=year_id;
    end if;
  else owner_id:=(record_json->>'user_id')::uuid;
  end if;
  if owner_id is null then select user_id into owner_id from public.user_academic_years where id=year_id; end if;
  -- Do not retain data during account teardown; do not block the established Auth cascade.
  if not exists(select 1 from auth.users where id=owner_id) then return old; end if;
  if not exists(select 1 from public.user_academic_years where id=year_id and user_id=owner_id) then
    raise exception 'Academic archive owner/year mismatch' using errcode='23514';
  end if;
  if tg_table_name='subjects' then
    -- SET NULL children remain live. Preserve their former subject association without changing them.
    select jsonb_build_object('related_records',jsonb_object_agg(t,ids)) into context from (
      select 'tasks' t,coalesce(jsonb_agg(id),'[]') ids from public.tasks where subject_id=old.id and user_id=owner_id
      union all select 'events',coalesce(jsonb_agg(id),'[]') from public.events where subject_id=old.id and user_id=owner_id
      union all select 'evaluations',coalesce(jsonb_agg(id),'[]') from public.evaluations where subject_id=old.id and user_id=owner_id
      union all select 'attendance',coalesce(jsonb_agg(id),'[]') from public.attendance where subject_id=old.id and user_id=owner_id
      union all select 'resources',coalesce(jsonb_agg(id),'[]') from public.resources where subject_id=old.id and user_id=owner_id
      union all select 'grades',coalesce(jsonb_agg(id),'[]') from public.grades where subject_id=old.id and user_id=owner_id
      union all select 'goals',coalesce(jsonb_agg(id),'[]') from public.goals where subject_id=old.id and user_id=owner_id
      union all select 'projects',coalesce(jsonb_agg(id),'[]') from public.projects where subject_id=old.id and user_id=owner_id
    ) relations;
  elsif tg_table_name='projects' then
    context:=jsonb_build_object(
      'stage_ids',(select coalesce(jsonb_agg(id),'[]') from public.project_stages where project_id=old.id and user_id=owner_id),
      'subtask_ids',(select coalesce(jsonb_agg(id),'[]') from public.project_subtasks where project_id=old.id and user_id=owner_id),
      'goal_ids',(select coalesce(jsonb_agg(id),'[]') from public.goals where project_id=old.id and user_id=owner_id));
  elsif tg_table_name='project_stages' then
    context:=jsonb_build_object('subtask_ids',(select coalesce(jsonb_agg(id),'[]') from public.project_subtasks where stage_id=old.id and user_id=owner_id));
  end if;
  insert into public.academic_record_history(user_id,academic_year_id,entity_type,record_id,snapshot,metadata)
    values(owner_id,year_id,tg_table_name,old.id,record_json,context)
    on conflict(user_id,academic_year_id,entity_type,record_id) do nothing;
  return old;
end $$;
revoke all on function private.archive_academic_record() from public,anon,authenticated,service_role;
do $$ declare t text;
begin
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades','grade_items','goals','projects','project_stages','project_subtasks'] loop
    -- Runs after the existing historical-write guard. Any failure rolls back both DELETE and snapshot.
    execute format('create trigger zzz_archive_academic_record before delete on public.%I for each row execute function private.archive_academic_record()',t);
  end loop;
end $$;

create or replace function public.get_academic_year_report(p_academic_year_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); y public.user_academic_years; result jsonb; t text; rows jsonb;
begin
  if owner_id is null then raise exception 'Inicia sesión para generar el reporte.' using errcode='42501'; end if;
  select * into y from public.user_academic_years where id=p_academic_year_id and user_id=owner_id;
  if y.id is null or y.start_year>public.current_academic_start_year() then
    raise exception 'El año lectivo no está disponible para esta cuenta.' using errcode='42501';
  end if;
  result:=jsonb_build_object('year',to_jsonb(y),'generated_at',now(),'student_name',
    (select nullif(trim(full_name),'') from public.profiles where id=owner_id));
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades','projects','goals','project_stages','project_subtasks'] loop
    execute format($q$
      with live as (select e.id,(to_jsonb(e)-'file_url')||jsonb_build_object('_record_deleted',false) data
        from public.%I e where e.user_id=$1 and e.academic_year_id=$2),
      combined as (select id,data from live union all
        select h.record_id,(h.snapshot-'file_url')||jsonb_build_object('_record_deleted',true,'_deleted_at',h.deleted_at,'_history_metadata',h.metadata)
        from public.academic_record_history h where h.user_id=$1 and h.academic_year_id=$2 and h.entity_type=$3
        and not exists(select 1 from live where id=h.record_id))
      select coalesce(jsonb_agg(data order by id),'[]'::jsonb) from combined$q$,t)
      into rows using owner_id,p_academic_year_id,t;
    result:=result||jsonb_build_object(t,rows);
  end loop;
  with live as (select i.id,to_jsonb(i)||jsonb_build_object('_record_deleted',false) data from public.grade_items i
    join public.grades g on g.id=i.grade_id and g.user_id=owner_id and g.academic_year_id=p_academic_year_id
    where i.academic_year_id=p_academic_year_id),
  combined as (select id,data from live union all
    select h.record_id,h.snapshot||jsonb_build_object('_record_deleted',true,'_deleted_at',h.deleted_at)
    from public.academic_record_history h where h.entity_type='grade_items' and h.user_id=owner_id and h.academic_year_id=p_academic_year_id
    and not exists(select 1 from live where id=h.record_id))
  select coalesce(jsonb_agg(data order by id),'[]'::jsonb) into rows from combined;
  result:=result||jsonb_build_object('grade_items',rows,'activity',
    (select jsonb_build_object('count',count(*),'points',coalesce(sum(activity_points),0),
      'active_days',count(distinct (occurred_at at time zone 'America/Guayaquil')::date))
    from public.user_activity_events where user_id=owner_id and academic_year_id=p_academic_year_id));
  -- Verifiable evidence only: no invented record details, no addition to complete-record totals.
  with evidence as (
    select distinct case activity_type when 'task_created' then 'tasks' when 'task_completed' then 'tasks'
      when 'grade_recorded' then 'grades' when 'attendance_recorded' then 'attendance'
      when 'event_created' then 'events' when 'resource_added' then 'resources' end entity_type,source_id
    from public.user_activity_events where user_id=owner_id and academic_year_id=p_academic_year_id and source_id is not null
  ), missing as (
    select e.entity_type,count(*) count from evidence e where e.entity_type is not null and not exists(
      select 1 from jsonb_array_elements(result->e.entity_type) r where r->>'id'=e.source_id::text)
    group by e.entity_type
  ) select coalesce(jsonb_agg(to_jsonb(missing)),'[]') into rows from missing;
  return result||jsonb_build_object('legacy_evidence',rows,'history_scope','Complete deletion snapshots from installation onwards; prior activity evidence is separate and cannot reconstruct missing records.');
end $$;
revoke all on function public.get_academic_year_report(uuid) from public,anon;
grant execute on function public.get_academic_year_report(uuid) to authenticated;
notify pgrst,'reload schema';
