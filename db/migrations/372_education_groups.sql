-- MIGRATION_KIND: schema
-- SAFETY: Additive empty education group and membership tables; no existing bookings or customer data are changed. Safe to retry.
-- ROLLBACK: Export group history first, then drop education_group_members and education_groups if the feature is retired.

CREATE TABLE IF NOT EXISTS education_groups (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    teacher_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT,
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, business_context)
);

CREATE INDEX IF NOT EXISTS idx_education_groups_context_status
    ON education_groups (business_context, status, name);

CREATE TABLE IF NOT EXISTS education_group_members (
    id BIGSERIAL PRIMARY KEY,
    business_context VARCHAR(64) NOT NULL,
    group_id BIGINT NOT NULL,
    child_id BIGINT NOT NULL REFERENCES customer_children(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT education_group_members_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT education_group_members_group_context_fk FOREIGN KEY (group_id, business_context)
        REFERENCES education_groups(id, business_context) ON DELETE RESTRICT,
    CONSTRAINT education_group_members_start_unique UNIQUE (group_id, child_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_education_group_members_context_group
    ON education_group_members (business_context, group_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_education_group_members_context_child
    ON education_group_members (business_context, child_id);
