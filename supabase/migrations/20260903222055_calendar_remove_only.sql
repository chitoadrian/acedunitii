-- Calendar removal is not academic deletion. Reuse existing visibility fields.
create function public.remove_from_academic_calendar(p_entity_type text, p_entity_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    entity_table text;
    source_row jsonb;
    hide_in_agenda boolean;
    removed_links integer;
begin
    if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    entity_table := case p_entity_type
        when 'task' then 'tasks' when 'event' then 'events'
        when 'evaluation' then 'evaluations' when 'project' then 'projects'
        when 'goal' then 'goals' when 'stage' then 'project_stages' end;
    if entity_table is null then raise exception 'Unsupported calendar entity' using errcode = '22023'; end if;
    execute format('select to_jsonb(e) from public.%I e where id=$1 and user_id=$2 for update', entity_table)
        into source_row using p_entity_id, owner_id;
    if source_row is null then raise exception 'Calendar entity not found' using errcode = '42501'; end if;
    -- Tasks are not included in Agenda; events have no home outside Calendar.
    -- For these two types only the manual Google confirmation is removed.
    hide_in_agenda := p_entity_type in ('evaluation','project','goal','stage');
    if hide_in_agenda then
        execute format('update public.%I e set show_in_calendar=false where id=$1 and user_id=$2 returning to_jsonb(e)', entity_table)
            into source_row using p_entity_id, owner_id;
        if source_row is null then raise exception 'Calendar visibility update denied' using errcode = '42501'; end if;
    end if;
    delete from public.google_calendar_manual_links
    where user_id=owner_id and entity_type=p_entity_type and entity_id=p_entity_id;
    get diagnostics removed_links = row_count;
    return jsonb_build_object('hidden',hide_in_agenda,'row',source_row,'had_confirmation',removed_links>0);
end;
$$;
revoke all on function public.remove_from_academic_calendar(text,uuid) from public, anon;
grant execute on function public.remove_from_academic_calendar(text,uuid) to authenticated;
