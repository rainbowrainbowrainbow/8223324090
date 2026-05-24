-- MIGRATION_KIND: schema
-- SAFETY: Adds one nullable JSONB preference field to existing per-user profile extension rows; existing profile data is not rewritten.
-- ROLLBACK: ALTER TABLE user_profiles_ext DROP COLUMN IF EXISTS profile_cockpit_widgets;

ALTER TABLE user_profiles_ext
    ADD COLUMN IF NOT EXISTS profile_cockpit_widgets JSONB;

COMMENT ON COLUMN user_profiles_ext.profile_cockpit_widgets
    IS 'Ordered list of profile overview cockpit widget ids selected by the employee.';
