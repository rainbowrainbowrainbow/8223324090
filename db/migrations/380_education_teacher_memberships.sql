-- MIGRATION_KIND: schema
-- SAFETY: Additive/idempotent empty teacher memberships; no staff, group, booking, account or production ownership backfill.
-- ROLLBACK: Restore the previous application while retaining this table. Export memberships before any separately approved table retirement; no destructive rollback is performed here.

CREATE TABLE IF NOT EXISTS education_teacher_memberships (
    business_context VARCHAR(64) NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_context, staff_id),
    CONSTRAINT education_teacher_memberships_context_check CHECK (business_context ~ '^[a-z][a-z0-9_]{2,63}$')
);
