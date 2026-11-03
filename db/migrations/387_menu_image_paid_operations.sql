-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent table and indexes; no existing rows are changed or backfilled.
-- ROLLBACK: Disable guarded submissions and retain both tables; the activation marker intentionally keeps legacy generation blocked. Removal requires a separately approved reconciliation and archival plan.

CREATE TABLE IF NOT EXISTS menu_image_guard_activation (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_image_paid_operations (
    operation_id UUID PRIMARY KEY,
    business_context TEXT NOT NULL,
    product_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'kie')),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'provider_pending', 'unknown', 'succeeded', 'failed', 'reviewed_unknown')),
    provider_task_id TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(business_context) BETWEEN 1 AND 100),
    CHECK (length(product_id) BETWEEN 1 AND 80),
    CHECK (length(created_by) BETWEEN 1 AND 100),
    CHECK (provider_task_id IS NULL OR provider_task_id ~ '^[A-Za-z0-9_-]{1,128}$'),
    CHECK (status <> 'provider_pending' OR (provider = 'kie' AND provider_task_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS menu_image_paid_operations_active_product
    ON menu_image_paid_operations (business_context, product_id)
    WHERE status IN ('reserved', 'provider_pending', 'unknown');

CREATE INDEX IF NOT EXISTS menu_image_paid_operations_active_budget
    ON menu_image_paid_operations (status)
    WHERE status IN ('reserved', 'provider_pending', 'unknown');

CREATE TABLE IF NOT EXISTS menu_image_paid_operation_reviews (
    operation_id UUID PRIMARY KEY REFERENCES menu_image_paid_operations(operation_id),
    reviewed_by TEXT NOT NULL CHECK (length(reviewed_by) BETWEEN 1 AND 100),
    review_note TEXT NOT NULL CHECK (length(review_note) BETWEEN 20 AND 500),
    previous_status TEXT NOT NULL CHECK (previous_status IN ('reserved', 'unknown')),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
