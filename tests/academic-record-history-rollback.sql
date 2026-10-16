-- Optional server-side verification, after explicit authorization. No committed test data.
-- Five synthetic tasks, exact generated UUIDs, reminders OFF; all writes roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
select set_config('academic_test.other',(select id::text from auth.users where id<>auth.uid() order by created_at limit 1),true);
set local role authenticated;
do $$
declare owner_id uuid:=auth.uid(); year_id uuid; ids uuid[]:='{}'; task_id uuid; subject_id uuid;
  grade_id uuid; item_id uuid; evaluation_id uuid; project_id uuid; stage_id uuid; subtask_id uuid;
  r jsonb; n integer; denied boolean;
begin
  if owner_id is null then raise exception 'No test owner available'; end if;
  year_id:=(public.ensure_academic_year_for_user()->>'current_id')::uuid;
  insert into public.subjects(user_id,academic_year_id,name) values(owner_id,year_id,'PRUEBA HISTORIAL AC EDUNITY - rollback') returning id into subject_id;
  for n in 1..5 loop
    insert into public.tasks(user_id,academic_year_id,subject_id,title,status,reminders_enabled)
    values(owner_id,year_id,subject_id,'PRUEBA HISTORIAL AC EDUNITY - tarea '||n,case when n=1 then 'completed' else 'pending' end,false)
    returning id into task_id;
    ids:=array_append(ids,task_id);
  end loop;
  r:=public.get_academic_year_report(year_id);
  if (select count(*) from jsonb_array_elements(r->'tasks') e where (e->>'id')::uuid=any(ids))<>5 then raise exception 'Initial report must contain 5 test tasks'; end if;
  delete from public.tasks where id=any(ids[1:2]) and user_id=owner_id;
  if (select count(*) from public.tasks where id=any(ids))<>3 then raise exception 'Workspace must contain 3 tasks'; end if;
  r:=public.get_academic_year_report(year_id);
  if (select count(*) from jsonb_array_elements(r->'tasks') e where (e->>'id')::uuid=any(ids))<>5 then raise exception 'Annual report lost test tasks'; end if;
  if (select count(*) from jsonb_array_elements(r->'tasks') e where (e->>'id')::uuid=any(ids) and (e->>'_record_deleted')::boolean)<>2 then raise exception 'Report must contain 2 deleted tasks'; end if;
  if not exists(select 1 from jsonb_array_elements(r->'tasks') e where e->>'id'=ids[1]::text and e->>'status'='completed') then raise exception 'Completed deletion lost its state'; end if;
  insert into public.grades(user_id,academic_year_id,subject_id,final_value) values(owner_id,year_id,subject_id,8) returning id into grade_id;
  insert into public.grade_items(grade_id,activity,value) values(grade_id,'PRUEBA HISTORIAL AC EDUNITY - nota',8) returning id into item_id;
  delete from public.grades where id=grade_id;
  if not exists(select 1 from public.academic_record_history where record_id=item_id and entity_type='grade_items' and user_id=owner_id) then raise exception 'Grade item cascade lost history'; end if;
  insert into public.evaluations(user_id,academic_year_id,subject_id,title,evaluation_date)
    values(owner_id,year_id,subject_id,'PRUEBA HISTORIAL AC EDUNITY - evaluación',current_date) returning id into evaluation_id;
  delete from public.evaluations where id=evaluation_id;
  delete from public.tasks where id=any(ids) and user_id=owner_id;
  delete from public.subjects where id=subject_id;
  r:=public.get_academic_year_report(year_id);
  if not exists(select 1 from jsonb_array_elements(r->'subjects') e where e->>'id'=subject_id::text and (e->>'_record_deleted')::boolean) then raise exception 'Subject snapshot missing'; end if;
  if (select count(*) from jsonb_array_elements(r->'tasks') e where (e->>'id')::uuid=any(ids))<>5 then raise exception 'Subject deletion lost tasks'; end if;
  if not exists(select 1 from jsonb_array_elements(r->'evaluations') e where e->>'id'=evaluation_id::text) then raise exception 'Evaluation snapshot missing'; end if;
  insert into public.projects(user_id,academic_year_id,title) values(owner_id,year_id,'PRUEBA HISTORIAL AC EDUNITY - proyecto') returning id into project_id;
  insert into public.project_stages(user_id,project_id,title) values(owner_id,project_id,'PRUEBA HISTORIAL AC EDUNITY - etapa') returning id into stage_id;
  insert into public.project_subtasks(user_id,project_id,stage_id,title,status) values(owner_id,project_id,stage_id,'PRUEBA HISTORIAL AC EDUNITY - subtarea','completed') returning id into subtask_id;
  delete from public.projects where id=project_id;
  if (select count(*) from public.academic_record_history where record_id in(project_id,stage_id,subtask_id))<>3 then raise exception 'Project cascade missing snapshots'; end if;
  denied:=false;
  begin update public.academic_record_history set snapshot='{}'; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'History UPDATE unexpectedly allowed'; end if;
  denied:=false;
  begin delete from public.academic_record_history; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'History DELETE unexpectedly allowed'; end if;
  denied:=false;
  begin insert into public.academic_record_history select * from public.academic_record_history; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'History INSERT unexpectedly allowed'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('academic_test.other'),true);
  if exists(select 1 from public.academic_record_history where record_id=any(ids)) then raise exception 'Cross-account history visible'; end if;
  denied:=false;
  begin perform public.get_academic_year_report(year_id); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Cross-account report unexpectedly allowed'; end if;
end $$;
rollback;
select 'PASS: real Supabase triggers/RLS/RPC; 5 -> 3 workspace / 5 report / 2 deleted; completion, subject, grade, evaluation and project cascades; no direct writes; account isolation. All changes rolled back.' as result,
  (select count(*) from public.tasks where title like 'PRUEBA HISTORIAL AC EDUNITY%') as remaining_test_tasks,
  (select count(*) from public.academic_record_history where snapshot->>'title' like 'PRUEBA HISTORIAL AC EDUNITY%' or snapshot->>'activity' like 'PRUEBA HISTORIAL AC EDUNITY%' or snapshot->>'name' like 'PRUEBA HISTORIAL AC EDUNITY%') as remaining_test_snapshots;
