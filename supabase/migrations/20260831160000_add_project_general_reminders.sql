-- Extend the existing project-reminders system to general projects.

alter table public.projects
  add column if not exists due_time time without time zone,
  add column if not exists reminders_enabled boolean not null default false;

comment on column public.projects.due_time is
  'Student-selected project due time in America/Guayaquil. Required when reminders_enabled is true.';
comment on column public.projects.reminders_enabled is
  'Enables the existing 24-hour and 2-hour project-reminders email flow for the general project.';

alter table public.projects
  drop constraint if exists projects_reminder_schedule_check;
alter table public.projects
  add constraint projects_reminder_schedule_check
  check (not reminders_enabled or (due_date is not null and due_time is not null));

alter table public.project_reminder_deliveries
  drop constraint if exists project_reminder_deliveries_entity_type_check;
alter table public.project_reminder_deliveries
  add constraint project_reminder_deliveries_entity_type_check
  check (entity_type in ('project', 'stage', 'subtask'));

comment on table public.project_reminder_deliveries is
  'Server-only idempotency ledger for general project, stage, and subtask reminder emails.';

create index if not exists projects_reminder_lookup_idx
  on public.projects (due_date, due_time, user_id)
  where reminders_enabled is true
    and due_date is not null
    and due_time is not null
    and status <> 'completed';

create or replace function public.reset_project_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_type text := case tg_table_name
    when 'projects' then 'project'
    when 'project_stages' then 'stage'
    else 'subtask'
  end;
begin
  if tg_op = 'DELETE' then
    delete from public.project_reminder_deliveries
     where entity_type = target_type and entity_id = old.id;
    return old;
  end if;

  if new.reminders_enabled is false or new.status = 'completed' then
    update public.project_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where entity_type = target_type
       and entity_id = new.id
       and status <> 'sent';
  elsif old.reminders_enabled is distinct from new.reminders_enabled
     or old.due_date is distinct from new.due_date
     or old.due_time is distinct from new.due_time
     or old.status is distinct from new.status then
    delete from public.project_reminder_deliveries
     where entity_type = target_type
       and entity_id = new.id
       and status <> 'sent';
  end if;

  return new;
end;
$function$;

drop trigger if exists reset_project_reminder_schedule_trigger on public.projects;
create trigger reset_project_reminder_schedule_trigger
after update or delete on public.projects
for each row execute function public.reset_project_reminder_schedule();

revoke execute on function public.reset_project_reminder_schedule() from public, anon, authenticated;
grant execute on function public.reset_project_reminder_schedule() to postgres, service_role;
