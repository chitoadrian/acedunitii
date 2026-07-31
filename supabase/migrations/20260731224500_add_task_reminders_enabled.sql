alter table public.tasks
  add column if not exists reminders_enabled boolean;

update public.tasks as task
set reminders_enabled = coalesce(
  (
    select preference.reminders_enabled
    from public.user_preferences as preference
    where preference.user_id = task.user_id
  ),
  false
)
where task.reminders_enabled is null;

alter table public.tasks
  alter column reminders_enabled set default false,
  alter column reminders_enabled set not null;

comment on column public.tasks.reminders_enabled is
  'Controls whether this task participates in the real 24-hour and 2-hour reminder system.';

create or replace function public.reset_task_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();

  if new.status <> 'pending' then
    update public.task_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where task_id = new.id and status <> 'sent';
    update public.internal_notifications
       set read_at = coalesce(read_at, now())
     where task_id = new.id and read_at is null;
  elsif old.reminders_enabled is true and new.reminders_enabled is false then
    update public.task_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where task_id = new.id and status <> 'sent';
    update public.internal_notifications
       set read_at = coalesce(read_at, now())
     where task_id = new.id and read_at is null;
  elsif old.reminders_enabled is false and new.reminders_enabled is true then
    delete from public.task_reminder_deliveries
     where task_id = new.id and status <> 'sent';
    delete from public.internal_notifications
     where task_id = new.id and read_at is null;
  elsif old.status is distinct from new.status
     or old.due_date is distinct from new.due_date
     or old.due_time is distinct from new.due_time then
    delete from public.task_reminder_deliveries where task_id = new.id;
    delete from public.internal_notifications where task_id = new.id;
  end if;

  return new;
end;
$function$;
