-- Harden task ownership policies for authenticated users.
-- Applied to Supabase as migration: harden_tasks_ownership_policies

alter table public.tasks enable row level security;

drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

create policy tasks_select_own
on public.tasks
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy tasks_insert_own
on public.tasks
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy tasks_update_own
on public.tasks
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy tasks_delete_own
on public.tasks
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.tasks from anon;
revoke all on table public.tasks from authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
