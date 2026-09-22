-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent journal for an explicitly approved catalog ownership cutover. No catalog, token, asset, price, or operational row is changed by this migration.
-- OPERATOR_APPROVAL: required before an apply request uses a reviewed mapping and current DB fingerprint.
-- ROLLBACK: Retain journal evidence by default. Drop this table only after exporting the receipts and removing every deployed reader.

CREATE TABLE IF NOT EXISTS catalog_ownership_cutover_journal (
    business_context VARCHAR(64) PRIMARY KEY,
    state VARCHAR(16) NOT NULL,
    mapping_sha256 CHAR(64) NOT NULL,
    source_fingerprint_sha256 CHAR(64) NOT NULL,
    receipt_sha256 CHAR(64),
    decision_ref TEXT NOT NULL,
    catalog_count INTEGER NOT NULL,
    public_link_count INTEGER NOT NULL,
    prepared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    applied_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_ownership_cutover_state_check CHECK (state IN ('prepared', 'applied', 'blocked', 'rolled_back')),
    CONSTRAINT catalog_ownership_cutover_context_check CHECK (business_context = 'event_genix'),
    CONSTRAINT catalog_ownership_cutover_mapping_hash_check CHECK (mapping_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT catalog_ownership_cutover_fingerprint_hash_check CHECK (source_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT catalog_ownership_cutover_receipt_hash_check CHECK (receipt_sha256 IS NULL OR receipt_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT catalog_ownership_cutover_counts_check CHECK (catalog_count = 9 AND public_link_count = 3),
    CONSTRAINT catalog_ownership_cutover_applied_check CHECK (
        (state = 'applied' AND receipt_sha256 IS NOT NULL AND applied_at IS NOT NULL)
        OR (state <> 'applied' AND receipt_sha256 IS NULL AND applied_at IS NULL)
    )
);
