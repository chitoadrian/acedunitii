-- Recreate the RPC object so PostgREST cannot retain an obsolete output signature.
drop function if exists public.get_five_day_activity();

create function public.get_five_day_activity()
returns table (
  activity_date date,
  day_key text,
  day_label text,
  full_day text,
  points integer,
  activity_count integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with local_today as (
    select (now() at time zone 'America/Guayaquil')::date as today
  ),
  activity_days as (
    select
      (local_today.today + offsets.day_offset)::date as activity_date,
      offsets.day_offset
    from local_today
    cross join generate_series(0, 4) as offsets(day_offset)
  ),
  totals as (
    select
      (activity.occurred_at at time zone 'America/Guayaquil')::date as activity_date,
      sum(activity.activity_points)::integer as points,
      count(*)::integer as activity_count
    from public.user_activity_events as activity
    cross join local_today
    where activity.user_id = (select auth.uid())
      and (activity.occurred_at at time zone 'America/Guayaquil')::date
          between local_today.today and local_today.today + 4
    group by 1
  )
  select
    days.activity_date,
    (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from days.activity_date)::integer + 1],
    (array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'])[extract(dow from days.activity_date)::integer + 1],
    (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from days.activity_date)::integer + 1],
    coalesce(totals.points, 0)::integer,
    coalesce(totals.activity_count, 0)::integer
  from activity_days as days
  left join totals using (activity_date)
  order by days.day_offset;
$function$;

revoke execute on function public.get_five_day_activity() from public;
revoke execute on function public.get_five_day_activity() from anon;
grant execute on function public.get_five_day_activity() to authenticated;

notify pgrst, 'reload schema';
