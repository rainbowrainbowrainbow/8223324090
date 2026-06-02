-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable/defaulted user action override arrays without changing existing role-based permissions.
-- ROLLBACK: ALTER TABLE users DROP COLUMN IF EXISTS action_allowlist; ALTER TABLE users DROP COLUMN IF EXISTS action_denylist; DROP INDEX IF EXISTS idx_users_action_allowlist_gin; DROP INDEX IF EXISTS idx_users_action_denylist_gin;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS action_allowlist TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS action_denylist TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_users_action_allowlist_gin
    ON users USING GIN (action_allowlist);

CREATE INDEX IF NOT EXISTS idx_users_action_denylist_gin
    ON users USING GIN (action_denylist);
