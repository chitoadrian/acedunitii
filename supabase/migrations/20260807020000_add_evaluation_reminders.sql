-- Isolated reminder infrastructure for evaluations (24 hours and 1 hour).

alter table public.evaluations
  add column if not exists reminders_enabled boolean not null default false;

comment on column public.evaluations.reminders_enabled is
  'Controls the isolated evaluation-reminders email schedule.';

create table if not exists public.evaluation_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('due_24h', 'due_1h')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for timestamptz not null,
  evaluation_due_at timestamptz not null,
  sent_at timestamptz,
  resend_email_id text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, reminder_type)
);

create index if not exists evaluation_reminder_deliveries_user_id_idx
  on public.evaluation_reminder_deliveries (user_id);

create index if not exists evaluation_reminder_deliveries_status_schedule_idx
  on public.evaluation_reminder_deliveries (status, scheduled_for)
  where status in ('pending', 'failed', 'sending');

alter table public.evaluation_reminder_deliveries enable row level security;
grant select, insert, update, delete on public.evaluation_reminder_deliveries to authenticated;

drop policy if exists "Users read own evaluation reminder deliveries" on public.evaluation_reminder_deliveries;
create policy "Users read own evaluation reminder deliveries"
  on public.evaluation_reminder_deliveries for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own evaluation reminder deliveries" on public.evaluation_reminder_deliveries;
create policy "Users insert own evaluation reminder deliveries"
  on public.evaluation_reminder_deliveries for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users update own evaluation reminder deliveries" on public.evaluation_reminder_deliveries;
create policy "Users update own evaluation reminder deliveries"
  on public.evaluation_reminder_deliveries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users delete own evaluation reminder deliveries" on public.evaluation_reminder_deliveries;
create policy "Users delete own evaluation reminder deliveries"
  on public.evaluation_reminder_deliveries for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reset_evaluation_reminder_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  if new.reminders_enabled is false then
    update public.evaluation_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where evaluation_id = new.id and status <> 'sent';
  elsif old.reminders_enabled is distinct from new.reminders_enabled
     or old.evaluation_date is distinct from new.evaluation_date
     or old.evaluation_time is distinct from new.evaluation_time then
    delete from public.evaluation_reminder_deliveries
     where evaluation_id = new.id and status <> 'sent';
  end if;
  return new;
end;
$function$;

drop trigger if exists reset_evaluation_reminder_schedule_trigger on public.evaluations;
create trigger reset_evaluation_reminder_schedule_trigger
before update on public.evaluations
for each row execute function public.reset_evaluation_reminder_schedule();

revoke execute on function public.reset_evaluation_reminder_schedule() from public, anon, authenticated;
grant execute on function public.reset_evaluation_reminder_schedule() to postgres, service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  if not exists (select 1 from vault.secrets where name = 'task_reminders_anon_key') then
    raise exception 'Create Vault secret task_reminders_anon_key before scheduling';
  end if;
  select jobid into existing_job from cron.job where jobname = 'evaluation-reminders-every-15-minutes';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'evaluation-reminders-every-15-minutes',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://pskbdeqaajprfhrjortm.supabase.co/functions/v1/evaluation-reminders',
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
