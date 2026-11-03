-- MIGRATION_KIND: schema
-- SAFETY: Additive table; existing operations and product drafts are not changed.
-- ROLLBACK: Disable recovery endpoints and retain rows for later review; do not delete paid results.

CREATE TABLE IF NOT EXISTS menu_image_paid_recovery (
    operation_id UUID PRIMARY KEY REFERENCES menu_image_paid_operations(operation_id),
    request_studio JSONB NOT NULL CHECK (jsonb_typeof(request_studio) = 'object'),
    result_studio JSONB CHECK (result_studio IS NULL OR jsonb_typeof(result_studio) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
