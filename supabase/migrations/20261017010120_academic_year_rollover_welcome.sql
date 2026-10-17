-- Baseline existing accounts at deployment: no false welcome halfway through a cycle.
-- New accounts also begin with their first cycle already recognized.
alter table public.user_academic_year_preferences
  add column last_academic_year_welcome_seen integer not null
  default public.current_academic_start_year()
  check (last_academic_year_welcome_seen between 2026 and public.current_academic_start_year());

-- Preserve official, sequential rollover and all existing RLS/write guards.
-- This function creates year metadata only: it never copies academic content or XP.
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
    'welcome_year_id',case when pref.last_academic_year_welcome_seen<cycle and exists(
      select 1 from public.user_academic_years where user_id=owner_id and start_year<cycle) then current_id else null end,
    'years',(select jsonb_agg(to_jsonb(y) order by start_year desc) from public.user_academic_years y where user_id=owner_id));
end $$;
revoke all on function public.ensure_academic_year_for_user() from public,anon;
grant execute on function public.ensure_academic_year_for_user() to authenticated;

create function public.acknowledge_academic_year_welcome(p_academic_year_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); cycle integer := public.current_academic_start_year();
begin
  if owner_id is null or not exists(select 1 from public.user_academic_years
    where id=p_academic_year_id and user_id=owner_id and start_year=cycle) then
    raise exception 'El año lectivo no está disponible para esta cuenta.' using errcode='42501';
  end if;
  update public.user_academic_year_preferences
    set last_academic_year_welcome_seen=greatest(last_academic_year_welcome_seen,cycle),updated_at=now()
    where user_id=owner_id and last_current_start_year=cycle;
  if not found then raise exception 'Vuelve a cargar el año lectivo antes de continuar.' using errcode='42501'; end if;
  return jsonb_build_object('acknowledged',true,'year_id',p_academic_year_id);
end $$;
revoke all on function public.acknowledge_academic_year_welcome(uuid) from public,anon;
grant execute on function public.acknowledge_academic_year_welcome(uuid) to authenticated;
notify pgrst, 'reload schema';
