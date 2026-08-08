-- MIGRATION_KIND: schema
-- SAFETY: Additive fiscal item mapping table only. It stores explicit internal item/category to provider fiscal name and tax identifiers, without secrets, production data changes, or automatic activation.
-- ROLLBACK: Disable Checkbox integration, export fiscal_item_mappings if needed, then drop fiscal_item_mappings after application rollback.

CREATE TABLE IF NOT EXISTS fiscal_item_mappings (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL REFERENCES fiscal_profiles(id) ON DELETE RESTRICT,
    fiscal_register_id BIGINT NOT NULL,
    crm_profile_key VARCHAR(64) NOT NULL,
    source_type VARCHAR(40) NOT NULL,
    item_type VARCHAR(64) NOT NULL,
    item_code VARCHAR(120) NOT NULL,
    fiscal_item_name VARCHAR(200) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'checkbox',
    provider_tax_id VARCHAR(128) NOT NULL,
    tax_code INTEGER,
    tax_rate_bps INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fiscal_item_mappings_id_profile UNIQUE (id, fiscal_profile_id),
    CONSTRAINT uq_fiscal_item_mappings_active UNIQUE (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider),
    CONSTRAINT fk_fiscal_item_mappings_register_profile
        FOREIGN KEY (fiscal_register_id, fiscal_profile_id)
        REFERENCES fiscal_registers(id, fiscal_profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_fiscal_item_mappings_profile_context
        FOREIGN KEY (fiscal_profile_id, crm_profile_key)
        REFERENCES fiscal_profiles(id, crm_profile_key) ON DELETE RESTRICT,
    CONSTRAINT chk_fiscal_item_mappings_crm_profile CHECK (crm_profile_key ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_item_mappings_source_type CHECK (source_type ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_item_mappings_item_type CHECK (item_type ~ '^[a-z0-9_]+$'),
    CONSTRAINT chk_fiscal_item_mappings_item_code CHECK (BTRIM(item_code) <> ''),
    CONSTRAINT chk_fiscal_item_mappings_name CHECK (BTRIM(fiscal_item_name) <> ''),
    CONSTRAINT chk_fiscal_item_mappings_provider CHECK (provider IN ('checkbox')),
    CONSTRAINT chk_fiscal_item_mappings_provider_tax CHECK (BTRIM(provider_tax_id) <> ''),
    CONSTRAINT chk_fiscal_item_mappings_tax_rate CHECK (tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT chk_fiscal_item_mappings_status CHECK (status IN ('draft', 'active', 'suspended', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_item_mappings_lookup_v321
    ON fiscal_item_mappings (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code)
    WHERE status = 'active';

COMMENT ON TABLE fiscal_item_mappings IS
    'Explicit accountant-approved fiscal item and provider tax mapping. Raw secrets and internal tariff references must not be stored as provider tax IDs.';
