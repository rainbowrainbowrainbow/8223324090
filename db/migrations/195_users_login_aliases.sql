-- MIGRATION_KIND: schema
-- SAFETY: Additive users.login_aliases column and GIN index; no password hashes, sessions, or user identities are reset.
-- ROLLBACK: DROP INDEX IF EXISTS idx_users_login_aliases_gin; ALTER TABLE users DROP COLUMN IF EXISTS login_aliases;
-- DATA_SCOPE: Adds alias metadata for existing users only; seeds Zhenia/Женя as aliases for the existing Zhenya account when present.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS login_aliases TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_users_login_aliases_gin
    ON users USING GIN (login_aliases);

UPDATE users
SET login_aliases = (
    SELECT ARRAY(
        SELECT DISTINCT alias_value
        FROM unnest(login_aliases || ARRAY['Zhenia', 'Женя']) AS alias_value
        WHERE alias_value IS NOT NULL AND TRIM(alias_value) <> ''
    )
)
WHERE LOWER(username) = 'zhenya';
