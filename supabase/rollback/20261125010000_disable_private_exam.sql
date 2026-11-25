-- Emergency rollback after the pilot migration has been applied.
-- Disables the backend feature gate immediately. Keeps test history for review.
begin;
update public.edunity_feature_access
set exam_enabled = false,
    autopilot_enabled = false
where exam_enabled or autopilot_enabled;
commit;
