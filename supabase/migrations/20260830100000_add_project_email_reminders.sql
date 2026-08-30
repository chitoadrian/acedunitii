-- Real email reminders for AC Edunity project stages and subtasks.

alter table public.project_stages
  add column if not exists due_time time without time zone,
  add column if not exists reminders_enabled boolean not null default false;

alter table public.project_subtasks
  add column if not exists due_time time without time zone,
  add column if not exists reminders_enabled boolean not null default false;

comment on column public.project_stages.due_time is
  'Student-selected due time in America/Guayaquil. Required when reminders_enabled is true.';
comment on column public.project_stages.reminders_enabled is
  'Enables the isolated 24-hour and 2-hour stage email reminders.';
comment on column public.project_subtasks.due_time is
  'Student-selected due time in America/Guayaquil. Required when reminders_enabled is true.';
comment on column public.project_subtasks.reminders_enabled is
  'Enables the isolated 24-hour and 2-hour subtask email reminders.';

alter table public.project_stages
  drop constraint if exists project_stages_reminder_schedule_check;
alter table public.project_stages
  add constraint project_stages_reminder_schedule_check
  check (not reminders_enabled or (due_date is not null and due_time is not null));

alter table public.project_subtasks
  drop constraint if exists project_subtasks_reminder_schedule_check;
alter table public.project_subtasks
  add constraint project_subtasks_reminder_schedule_check
  check (not reminders_enabled or (due_date is not null and due_time is not null));

create table if not exists public.project_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('stage', 'subtask')),
  entity_id uuid not null,
  reminder_type text not null check (reminder_type in ('due_24h', 'due_2h')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 3),
  sent_at timestamptz,
  last_error text,
  resend_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, reminder_type)
);

comment on table public.project_reminder_deliveries is
  'Server-only idempotency ledger for project stage and subtask reminder emails.';

create index if not exists project_reminder_deliveries_user_idx
  on public.project_reminder_deliveries (user_id, created_at desc);

create index if not exists project_reminder_deliveries_status_schedule_idx
  on public.project_reminder_deliveries (status, scheduled_for)
  where status in ('pending', 'failed', 'sending');

create index if not exists project_stages_reminder_lookup_idx
  on public.project_stages (due_date, due_time, user_id)
  where reminders_enabled is true
    and due_date is not null
    and due_time is not null
    and status <> 'completed';

create index if not exists project_subtasks_reminder_lookup_idx
  on public.project_subtasks (due_date, due_time, user_id)
  where reminders_enabled is true
    and due_date is not null
    and due_time is not null
    and status <> 'completed';

alter table public.project_reminder_deliveries enable row level security;
revoke all on public.project_reminder_deliveries from anon, authenticated;

create or replace function public.reset_project_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_type text := case when tg_table_name = 'project_stages' then 'stage' else 'subtask' end;
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

drop trigger if exists reset_project_stage_reminder_schedule_trigger on public.project_stages;
create trigger reset_project_stage_reminder_schedule_trigger
after update or delete on public.project_stages
for each row execute function public.reset_project_reminder_schedule();

drop trigger if exists reset_project_subtask_reminder_schedule_trigger on public.project_subtasks;
create trigger reset_project_subtask_reminder_schedule_trigger
after update or delete on public.project_subtasks
for each row execute function public.reset_project_reminder_schedule();

revoke execute on function public.reset_project_reminder_schedule() from public, anon, authenticated;
grant execute on function public.reset_project_reminder_schedule() to postgres, service_role;
