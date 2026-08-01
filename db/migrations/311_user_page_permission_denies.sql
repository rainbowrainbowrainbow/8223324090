-- MIGRATION_KIND: schema
-- SAFETY: Additive and idempotent page deny override storage. Existing users inherit an empty denylist through the column default; no production rows are rewritten.
-- ROLLBACK: After rolling application code back, DROP INDEX IF EXISTS idx_users_page_denylist_gin; then ALTER TABLE users DROP COLUMN IF EXISTS page_denylist.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS page_denylist TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_users_page_denylist_gin
    ON users USING GIN (page_denylist);
