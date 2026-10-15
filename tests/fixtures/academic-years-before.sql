-- Schema-only snapshot of AC Edunity before academic-year management (2026-10-15).
-- Contains no account records, email addresses, credentials, or production data.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
create table public.profiles ("id" uuid not null ,
"full_name" text  ,
"role" text  default 'student'::text,
"xp" integer  default 0,
"streak" integer  default 1,
"level" integer  default 1,
"created_at" timestamp with time zone  default now(),
"study_area" text  ,
"bio" text  ,
"interests" text[]  default '{}'::text[],
"avatar_type" text  default 'initials'::text,
"avatar_url" text  ,
"updated_at" timestamp with time zone  default now());
create table public.subjects ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"name" text not null ,
"icon" text  ,
"color" text  ,
"created_at" timestamp with time zone  default now());
create table public.tasks ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"title" text not null ,
"description" text  ,
"due_date" date  ,
"priority" text  ,
"status" text  default 'pending'::text,
"created_at" timestamp with time zone  default now(),
"due_time" time without time zone  ,
"updated_at" timestamp with time zone not null default now(),
"reminders_enabled" boolean not null default false);
create table public.events ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"title" text not null ,
"type" text  ,
"event_date" date  ,
"event_time" time without time zone  ,
"description" text  ,
"created_at" timestamp with time zone  default now(),
"reminders_enabled" boolean not null default false);
create table public.attendance ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"date" date  ,
"status" text  ,
"created_at" timestamp with time zone  default now());
create table public.resources ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"title" text not null ,
"file_name" text  ,
"file_url" text  ,
"description" text  ,
"created_at" timestamp with time zone  default now());
create table public.grades ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"period" text  ,
"category" text  ,
"evaluation" text  ,
"final_value" numeric  ,
"observation" text  ,
"created_at" timestamp with time zone  default now());
create table public.grade_items ("id" uuid not null default gen_random_uuid(),
"grade_id" uuid not null ,
"activity" text not null ,
"item_date" date  ,
"value" numeric not null ,
"created_at" timestamp with time zone  default now());
create table public.recent_activity ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"text" text not null ,
"created_at" timestamp with time zone  default now());
create table public.welcome_email_deliveries ("user_id" uuid not null ,
"recipient_email" text not null ,
"status" text not null default 'sending'::text,
"attempts" integer not null default 1,
"resend_email_id" text  ,
"sent_at" timestamp with time zone  ,
"last_error" text  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.user_preferences ("user_id" uuid not null ,
"sounds_enabled" boolean not null default true,
"animations_enabled" boolean not null default true,
"ai_suggestions_enabled" boolean not null default true,
"reminders_enabled" boolean not null default true,
"performance_mode" boolean not null default false,
"dashboard_modules" jsonb not null default '{}'::jsonb,
"updated_at" timestamp with time zone not null default now());
create table public.task_reminder_deliveries ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"task_id" uuid not null ,
"reminder_type" text not null ,
"status" text not null default 'pending'::text,
"scheduled_for" timestamp with time zone not null ,
"task_due_at" timestamp with time zone not null ,
"sent_at" timestamp with time zone  ,
"resend_email_id" text  ,
"attempts" integer not null default 0,
"last_error" text  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.internal_notifications ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"task_id" uuid  ,
"notification_type" text not null ,
"title" text not null ,
"message" text not null ,
"scheduled_for" timestamp with time zone not null ,
"read_at" timestamp with time zone  ,
"created_at" timestamp with time zone not null default now());
create table public.user_activity_events ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"activity_type" text not null ,
"activity_points" integer not null ,
"source_id" uuid not null ,
"occurred_at" timestamp with time zone not null default now(),
"created_at" timestamp with time zone not null default now());
create table public.evaluations ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"title" text not null ,
"evaluation_type" text not null default 'Examen'::text,
"evaluation_date" date not null ,
"evaluation_time" time without time zone  ,
"topics" text[] not null default '{}'::text[],
"description" text  ,
"status" text not null default 'pending'::text,
"priority" text not null default 'medium'::text,
"show_in_calendar" boolean not null default true,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now(),
"reminders_enabled" boolean not null default false);
create table public.evaluation_reminder_deliveries ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"evaluation_id" uuid not null ,
"reminder_type" text not null ,
"status" text not null default 'pending'::text,
"scheduled_for" timestamp with time zone not null ,
"evaluation_due_at" timestamp with time zone not null ,
"sent_at" timestamp with time zone  ,
"resend_email_id" text  ,
"attempts" integer not null default 0,
"last_error" text  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.projects ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"title" text not null ,
"description" text  ,
"start_date" date  ,
"due_date" date  ,
"priority" text not null default 'medium'::text,
"status" text not null default 'pending'::text,
"show_in_calendar" boolean not null default false,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now(),
"due_time" time without time zone  ,
"reminders_enabled" boolean not null default false);
create table public.goals ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"subject_id" uuid  ,
"project_id" uuid  ,
"title" text not null ,
"description" text  ,
"target_date" date  ,
"priority" text not null default 'medium'::text,
"status" text not null default 'pending'::text,
"progress" smallint not null default 0,
"show_in_calendar" boolean not null default false,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.project_stages ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"project_id" uuid not null ,
"title" text not null ,
"description" text  ,
"position" integer not null default 0,
"due_date" date  ,
"status" text not null default 'pending'::text,
"show_in_calendar" boolean not null default false,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now(),
"due_time" time without time zone  ,
"reminders_enabled" boolean not null default false);
create table public.project_subtasks ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"project_id" uuid not null ,
"stage_id" uuid not null ,
"task_id" uuid  ,
"title" text not null ,
"description" text  ,
"due_date" date  ,
"priority" text not null default 'medium'::text,
"status" text not null default 'pending'::text,
"show_in_calendar" boolean not null default false,
"position" integer not null default 0,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now(),
"due_time" time without time zone  ,
"reminders_enabled" boolean not null default false);
create table public.event_reminder_deliveries ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"event_id" uuid not null ,
"reminder_type" text not null ,
"status" text not null default 'pending'::text,
"scheduled_for" timestamp with time zone not null ,
"event_due_at" timestamp with time zone not null ,
"sent_at" timestamp with time zone  ,
"resend_email_id" text  ,
"attempts" integer not null default 0,
"last_error" text  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.project_reminder_deliveries ("id" uuid not null default gen_random_uuid(),
"user_id" uuid not null ,
"entity_type" text not null ,
"entity_id" uuid not null ,
"reminder_type" text not null ,
"status" text not null default 'pending'::text,
"scheduled_for" timestamp with time zone not null ,
"due_at" timestamp with time zone not null ,
"attempts" integer not null default 0,
"sent_at" timestamp with time zone  ,
"last_error" text  ,
"resend_message_id" text  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
create table public.google_calendar_manual_links ("user_id" uuid not null ,
"entity_type" text not null ,
"entity_id" uuid not null ,
"confirmed_at" timestamp with time zone not null default now());
create table public.academic_notification_states ("user_id" uuid not null ,
"notification_key" text not null ,
"read_at" timestamp with time zone  ,
"dismissed_at" timestamp with time zone  ,
"created_at" timestamp with time zone not null default now(),
"updated_at" timestamp with time zone not null default now());
alter table public.profiles add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public.profiles add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.subjects add constraint "subjects_pkey" PRIMARY KEY (id);
alter table public.subjects add constraint "subjects_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tasks add constraint "tasks_pkey" PRIMARY KEY (id);
alter table public.tasks add constraint "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tasks add constraint "tasks_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.events add constraint "events_pkey" PRIMARY KEY (id);
alter table public.events add constraint "events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.events add constraint "events_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.attendance add constraint "attendance_pkey" PRIMARY KEY (id);
alter table public.attendance add constraint "attendance_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.attendance add constraint "attendance_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.resources add constraint "resources_pkey" PRIMARY KEY (id);
alter table public.resources add constraint "resources_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.resources add constraint "resources_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.grades add constraint "grades_pkey" PRIMARY KEY (id);
alter table public.grades add constraint "grades_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.grades add constraint "grades_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.grade_items add constraint "grade_items_pkey" PRIMARY KEY (id);
alter table public.grade_items add constraint "grade_items_grade_id_fkey" FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE;
alter table public.recent_activity add constraint "recent_activity_pkey" PRIMARY KEY (id);
alter table public.recent_activity add constraint "recent_activity_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.welcome_email_deliveries add constraint "welcome_email_deliveries_status_check" CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text])));
alter table public.welcome_email_deliveries add constraint "welcome_email_deliveries_attempts_check" CHECK ((attempts > 0));
alter table public.welcome_email_deliveries add constraint "welcome_email_deliveries_pkey" PRIMARY KEY (user_id);
alter table public.welcome_email_deliveries add constraint "welcome_email_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_preferences add constraint "user_preferences_pkey" PRIMARY KEY (user_id);
alter table public.user_preferences add constraint "user_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_reminder_type_check" CHECK ((reminder_type = ANY (ARRAY['due_24h'::text, 'due_2h'::text])));
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_reminder_type_check" CHECK ((reminder_type = ANY (ARRAY['due_24h'::text, 'due_1h'::text])));
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3)));
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_pkey" PRIMARY KEY (id);
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_task_id_reminder_type_key" UNIQUE (task_id, reminder_type);
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.task_reminder_deliveries add constraint "task_reminder_deliveries_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.internal_notifications add constraint "internal_notifications_notification_type_check" CHECK ((notification_type = ANY (ARRAY['due_24h'::text, 'due_2h'::text, 'overdue'::text])));
alter table public.internal_notifications add constraint "internal_notifications_pkey" PRIMARY KEY (id);
alter table public.internal_notifications add constraint "internal_notifications_task_id_notification_type_key" UNIQUE (task_id, notification_type);
alter table public.internal_notifications add constraint "internal_notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.internal_notifications add constraint "internal_notifications_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.user_activity_events add constraint "user_activity_events_activity_type_check" CHECK ((activity_type = ANY (ARRAY['task_created'::text, 'task_completed'::text, 'grade_recorded'::text, 'resource_added'::text, 'event_created'::text, 'attendance_recorded'::text])));
alter table public.projects add constraint "projects_pkey" PRIMARY KEY (id);
alter table public.projects add constraint "projects_id_user_id_key" UNIQUE (id, user_id);
alter table public.projects add constraint "projects_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.projects add constraint "projects_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.user_activity_events add constraint "user_activity_events_activity_points_check" CHECK (((activity_points >= 1) AND (activity_points <= 10)));
alter table public.user_activity_events add constraint "user_activity_events_pkey" PRIMARY KEY (id);
alter table public.user_activity_events add constraint "user_activity_events_source_unique" UNIQUE (user_id, activity_type, source_id);
alter table public.user_activity_events add constraint "user_activity_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.evaluations add constraint "evaluations_title_not_blank" CHECK ((length(btrim(title)) > 0));
alter table public.evaluations add constraint "evaluations_type_check" CHECK ((evaluation_type = ANY (ARRAY['Examen'::text, 'Prueba'::text, 'Lección'::text, 'Quiz'::text, 'Exposición'::text, 'Evaluación práctica'::text, 'Otro'::text])));
alter table public.evaluations add constraint "evaluations_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'preparing'::text, 'prepared'::text, 'completed'::text])));
alter table public.evaluations add constraint "evaluations_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.evaluations add constraint "evaluations_pkey" PRIMARY KEY (id);
alter table public.evaluations add constraint "evaluations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.evaluations add constraint "evaluations_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3)));
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_pkey" PRIMARY KEY (id);
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_evaluation_id_reminder_type_key" UNIQUE (evaluation_id, reminder_type);
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.evaluation_reminder_deliveries add constraint "evaluation_reminder_deliveries_evaluation_id_fkey" FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE;
alter table public.projects add constraint "projects_title_not_blank" CHECK ((length(btrim(title)) > 0));
alter table public.projects add constraint "projects_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.projects add constraint "projects_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'paused'::text, 'completed'::text])));
alter table public.projects add constraint "projects_dates_check" CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date)));
alter table public.projects add constraint "projects_calendar_date_check" CHECK (((NOT show_in_calendar) OR (due_date IS NOT NULL)));
alter table public.goals add constraint "goals_title_not_blank" CHECK ((length(btrim(title)) > 0));
alter table public.goals add constraint "goals_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.goals add constraint "goals_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])));
alter table public.goals add constraint "goals_progress_check" CHECK (((progress >= 0) AND (progress <= 100)));
alter table public.goals add constraint "goals_calendar_date_check" CHECK (((NOT show_in_calendar) OR (target_date IS NOT NULL)));
alter table public.goals add constraint "goals_pkey" PRIMARY KEY (id);
alter table public.goals add constraint "goals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.goals add constraint "goals_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;
alter table public.goals add constraint "goals_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.project_stages add constraint "project_stages_title_not_blank" CHECK ((length(btrim(title)) > 0));
alter table public.project_stages add constraint "project_stages_position_check" CHECK (("position" >= 0));
alter table public.project_stages add constraint "project_stages_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])));
alter table public.project_stages add constraint "project_stages_calendar_date_check" CHECK (((NOT show_in_calendar) OR (due_date IS NOT NULL)));
alter table public.project_stages add constraint "project_stages_pkey" PRIMARY KEY (id);
alter table public.project_stages add constraint "project_stages_id_project_id_key" UNIQUE (id, project_id);
alter table public.project_stages add constraint "project_stages_id_user_id_key" UNIQUE (id, user_id);
alter table public.project_stages add constraint "project_stages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.project_stages add constraint "project_stages_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_subtasks add constraint "project_subtasks_title_not_blank" CHECK ((length(btrim(title)) > 0));
alter table public.project_subtasks add constraint "project_subtasks_position_check" CHECK (("position" >= 0));
alter table public.project_subtasks add constraint "project_subtasks_priority_check" CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
alter table public.project_subtasks add constraint "project_subtasks_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])));
alter table public.project_subtasks add constraint "project_subtasks_calendar_date_check" CHECK (((NOT show_in_calendar) OR (due_date IS NOT NULL)));
alter table public.project_subtasks add constraint "project_subtasks_pkey" PRIMARY KEY (id);
alter table public.project_subtasks add constraint "project_subtasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.project_subtasks add constraint "project_subtasks_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_subtasks add constraint "project_subtasks_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table public.project_subtasks add constraint "project_subtasks_stage_project_fkey" FOREIGN KEY (stage_id, project_id) REFERENCES project_stages(id, project_id) ON DELETE CASCADE;
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_reminder_type_check" CHECK ((reminder_type = ANY (ARRAY['due_24h'::text, 'due_2h'::text])));
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3)));
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_pkey" PRIMARY KEY (id);
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_event_id_reminder_type_key" UNIQUE (event_id, reminder_type);
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.event_reminder_deliveries add constraint "event_reminder_deliveries_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.project_stages add constraint "project_stages_reminder_schedule_check" CHECK (((NOT reminders_enabled) OR ((due_date IS NOT NULL) AND (due_time IS NOT NULL))));
alter table public.project_subtasks add constraint "project_subtasks_reminder_schedule_check" CHECK (((NOT reminders_enabled) OR ((due_date IS NOT NULL) AND (due_time IS NOT NULL))));
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_reminder_type_check" CHECK ((reminder_type = ANY (ARRAY['due_24h'::text, 'due_2h'::text])));
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])));
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3)));
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_pkey" PRIMARY KEY (id);
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_entity_type_entity_id_reminder__key" UNIQUE (entity_type, entity_id, reminder_type);
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.projects add constraint "projects_reminder_schedule_check" CHECK (((NOT reminders_enabled) OR ((due_date IS NOT NULL) AND (due_time IS NOT NULL))));
alter table public.project_reminder_deliveries add constraint "project_reminder_deliveries_entity_type_check" CHECK ((entity_type = ANY (ARRAY['project'::text, 'stage'::text, 'subtask'::text])));
alter table public.google_calendar_manual_links add constraint "google_calendar_manual_links_entity_type_check" CHECK ((entity_type = ANY (ARRAY['task'::text, 'event'::text, 'evaluation'::text, 'project'::text, 'goal'::text, 'stage'::text])));
alter table public.google_calendar_manual_links add constraint "google_calendar_manual_links_pkey" PRIMARY KEY (user_id, entity_type, entity_id);
alter table public.google_calendar_manual_links add constraint "google_calendar_manual_links_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.academic_notification_states add constraint "academic_notification_states_key_not_blank" CHECK (((length(btrim(notification_key)) >= 1) AND (length(btrim(notification_key)) <= 512)));
alter table public.academic_notification_states add constraint "academic_notification_states_pkey" PRIMARY KEY (user_id, notification_key);
alter table public.academic_notification_states add constraint "academic_notification_states_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.reset_event_reminder_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.reset_task_reminder_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();

  if new.status <> 'pending' then
    update public.task_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where task_id = new.id and status <> 'sent';
    update public.internal_notifications
       set read_at = coalesce(read_at, now())
     where task_id = new.id and read_at is null;
  elsif old.reminders_enabled is true and new.reminders_enabled is false then
    update public.task_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where task_id = new.id and status <> 'sent';
    update public.internal_notifications
       set read_at = coalesce(read_at, now())
     where task_id = new.id and read_at is null;
  elsif old.reminders_enabled is false and new.reminders_enabled is true then
    delete from public.task_reminder_deliveries
     where task_id = new.id and status <> 'sent';
    delete from public.internal_notifications
     where task_id = new.id and read_at is null;
  elsif old.status is distinct from new.status
     or old.due_date is distinct from new.due_date
     or old.due_time is distinct from new.due_time then
    delete from public.task_reminder_deliveries where task_id = new.id;
    delete from public.internal_notifications where task_id = new.id;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.record_academic_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  next_type text;
  next_points integer;
  next_occurred_at timestamptz := now();
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unsupported activity source schema';
  end if;

  if tg_table_name = 'tasks' then
    if tg_op = 'INSERT' then
      next_type := 'task_created';
      next_points := 1;
      next_occurred_at := coalesce(new.created_at, now());
    elsif tg_op = 'UPDATE'
      and old.status is distinct from new.status
      and new.status = 'completed' then
      next_type := 'task_completed';
      next_points := 3;
      next_occurred_at := now();
    else
      return new;
    end if;
  elsif tg_op = 'INSERT' and tg_table_name = 'grades' then
    next_type := 'grade_recorded';
    next_points := 2;
    next_occurred_at := coalesce(new.created_at, now());
  elsif tg_op = 'INSERT' and tg_table_name = 'resources' then
    next_type := 'resource_added';
    next_points := 2;
    next_occurred_at := coalesce(new.created_at, now());
  elsif tg_op = 'INSERT' and tg_table_name = 'events' then
    next_type := 'event_created';
    next_points := 1;
    next_occurred_at := coalesce(new.created_at, now());
  elsif tg_op = 'INSERT' and tg_table_name = 'attendance' then
    next_type := 'attendance_recorded';
    next_points := 1;
    next_occurred_at := coalesce(new.created_at, now());
  else
    return new;
  end if;

  if new.user_id is null or new.id is null then
    return new;
  end if;

  insert into public.user_activity_events (
    user_id,
    activity_type,
    activity_points,
    source_id,
    occurred_at
  ) values (
    new.user_id,
    next_type,
    next_points,
    new.id,
    next_occurred_at
  )
  on conflict (user_id, activity_type, source_id) do nothing;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reset_evaluation_reminder_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.reset_project_reminder_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_type text := case tg_table_name
    when 'projects' then 'project'
    when 'project_stages' then 'stage'
    else 'subtask'
  end;
begin
  if tg_op = 'DELETE' then
    delete from public.project_reminder_deliveries
     where entity_type = target_type and entity_id = old.id;
    return old;
  end if;

  if new.reminders_enabled is false or new.status = 'completed' then
    update public.project_reminder_deliveries
       set status = 'cancelled', updated_at = now()
     where entity_type = target_type
       and entity_id = new.id
       and status <> 'sent';
  elsif old.reminders_enabled is distinct from new.reminders_enabled
     or old.due_date is distinct from new.due_date
     or old.due_time is distinct from new.due_time
     or old.status is distinct from new.status then
    delete from public.project_reminder_deliveries
     where entity_type = target_type
       and entity_id = new.id
       and status <> 'sent';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_google_calendar_manual_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
    delete from public.google_calendar_manual_links
    where user_id = old.user_id and entity_type = tg_argv[0] and entity_id = old.id;
    return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_google_calendar_manual_entity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
    entity_table text;
    source_id uuid;
begin
    entity_table := case new.entity_type
        when 'task' then 'tasks' when 'event' then 'events'
        when 'evaluation' then 'evaluations' when 'project' then 'projects'
        when 'goal' then 'goals' when 'stage' then 'project_stages' end;
    if entity_table is null then
        raise exception 'Unsupported calendar entity type' using errcode = '23514';
    end if;
    execute format('select id from public.%I where id = $1 and user_id = $2 for key share', entity_table)
        into source_id using new.entity_id, new.user_id;
    if source_id is null then
        raise exception 'Calendar source entity no longer exists or is not owned by this user' using errcode = '23503';
    end if;
    return new;
end;
$function$
;
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('event');
CREATE TRIGGER record_event_academic_activity AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION private.record_academic_activity();
CREATE TRIGGER reset_event_reminder_schedule_trigger BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION reset_event_reminder_schedule();
CREATE TRIGGER record_attendance_academic_activity AFTER INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION private.record_academic_activity();
CREATE TRIGGER record_resource_academic_activity AFTER INSERT ON public.resources FOR EACH ROW EXECUTE FUNCTION private.record_academic_activity();
CREATE TRIGGER record_grade_academic_activity AFTER INSERT ON public.grades FOR EACH ROW EXECUTE FUNCTION private.record_academic_activity();
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('task');
CREATE TRIGGER record_task_academic_activity AFTER INSERT OR UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION private.record_academic_activity();
CREATE TRIGGER reset_task_reminder_schedule_trigger BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION reset_task_reminder_schedule();
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('project');
CREATE TRIGGER reset_project_reminder_schedule_trigger AFTER DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION reset_project_reminder_schedule();
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.project_stages FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('stage');
CREATE TRIGGER reset_project_stage_reminder_schedule_trigger AFTER DELETE OR UPDATE ON public.project_stages FOR EACH ROW EXECUTE FUNCTION reset_project_reminder_schedule();
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.goals FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('goal');
CREATE TRIGGER reset_project_subtask_reminder_schedule_trigger AFTER DELETE OR UPDATE ON public.project_subtasks FOR EACH ROW EXECUTE FUNCTION reset_project_reminder_schedule();
CREATE TRIGGER cleanup_google_calendar_manual_link AFTER DELETE ON public.evaluations FOR EACH ROW EXECUTE FUNCTION cleanup_google_calendar_manual_link('evaluation');
CREATE TRIGGER reset_evaluation_reminder_schedule_trigger BEFORE UPDATE ON public.evaluations FOR EACH ROW EXECUTE FUNCTION reset_evaluation_reminder_schedule();
CREATE TRIGGER validate_google_calendar_manual_entity BEFORE INSERT OR UPDATE ON public.google_calendar_manual_links FOR EACH ROW EXECUTE FUNCTION validate_google_calendar_manual_entity();
alter table public.profiles enable row level security;
grant select,insert,update,delete on public.profiles to authenticated,service_role;
alter table public.subjects enable row level security;
grant select,insert,update,delete on public.subjects to authenticated,service_role;
alter table public.tasks enable row level security;
grant select,insert,update,delete on public.tasks to authenticated,service_role;
alter table public.events enable row level security;
grant select,insert,update,delete on public.events to authenticated,service_role;
alter table public.attendance enable row level security;
grant select,insert,update,delete on public.attendance to authenticated,service_role;
alter table public.resources enable row level security;
grant select,insert,update,delete on public.resources to authenticated,service_role;
alter table public.grades enable row level security;
grant select,insert,update,delete on public.grades to authenticated,service_role;
alter table public.grade_items enable row level security;
grant select,insert,update,delete on public.grade_items to authenticated,service_role;
alter table public.recent_activity enable row level security;
grant select,insert,update,delete on public.recent_activity to authenticated,service_role;
alter table public.welcome_email_deliveries enable row level security;
grant select,insert,update,delete on public.welcome_email_deliveries to authenticated,service_role;
alter table public.user_preferences enable row level security;
grant select,insert,update,delete on public.user_preferences to authenticated,service_role;
alter table public.task_reminder_deliveries enable row level security;
grant select,insert,update,delete on public.task_reminder_deliveries to authenticated,service_role;
alter table public.internal_notifications enable row level security;
grant select,insert,update,delete on public.internal_notifications to authenticated,service_role;
alter table public.user_activity_events enable row level security;
grant select,insert,update,delete on public.user_activity_events to authenticated,service_role;
alter table public.evaluations enable row level security;
grant select,insert,update,delete on public.evaluations to authenticated,service_role;
alter table public.evaluation_reminder_deliveries enable row level security;
grant select,insert,update,delete on public.evaluation_reminder_deliveries to authenticated,service_role;
alter table public.projects enable row level security;
grant select,insert,update,delete on public.projects to authenticated,service_role;
alter table public.goals enable row level security;
grant select,insert,update,delete on public.goals to authenticated,service_role;
alter table public.project_stages enable row level security;
grant select,insert,update,delete on public.project_stages to authenticated,service_role;
alter table public.project_subtasks enable row level security;
grant select,insert,update,delete on public.project_subtasks to authenticated,service_role;
alter table public.event_reminder_deliveries enable row level security;
grant select,insert,update,delete on public.event_reminder_deliveries to authenticated,service_role;
alter table public.project_reminder_deliveries enable row level security;
grant select,insert,update,delete on public.project_reminder_deliveries to authenticated,service_role;
alter table public.google_calendar_manual_links enable row level security;
grant select,insert,update,delete on public.google_calendar_manual_links to authenticated,service_role;
alter table public.academic_notification_states enable row level security;
grant select,insert,update,delete on public.academic_notification_states to authenticated,service_role;
create policy "profiles_select_own" on public.profiles for SELECT to public using ((auth.uid() = id)) ;
create policy "profiles_insert_own" on public.profiles for INSERT to public  with check ((auth.uid() = id));
create policy "profiles_update_own" on public.profiles for UPDATE to public using ((auth.uid() = id)) with check ((auth.uid() = id));
create policy "subjects_select_own" on public.subjects for SELECT to public using ((auth.uid() = user_id)) ;
create policy "subjects_insert_own" on public.subjects for INSERT to public  with check ((auth.uid() = user_id));
create policy "subjects_update_own" on public.subjects for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "subjects_delete_own" on public.subjects for DELETE to public using ((auth.uid() = user_id)) ;
create policy "events_select_own" on public.events for SELECT to public using ((auth.uid() = user_id)) ;
create policy "events_insert_own" on public.events for INSERT to public  with check ((auth.uid() = user_id));
create policy "events_update_own" on public.events for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "events_delete_own" on public.events for DELETE to public using ((auth.uid() = user_id)) ;
create policy "attendance_select_own" on public.attendance for SELECT to public using ((auth.uid() = user_id)) ;
create policy "attendance_insert_own" on public.attendance for INSERT to public  with check ((auth.uid() = user_id));
create policy "attendance_update_own" on public.attendance for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "attendance_delete_own" on public.attendance for DELETE to public using ((auth.uid() = user_id)) ;
create policy "resources_select_own" on public.resources for SELECT to public using ((auth.uid() = user_id)) ;
create policy "resources_insert_own" on public.resources for INSERT to public  with check ((auth.uid() = user_id));
create policy "resources_update_own" on public.resources for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "resources_delete_own" on public.resources for DELETE to public using ((auth.uid() = user_id)) ;
create policy "grades_select_own" on public.grades for SELECT to public using ((auth.uid() = user_id)) ;
create policy "grades_insert_own" on public.grades for INSERT to public  with check ((auth.uid() = user_id));
create policy "grades_update_own" on public.grades for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "grades_delete_own" on public.grades for DELETE to public using ((auth.uid() = user_id)) ;
create policy "grade_items_select_own" on public.grade_items for SELECT to public using ((EXISTS ( SELECT 1
   FROM grades
  WHERE ((grades.id = grade_items.grade_id) AND (grades.user_id = auth.uid()))))) ;
create policy "grade_items_insert_own" on public.grade_items for INSERT to public  with check ((EXISTS ( SELECT 1
   FROM grades
  WHERE ((grades.id = grade_items.grade_id) AND (grades.user_id = auth.uid())))));
create policy "grade_items_update_own" on public.grade_items for UPDATE to public using ((EXISTS ( SELECT 1
   FROM grades
  WHERE ((grades.id = grade_items.grade_id) AND (grades.user_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM grades
  WHERE ((grades.id = grade_items.grade_id) AND (grades.user_id = auth.uid())))));
create policy "grade_items_delete_own" on public.grade_items for DELETE to public using ((EXISTS ( SELECT 1
   FROM grades
  WHERE ((grades.id = grade_items.grade_id) AND (grades.user_id = auth.uid()))))) ;
create policy "recent_activity_select_own" on public.recent_activity for SELECT to public using ((auth.uid() = user_id)) ;
create policy "recent_activity_insert_own" on public.recent_activity for INSERT to public  with check ((auth.uid() = user_id));
create policy "recent_activity_update_own" on public.recent_activity for UPDATE to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "recent_activity_delete_own" on public.recent_activity for DELETE to public using ((auth.uid() = user_id)) ;
create policy "Users can read own preferences" on public.user_preferences for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "Users can insert own preferences" on public.user_preferences for INSERT to authenticated  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users can update own preferences" on public.user_preferences for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users read own internal notifications" on public.internal_notifications for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "evaluations_delete_own" on public.evaluations for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "Users mark own internal notifications read" on public.internal_notifications for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users read own academic activity" on public.user_activity_events for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "tasks_select_own" on public.tasks for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "tasks_insert_own" on public.tasks for INSERT to authenticated  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "tasks_update_own" on public.tasks for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "tasks_delete_own" on public.tasks for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "evaluations_select_own" on public.evaluations for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "evaluations_insert_own" on public.evaluations for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND (subject_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM subjects
  WHERE ((subjects.id = evaluations.subject_id) AND (subjects.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "evaluations_update_own" on public.evaluations for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND (subject_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM subjects
  WHERE ((subjects.id = evaluations.subject_id) AND (subjects.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "Users read own evaluation reminder deliveries" on public.evaluation_reminder_deliveries for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "Users insert own evaluation reminder deliveries" on public.evaluation_reminder_deliveries for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM evaluations e
  WHERE ((e.id = evaluation_reminder_deliveries.evaluation_id) AND (e.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "Users update own evaluation reminder deliveries" on public.evaluation_reminder_deliveries for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM evaluations e
  WHERE ((e.id = evaluation_reminder_deliveries.evaluation_id) AND (e.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "Users delete own evaluation reminder deliveries" on public.evaluation_reminder_deliveries for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "projects_select_own" on public.projects for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "goals_update_own" on public.goals for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND ((subject_id IS NULL) OR (EXISTS ( SELECT 1
   FROM subjects s
  WHERE ((s.id = goals.subject_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = goals.project_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "projects_insert_own" on public.projects for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND ((subject_id IS NULL) OR (EXISTS ( SELECT 1
   FROM subjects s
  WHERE ((s.id = projects.subject_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "projects_update_own" on public.projects for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND ((subject_id IS NULL) OR (EXISTS ( SELECT 1
   FROM subjects s
  WHERE ((s.id = projects.subject_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "projects_delete_own" on public.projects for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "goals_select_own" on public.goals for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "goals_insert_own" on public.goals for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND ((subject_id IS NULL) OR (EXISTS ( SELECT 1
   FROM subjects s
  WHERE ((s.id = goals.subject_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = goals.project_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "goals_delete_own" on public.goals for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "project_stages_select_own" on public.project_stages for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "project_stages_insert_own" on public.project_stages for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_stages.project_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "project_stages_update_own" on public.project_stages for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_stages.project_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "project_stages_delete_own" on public.project_stages for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "project_subtasks_select_own" on public.project_subtasks for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "project_subtasks_insert_own" on public.project_subtasks for INSERT to authenticated  with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM project_stages s
  WHERE ((s.id = project_subtasks.stage_id) AND (s.project_id = s.project_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))) AND ((task_id IS NULL) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = project_subtasks.task_id) AND (t.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "project_subtasks_update_own" on public.project_subtasks for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM project_stages s
  WHERE ((s.id = project_subtasks.stage_id) AND (s.project_id = s.project_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))) AND ((task_id IS NULL) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = project_subtasks.task_id) AND (t.user_id = ( SELECT auth.uid() AS uid))))))));
create policy "project_subtasks_delete_own" on public.project_subtasks for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "Users read own manual confirmations" on public.google_calendar_manual_links for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "Users insert own manual confirmations" on public.google_calendar_manual_links for INSERT to authenticated  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users update own manual confirmations" on public.google_calendar_manual_links for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "Users delete own manual confirmations" on public.google_calendar_manual_links for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "academic_notification_states_select_own" on public.academic_notification_states for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;
create policy "academic_notification_states_insert_own" on public.academic_notification_states for INSERT to authenticated  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "academic_notification_states_update_own" on public.academic_notification_states for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "academic_notification_states_delete_own" on public.academic_notification_states for DELETE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) ;


-- Match server-only ledgers and column-level notification grants.
revoke all on public.task_reminder_deliveries,public.event_reminder_deliveries,public.evaluation_reminder_deliveries,public.project_reminder_deliveries,public.welcome_email_deliveries from authenticated;
revoke all on public.internal_notifications,public.user_activity_events from authenticated;
grant select on public.internal_notifications,public.user_activity_events to authenticated;
grant update(read_at) on public.internal_notifications to authenticated;
