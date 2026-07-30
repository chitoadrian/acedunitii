create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sounds_enabled boolean not null default true,
  animations_enabled boolean not null default true,
  ai_suggestions_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  performance_mode boolean not null default false,
  dashboard_modules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

revoke all on table public.user_preferences from anon;
grant select, insert, update on table public.user_preferences to authenticated;

drop policy if exists "Users can read own preferences" on public.user_preferences;
create policy "Users can read own preferences"
on public.user_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own preferences" on public.user_preferences;
create policy "Users can insert own preferences"
on public.user_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own preferences" on public.user_preferences;
create policy "Users can update own preferences"
on public.user_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
