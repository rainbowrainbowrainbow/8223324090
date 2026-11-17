-- MIGRATION_KIND: schema
-- SAFETY: Additive and idempotent. The empty override table leaves existing catalog rows and memberships unchanged.
-- ROLLBACK: Revert the application readers and writer. Keep the table and recorded department selections.

CREATE TABLE IF NOT EXISTS park_profession_departments (
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    profession_id INTEGER NOT NULL REFERENCES hr_professions(id) ON DELETE RESTRICT,
    department VARCHAR(50) NOT NULL CHECK (btrim(department) <> ''),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, profession_id)
);
