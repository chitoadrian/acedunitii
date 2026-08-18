create index if not exists events_reminders_due_idx
  on public.events (event_date, event_time)
  where reminders_enabled is true;
