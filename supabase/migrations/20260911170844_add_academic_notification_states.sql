-- Persist only per-user read/dismiss state; academic notices remain derived from source records.

create table if not exists public.academic_notification_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_key),
  constraint academic_notification_states_key_not_blank
    check (length(btrim(notification_key)) between 1 and 512)
);

comment on table public.academic_notification_states is
  'Per-user read and dismissed state for academic notices derived from existing workspace records.';

alter table public.academic_notification_states enable row level security;

revoke all on table public.academic_notification_states from anon, authenticated;
grant select, insert, update, delete on table public.academic_notification_states to authenticated;

drop policy if exists academic_notification_states_select_own on public.academic_notification_states;
create policy academic_notification_states_select_own
  on public.academic_notification_states
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists academic_notification_states_insert_own on public.academic_notification_states;
create policy academic_notification_states_insert_own
  on public.academic_notification_states
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists academic_notification_states_update_own on public.academic_notification_states;
create policy academic_notification_states_update_own
  on public.academic_notification_states
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists academic_notification_states_delete_own on public.academic_notification_states;
create policy academic_notification_states_delete_own
  on public.academic_notification_states
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
