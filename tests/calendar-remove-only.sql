-- Controlled integration test. Creates only temporary academic records, then ROLLBACK.
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
create temporary table calendar_remove_cases(kind text, entity_id uuid, table_name text, original jsonb);
do $$
declare
    owner_id uuid := auth.uid();
    subject_id uuid; project_id uuid; stage_id uuid; test_id uuid;
    item record; result jsonb; after_row jsonb; count_before integer; count_after integer;
    subtask_before jsonb; subtask_after jsonb; denied boolean := false;
begin
    if owner_id is null then raise exception 'Test requires an existing authenticated user'; end if;
    insert into public.subjects(user_id,name) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY') returning id into subject_id;
    insert into public.tasks(user_id,title,subject_id,due_time) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY',subject_id,'12:00') returning id into test_id;
    insert into calendar_remove_cases values('task',test_id,'tasks',null);
    insert into public.events(user_id,title) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY') returning id into test_id;
    insert into calendar_remove_cases values('event',test_id,'events',null);
    insert into public.evaluations(user_id,subject_id,title,evaluation_date,show_in_calendar)
        values(owner_id,subject_id,'PRUEBA CALENDAR REMOVE ONLY',current_date+2,true) returning id into test_id;
    insert into calendar_remove_cases values('evaluation',test_id,'evaluations',null);
    insert into public.projects(user_id,title,due_date,show_in_calendar) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY',current_date+2,true) returning id into project_id;
    insert into calendar_remove_cases values('project',project_id,'projects',null);
    insert into public.goals(user_id,title,project_id,target_date,show_in_calendar) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY',project_id,current_date+2,true) returning id into test_id;
    insert into calendar_remove_cases values('goal',test_id,'goals',null);
    insert into public.project_stages(user_id,title,project_id,due_date,show_in_calendar) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY',project_id,current_date+2,true) returning id into stage_id;
    insert into calendar_remove_cases values('stage',stage_id,'project_stages',null);
    insert into public.project_subtasks(user_id,title,project_id,stage_id) values(owner_id,'PRUEBA CALENDAR REMOVE ONLY',project_id,stage_id) returning to_jsonb(project_subtasks.*) into subtask_before;
    for item in select * from calendar_remove_cases loop
        execute format('select to_jsonb(e) from public.%I e where id=$1',item.table_name) into after_row using item.entity_id;
        update calendar_remove_cases set original=after_row where kind=item.kind;
        insert into public.google_calendar_manual_links(user_id,entity_type,entity_id) values(owner_id,item.kind,item.entity_id);
    end loop;
    for item in select * from calendar_remove_cases loop
        execute format('select count(*) from public.%I',item.table_name) into count_before;
        result := public.remove_from_academic_calendar(item.kind,item.entity_id);
        execute format('select count(*) from public.%I',item.table_name) into count_after;
        if count_before<>count_after then raise exception 'Academic count changed: %',item.kind; end if;
        execute format('select to_jsonb(e) from public.%I e where id=$1',item.table_name) into after_row using item.entity_id;
        if after_row is null then raise exception 'Academic entity deleted: %',item.kind; end if;
        if item.kind in ('task','event') then
            if after_row<>item.original or (result->>'hidden')::boolean then raise exception 'Task/event modified'; end if;
        else
            if (after_row->>'show_in_calendar')::boolean then raise exception 'Visibility not persisted'; end if;
            if (after_row-'show_in_calendar'-'updated_at')<>(item.original-'show_in_calendar'-'updated_at') then raise exception 'Academic content modified'; end if;
            execute format('update public.%I set show_in_calendar=true where id=$1 and user_id=$2',item.table_name) using item.entity_id,owner_id;
            execute format('select to_jsonb(e) from public.%I e where id=$1',item.table_name) into after_row using item.entity_id;
            if not (after_row->>'show_in_calendar')::boolean then raise exception 'Cannot restore visibility'; end if;
        end if;
        if exists(select 1 from public.google_calendar_manual_links where user_id=owner_id and entity_type=item.kind and entity_id=item.entity_id) then raise exception 'Manual link remains'; end if;
        if not (result->>'had_confirmation')::boolean then raise exception 'Confirmation not reported'; end if;
    end loop;
    select to_jsonb(s) into subtask_after from public.project_subtasks s where id=(subtask_before->>'id')::uuid;
    if subtask_after is distinct from subtask_before then raise exception 'Subtask modified'; end if;
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    begin
        perform public.remove_from_academic_calendar('project',project_id);
    exception when insufficient_privilege then denied:=true;
    end;
    perform set_config('request.jwt.claim.sub',owner_id::text,true);
    if not denied then raise exception 'Cross-account operation allowed'; end if;
end;
$$;
select 'PASS: six academic counts unchanged; all content preserved; subtasks intact; confirmations removed; visibility restored; cross-account denied; test records rolled back' as result;
rollback;
