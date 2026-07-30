-- Requires a Vault secret named task_reminders_anon_key.
-- The value is the project's public legacy anon JWT. It is used only to pass
-- the Edge Functions gateway; task-reminders accepts no recipient or task input
-- and performs all privileged reads with its server-side service-role secret.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  if not exists (select 1 from vault.secrets where name = 'task_reminders_anon_key') then
    raise exception 'Create Vault secret task_reminders_anon_key before scheduling';
  end if;
  select jobid into existing_job from cron.job where jobname = 'task-reminders-every-15-minutes';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'task-reminders-every-15-minutes',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://pskbdeqaajprfhrjortm.supabase.co/functions/v1/task-reminders',
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
