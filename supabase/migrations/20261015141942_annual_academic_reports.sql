-- Calendar authority stays on the server. Existing academic rows are not changed.
create function private.guard_academic_year_creation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare latest integer; cycle integer := public.current_academic_start_year();
begin
  if new.start_year > cycle then
    raise exception 'No puedes cambiar al próximo año lectivo todavía.' using errcode='22023';
  end if;
  if exists(select 1 from public.user_academic_years where user_id=new.user_id and start_year=new.start_year) then return new; end if;
  select max(start_year) into latest from public.user_academic_years where user_id=new.user_id and start_year<=cycle;
  if new.start_year <> coalesce(latest+1,cycle) then
    raise exception 'Los años lectivos se habilitan secuencialmente según la fecha oficial.' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.guard_academic_year_creation() from public,anon,authenticated;
create trigger guard_academic_year_creation before insert on public.user_academic_years
for each row execute function private.guard_academic_year_creation();

alter policy academic_years_select_own on public.user_academic_years
using (user_id=(select auth.uid()) and start_year<=(select public.current_academic_start_year()));
alter policy academic_years_update_own on public.user_academic_years
using (user_id=(select auth.uid()) and start_year=(select public.current_academic_start_year()))
with check (user_id=(select auth.uid()) and start_year=(select public.current_academic_start_year()));
alter policy academic_year_preferences_own on public.user_academic_year_preferences
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()) and last_current_start_year=(select public.current_academic_start_year())
  and selected_academic_year_id in (select id from public.user_academic_years where user_id=(select auth.uid())));

create or replace function public.ensure_academic_year_for_user() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); cycle integer := public.current_academic_start_year();
  latest integer; next_year integer; current_id uuid; pref public.user_academic_year_preferences;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select max(start_year) into latest from public.user_academic_years where user_id=owner_id;
  for next_year in coalesce(latest+1,cycle)..cycle loop
    insert into public.user_academic_years(user_id,start_year) values(owner_id,next_year) on conflict(user_id,start_year) do nothing;
  end loop;
  select id into current_id from public.user_academic_years where user_id=owner_id and start_year=cycle;
  insert into public.user_academic_year_preferences(user_id,selected_academic_year_id,last_current_start_year)
    values(owner_id,current_id,cycle) on conflict(user_id) do nothing;
  select * into pref from public.user_academic_year_preferences where user_id=owner_id for update;
  if pref.last_current_start_year<>cycle or not exists(select 1 from public.user_academic_years where id=pref.selected_academic_year_id and user_id=owner_id) then
    update public.user_academic_year_preferences set selected_academic_year_id=current_id,last_current_start_year=cycle,updated_at=now()
      where user_id=owner_id returning * into pref;
  end if;
  return jsonb_build_object('current_id',current_id,'selected_id',pref.selected_academic_year_id,'current_start_year',cycle,
    'years',(select jsonb_agg(to_jsonb(y) order by start_year desc) from public.user_academic_years y where user_id=owner_id));
end $$;

-- Historical academic content is readable, but not editable. Trusted server
-- maintenance (including account deletion cascades without an end-user JWT) is unchanged.
create function private.guard_academic_year_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare year_id uuid; cycle_start integer;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then year_id := old.academic_year_id; else year_id := new.academic_year_id; end if;
  select start_year into cycle_start from public.user_academic_years where id=year_id and user_id=auth.uid();
  if cycle_start is null or cycle_start>public.current_academic_start_year() then
    raise exception 'El año lectivo no está disponible.' using errcode='42501';
  end if;
  if cycle_start<public.current_academic_start_year() then
    raise exception 'Año histórico: solo puedes consultar sus datos.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.guard_academic_year_write() from public,anon,authenticated;
do $$ declare t text;
begin
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades','grade_items','projects','goals','project_stages','project_subtasks'] loop
    -- Runs after the existing parent/year integrity trigger on INSERT/UPDATE.
    execute format('create trigger zz_guard_academic_year_write before insert or update or delete on public.%I for each row execute function private.guard_academic_year_write()',t);
  end loop;
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades','grade_items','projects','goals','project_stages','project_subtasks','user_activity_events','recent_activity','internal_notifications','google_calendar_manual_links','academic_notification_states'] loop
    execute format('create policy academic_year_available on public.%I as restrictive for select to authenticated using (academic_year_id in (select id from public.user_academic_years where user_id=(select auth.uid())))',t);
  end loop;
end $$;

-- One consistent read-only snapshot. No user_id parameter and no SECURITY DEFINER:
-- auth.uid(), explicit ownership predicates and existing RLS all apply.
create function public.get_academic_year_report(p_academic_year_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); y public.user_academic_years; result jsonb; t text; rows jsonb;
begin
  if owner_id is null then raise exception 'Inicia sesión para generar el reporte.' using errcode='42501'; end if;
  select * into y from public.user_academic_years where id=p_academic_year_id and user_id=owner_id;
  if y.id is null or y.start_year>public.current_academic_start_year() then
    raise exception 'El año lectivo no está disponible para esta cuenta.' using errcode='42501';
  end if;
  result := jsonb_build_object('year',to_jsonb(y),'generated_at',now(),'student_name',
    (select nullif(trim(full_name),'') from public.profiles where id=owner_id));
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources','grades','projects','goals','project_stages','project_subtasks'] loop
    execute format('select coalesce(jsonb_agg((to_jsonb(e)-''file_url'') order by e.id),''[]''::jsonb) from public.%I e where e.user_id=$1 and e.academic_year_id=$2',t)
      into rows using owner_id,p_academic_year_id;
    result := result || jsonb_build_object(t,rows);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into rows from public.grade_items i
    join public.grades g on g.id=i.grade_id and g.user_id=owner_id and g.academic_year_id=p_academic_year_id
    where i.academic_year_id=p_academic_year_id;
  result := result || jsonb_build_object('grade_items',rows,'activity',
    (select jsonb_build_object('count',count(*),'points',coalesce(sum(activity_points),0),
      'active_days',count(distinct (occurred_at at time zone 'America/Guayaquil')::date))
      from public.user_activity_events where user_id=owner_id and academic_year_id=p_academic_year_id));
  return result;
end $$;
revoke all on function public.get_academic_year_report(uuid) from public,anon;
grant execute on function public.get_academic_year_report(uuid) to authenticated;
comment on function public.get_academic_year_report(uuid) is 'Read-only annual academic snapshot; authenticated owner only, no arbitrary user identifier.';
notify pgrst,'reload schema';
