-- Real task reminder infrastructure for AC Edunity.
-- Applied to Supabase as migration: create_task_reminder_system.

alter table public.tasks
  add column if not exists due_time time without time zone,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.tasks.due_time is
  'Optional student-local due time. task-reminders uses 18:00 America/Guayaquil when null.';

create table if not exists public.task_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('due_24h','due_2h')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  scheduled_for timestamptz not null,
  task_due_at timestamptz not null,
  sent_at timestamptz,
  resend_email_id text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, reminder_type)
);

create index if not exists task_reminder_deliveries_status_schedule_idx
  on public.task_reminder_deliveries (status, scheduled_for)
  where status in ('pending','failed','sending');

alter table public.task_reminder_deliveries enable row level security;
revoke all on public.task_reminder_deliveries from anon, authenticated;

create table if not exists public.internal_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  notification_type text not null check (notification_type in ('due_24h','due_2h','overdue')),
  title text not null,
  message text not null,
  scheduled_for timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, notification_type)
);

create index if not exists internal_notifications_user_unread_idx
  on public.internal_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.internal_notifications enable row level security;
revoke all on public.internal_notifications from anon, authenticated;
grant select on public.internal_notifications to authenticated;
grant update (read_at) on public.internal_notifications to authenticated;

drop policy if exists "Users read own internal notifications" on public.internal_notifications;
create policy "Users read own internal notifications"
  on public.internal_notifications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users mark own internal notifications read" on public.internal_notifications;
create policy "Users mark own internal notifications read"
  on public.internal_notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.reset_task_reminder_schedule()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status <> 'pending' then
    update public.task_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where task_id = new.id and status <> 'sent';
    update public.internal_notifications
       set read_at = coalesce(read_at, now())
     where task_id = new.id and read_at is null;
  elsif old.status is distinct from new.status
     or old.due_date is distinct from new.due_date
     or old.due_time is distinct from new.due_time then
    delete from public.task_reminder_deliveries where task_id = new.id;
    delete from public.internal_notifications where task_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_task_reminder_schedule_trigger on public.tasks;
create trigger reset_task_reminder_schedule_trigger
before update on public.tasks
for each row execute function public.reset_task_reminder_schedule();
