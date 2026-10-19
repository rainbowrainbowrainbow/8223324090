-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent table and index only; no existing records are changed. Local creation/testing approved in LOCAL-PROMOTIONS-SCHEMA.
-- ROLLBACK: Roll back application code and retain this additive table; do not drop records during a release rollback.

CREATE TABLE IF NOT EXISTS timeline_promotions (
    id SERIAL PRIMARY KEY,
    business_context TEXT NOT NULL,
    title VARCHAR(180) NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    color_key TEXT NOT NULL DEFAULT 'amber' CHECK (color_key IN ('amber', 'violet', 'green', 'blue')),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_timeline_promotions_context_dates
    ON timeline_promotions (business_context, starts_on, ends_on) WHERE is_active;
