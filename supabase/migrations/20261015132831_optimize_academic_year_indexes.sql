-- Retain user-first indexes for RLS/account lookups and add year-first indexes
-- for the (academic_year_id,user_id) ownership FKs. No academic row is updated.
do $$
declare t text;
begin
  foreach t in array array['subjects','tasks','events','evaluations','attendance','resources',
    'grades','projects','goals','project_stages','project_subtasks','user_activity_events',
    'recent_activity','internal_notifications','google_calendar_manual_links','academic_notification_states']
  loop
    if t='user_activity_events' then
      execute 'create index if not exists user_activity_events_academic_year_owner_idx on public.user_activity_events(academic_year_id,user_id,occurred_at desc)';
    else
      execute format('create index if not exists %I on public.%I(academic_year_id,user_id)',t || '_academic_year_owner_idx',t);
    end if;
  end loop;
end $$;
