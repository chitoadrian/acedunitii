-- The report unique index leads with user_id; this order covers the composite FK
-- for owner/year teardown and avoids scans when PostgreSQL checks its reference.
create index academic_record_history_year_owner_idx
  on public.academic_record_history(academic_year_id,user_id);
