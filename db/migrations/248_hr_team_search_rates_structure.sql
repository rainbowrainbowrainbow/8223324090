-- MIGRATION_KIND: mixed
-- SAFETY: Additive HR team UX links only. Adds nullable structure links and optional per-staff profession rates without rewriting existing salary truth.
-- ROLLBACK: Drop staff_profession_rates, remove staff.company_structure_node_id and hr_professions.structure_node_id if the HR team UX links must be reverted.

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS company_structure_node_id VARCHAR(64);

ALTER TABLE hr_professions
    ADD COLUMN IF NOT EXISTS structure_node_id VARCHAR(64);

CREATE TABLE IF NOT EXISTS staff_profession_rates (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    profession_key VARCHAR(64) NOT NULL,
    hourly_rate NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(staff_id, profession_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_company_structure_node_id
    ON staff(company_structure_node_id)
    WHERE company_structure_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hr_professions_structure_node_id
    ON hr_professions(structure_node_id)
    WHERE structure_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_profession_rates_staff
    ON staff_profession_rates(staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_profession_rates_profession
    ON staff_profession_rates(profession_key);
