-- Keep manual confirmations consistent with their source entities, including cascades.
-- Invoker security preserves the existing ownership/RLS policies.
create function public.cleanup_google_calendar_manual_link()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    delete from public.google_calendar_manual_links
    where user_id = old.user_id and entity_type = tg_argv[0] and entity_id = old.id;
    return old;
end;
$$;
revoke all on function public.cleanup_google_calendar_manual_link() from public, anon, authenticated;

create trigger cleanup_google_calendar_manual_link after delete on public.tasks
for each row execute function public.cleanup_google_calendar_manual_link('task');
create trigger cleanup_google_calendar_manual_link after delete on public.events
for each row execute function public.cleanup_google_calendar_manual_link('event');
create trigger cleanup_google_calendar_manual_link after delete on public.evaluations
for each row execute function public.cleanup_google_calendar_manual_link('evaluation');
create trigger cleanup_google_calendar_manual_link after delete on public.projects
for each row execute function public.cleanup_google_calendar_manual_link('project');
create trigger cleanup_google_calendar_manual_link after delete on public.goals
for each row execute function public.cleanup_google_calendar_manual_link('goal');
create trigger cleanup_google_calendar_manual_link after delete on public.project_stages
for each row execute function public.cleanup_google_calendar_manual_link('stage');

-- A concurrent/stale browser confirmation must not recreate a deleted entity's link.
create function public.validate_google_calendar_manual_entity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
    entity_table text;
    source_id uuid;
begin
    entity_table := case new.entity_type
        when 'task' then 'tasks' when 'event' then 'events'
        when 'evaluation' then 'evaluations' when 'project' then 'projects'
        when 'goal' then 'goals' when 'stage' then 'project_stages' end;
    if entity_table is null then
        raise exception 'Unsupported calendar entity type' using errcode = '23514';
    end if;
    execute format('select id from public.%I where id = $1 and user_id = $2 for key share', entity_table)
        into source_id using new.entity_id, new.user_id;
    if source_id is null then
        raise exception 'Calendar source entity no longer exists or is not owned by this user' using errcode = '23503';
    end if;
    return new;
end;
$$;
revoke all on function public.validate_google_calendar_manual_entity() from public, anon, authenticated;
create trigger validate_google_calendar_manual_entity
before insert or update on public.google_calendar_manual_links
for each row execute function public.validate_google_calendar_manual_entity();
