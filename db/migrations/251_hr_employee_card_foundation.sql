-- MIGRATION_KIND: schema
-- SAFETY: Additive HR employee-card foundation. Adds private staff documents, issued-resource tracking, offboarding records, and optional certification scoping without rewriting existing staff/payroll/warehouse data.
-- DATA_SCOPE: none; schema-only nullable fields and new empty tables.
-- ROLLBACK: Export staff_documents, staff_resource_assignments, and staff_offboarding_events if their history must be preserved, then drop the added tables, indexes, and nullable staff/staff_certifications columns.

CREATE TABLE IF NOT EXISTS staff_documents (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    document_type VARCHAR(64) NOT NULL DEFAULT 'other',
    title VARCHAR(160) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120),
    file_ext VARCHAR(16),
    file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
    file_sha256 VARCHAR(64) NOT NULL,
    file_data BYTEA NOT NULL,
    issued_at DATE,
    expires_at DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    notes TEXT,
    uploaded_by VARCHAR(100),
    archived_at TIMESTAMPTZ,
    archived_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_documents_type') THEN
        ALTER TABLE staff_documents ADD CONSTRAINT chk_staff_documents_type
            CHECK (document_type IN ('passport','tax_id','contract','medical_book','certificate','training','other'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_documents_status') THEN
        ALTER TABLE staff_documents ADD CONSTRAINT chk_staff_documents_status
            CHECK (status IN ('active','archived','expired','revoked'));
    END IF;
END $$;

ALTER TABLE staff_certifications
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64),
    ADD COLUMN IF NOT EXISTS document_id BIGINT REFERENCES staff_documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS termination_date DATE,
    ADD COLUMN IF NOT EXISTS termination_reason TEXT,
    ADD COLUMN IF NOT EXISTS termination_recorded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS termination_recorded_by VARCHAR(100);

CREATE TABLE IF NOT EXISTS staff_resource_assignments (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    resource_kind VARCHAR(64) NOT NULL DEFAULT 'custom',
    warehouse_stock_id INTEGER REFERENCES warehouse_stock(id) ON DELETE SET NULL,
    costume_id INTEGER REFERENCES costumes(id) ON DELETE SET NULL,
    title VARCHAR(160) NOT NULL,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
    due_return_at DATE,
    returned_at DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'issued',
    notes TEXT,
    issued_by VARCHAR(100),
    returned_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_resource_assignments_kind') THEN
        ALTER TABLE staff_resource_assignments ADD CONSTRAINT chk_staff_resource_assignments_kind
            CHECK (resource_kind IN ('warehouse_stock','costume','custom'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_resource_assignments_status') THEN
        ALTER TABLE staff_resource_assignments ADD CONSTRAINT chk_staff_resource_assignments_status
            CHECK (status IN ('issued','returned','lost','written_off'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_offboarding_events (
    id BIGSERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT NOT NULL,
    target_pool_status VARCHAR(32) NOT NULL DEFAULT 'reserve',
    account_action VARCHAR(32) NOT NULL DEFAULT 'review',
    resource_check_required BOOLEAN NOT NULL DEFAULT true,
    open_resource_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_by VARCHAR(100),
    completed_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_offboarding_events_status') THEN
        ALTER TABLE staff_offboarding_events ADD CONSTRAINT chk_staff_offboarding_events_status
            CHECK (status IN ('draft','active','completed','cancelled'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_offboarding_events_pool') THEN
        ALTER TABLE staff_offboarding_events ADD CONSTRAINT chk_staff_offboarding_events_pool
            CHECK (target_pool_status IN ('core','reserve','blacklisted'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_offboarding_events_account') THEN
        ALTER TABLE staff_offboarding_events ADD CONSTRAINT chk_staff_offboarding_events_account
            CHECK (account_action IN ('none','review','disable'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_documents_staff_status
    ON staff_documents(staff_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_documents_expires
    ON staff_documents(expires_at)
    WHERE expires_at IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_staff_documents_sha256
    ON staff_documents(file_sha256);

CREATE INDEX IF NOT EXISTS idx_staff_certifications_business_context
    ON staff_certifications(business_context)
    WHERE business_context IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_resource_assignments_staff_status
    ON staff_resource_assignments(staff_id, status, due_return_at);

CREATE INDEX IF NOT EXISTS idx_staff_resource_assignments_warehouse_stock
    ON staff_resource_assignments(warehouse_stock_id)
    WHERE warehouse_stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_resource_assignments_costume
    ON staff_resource_assignments(costume_id)
    WHERE costume_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_offboarding_events_staff_created
    ON staff_offboarding_events(staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_termination_date
    ON staff(termination_date)
    WHERE termination_date IS NOT NULL;
