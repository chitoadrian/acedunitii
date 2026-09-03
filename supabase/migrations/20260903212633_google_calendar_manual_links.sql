-- This records the user's confirmation, not verification by Google Calendar.
create table public.google_calendar_manual_links (
    user_id uuid not null references auth.users(id) on delete cascade,
    entity_type text not null check (entity_type in ('task', 'event', 'evaluation', 'project', 'goal', 'stage')),
    entity_id uuid not null,
    confirmed_at timestamptz not null default now(),
    primary key (user_id, entity_type, entity_id)
);

-- The primary key also indexes the per-user batch lookup.
alter table public.google_calendar_manual_links enable row level security;
revoke all on public.google_calendar_manual_links from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_manual_links to authenticated;
grant all on public.google_calendar_manual_links to service_role;

create policy "Users read own manual confirmations"
on public.google_calendar_manual_links for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users insert own manual confirmations"
on public.google_calendar_manual_links for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update own manual confirmations"
on public.google_calendar_manual_links for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users delete own manual confirmations"
on public.google_calendar_manual_links for delete to authenticated
using ((select auth.uid()) = user_id);
