-- Isolated email reminders for calendar events (24 hours and 2 hours).

alter table public.events
  add column if not exists reminders_enabled boolean not null default false;

comment on column public.events.reminders_enabled is
  'Controls whether this event participates in the 24-hour and 2-hour email reminder schedule.';

create table if not exists public.event_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('due_24h', 'due_2h')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for timestamptz not null,
  event_due_at timestamptz not null,
  sent_at timestamptz,
  resend_email_id text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, reminder_type)
);

comment on table public.event_reminder_deliveries is
  'Server-only idempotency ledger for AC Edunity event reminder emails.';

create index if not exists event_reminder_deliveries_user_id_idx
  on public.event_reminder_deliveries (user_id);

create index if not exists event_reminder_deliveries_status_schedule_idx
  on public.event_reminder_deliveries (status, scheduled_for)
  where status in ('pending', 'failed', 'sending');

alter table public.event_reminder_deliveries enable row level security;
revoke all on public.event_reminder_deliveries from anon, authenticated;

create or replace function public.reset_event_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.reminders_enabled is false then
    update public.event_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where event_id = new.id and status <> 'sent';
  elsif old.reminders_enabled is distinct from new.reminders_enabled
     or old.event_date is distinct from new.event_date
     or old.event_time is distinct from new.event_time then
    delete from public.event_reminder_deliveries
     where event_id = new.id and status <> 'sent';
  end if;
  return new;
end;
$function$;

drop trigger if exists reset_event_reminder_schedule_trigger on public.events;
create trigger reset_event_reminder_schedule_trigger
before update on public.events
for each row execute function public.reset_event_reminder_schedule();

revoke execute on function public.reset_event_reminder_schedule() from public, anon, authenticated;
grant execute on function public.reset_event_reminder_schedule() to postgres, service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  if not exists (select 1 from vault.secrets where name = 'task_reminders_anon_key') then
    raise exception 'Create Vault secret task_reminders_anon_key before scheduling';
  end if;
  select jobid into existing_job from cron.job where jobname = 'event-reminders-every-15-minutes';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'event-reminders-every-15-minutes',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://pskbdeqaajprfhrjortm.supabase.co/functions/v1/event-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_anon_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'task_reminders_anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
