-- Private pilot. Grant access only after the test account has been confirmed.
create table public.edunity_feature_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  exam_enabled boolean not null default false,
  autopilot_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.edunity_feature_access enable row level security;
revoke all on public.edunity_feature_access from public, anon, authenticated;
grant select on public.edunity_feature_access to authenticated;
grant all on public.edunity_feature_access to service_role;
create policy edunity_feature_access_read_own on public.edunity_feature_access
  for select to authenticated using ((select auth.uid()) = user_id);

-- Exam records are server-only. No Data API role may read or write them.
create table public.exam_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_name text not null check (length(source_name) between 1 and 180),
  recognized_text text not null check (length(recognized_text) between 1 and 30000),
  created_at timestamptz not null default now()
);
create index exam_materials_user_created_idx on public.exam_materials (user_id, created_at desc);
alter table public.exam_materials enable row level security;
revoke all on public.exam_materials from public, anon, authenticated;
grant all on public.exam_materials to service_role;

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.exam_materials(id) on delete cascade,
  difficulty text not null check (difficulty in ('basico', 'intermedio', 'avanzado')),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  answers jsonb,
  feedback jsonb,
  score numeric(5,2) check (score between 0 and 100),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index exam_attempts_user_created_idx on public.exam_attempts (user_id, created_at desc);
create index exam_attempts_material_idx on public.exam_attempts (material_id);
alter table public.exam_attempts enable row level security;
revoke all on public.exam_attempts from public, anon, authenticated;
grant all on public.exam_attempts to service_role;
