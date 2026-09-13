-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent cutover evidence and aggregate telemetry tables only. No organization, business, membership, legacy context, owner, financial, or operational rows are created or changed.
-- OPERATOR_APPROVAL: required before any future cutover apply uses this journal with a reviewed mapping.
-- ROLLBACK: Retain journal and telemetry evidence by default. Drop these tables only after exporting cutover/audit evidence and confirming no deployed resolver or operator workflow reads them.

CREATE TABLE IF NOT EXISTS business_cutover_journal (
    id BIGSERIAL PRIMARY KEY,
    context_key VARCHAR(64) NOT NULL,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    business_id BIGINT REFERENCES businesses(id) ON DELETE RESTRICT,
    state VARCHAR(16) NOT NULL,
    source_snapshot_sha256 CHAR(64) NOT NULL,
    mapping_sha256 CHAR(64) NOT NULL,
    source_deployment_sha CHAR(40) NOT NULL,
    prepared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    applied_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT business_cutover_journal_context_unique UNIQUE (context_key),
    CONSTRAINT business_cutover_journal_state_check CHECK (state IN ('prepared', 'applied', 'blocked', 'rolled_back')),
    CONSTRAINT business_cutover_journal_context_format_check CHECK (context_key ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT business_cutover_journal_snapshot_hash_check CHECK (source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT business_cutover_journal_mapping_hash_check CHECK (mapping_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT business_cutover_journal_deployment_sha_check CHECK (source_deployment_sha ~ '^[a-f0-9]{40}$'),
    CONSTRAINT business_cutover_journal_applied_state_check CHECK (
        (state = 'applied' AND business_id IS NOT NULL AND applied_at IS NOT NULL)
        OR (state <> 'applied' AND applied_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_business_cutover_journal_organization_state
    ON business_cutover_journal (organization_id, state, prepared_at DESC);

CREATE TABLE IF NOT EXISTS business_compatibility_telemetry_hourly (
    observed_hour TIMESTAMPTZ NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    entry_family VARCHAR(48) NOT NULL,
    authority_source VARCHAR(24) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    deployment_sha CHAR(40) NOT NULL,
    decision_count BIGINT NOT NULL DEFAULT 0,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (observed_hour, business_context, entry_family, authority_source, outcome, deployment_sha),
    CONSTRAINT business_compatibility_telemetry_context_format_check CHECK (business_context ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT business_compatibility_telemetry_entry_family_check CHECK (entry_family IN ('http', 'profile', 'service', 'websocket', 'provider', 'job', 'operator', 'public')),
    CONSTRAINT business_compatibility_telemetry_authority_check CHECK (authority_source IN ('membership', 'compatibility', 'machine_principal', 'missing_context', 'unknown')),
    CONSTRAINT business_compatibility_telemetry_outcome_check CHECK (outcome IN ('allowed', 'denied', 'unavailable')),
    CONSTRAINT business_compatibility_telemetry_sha_check CHECK (deployment_sha ~ '^[a-f0-9]{40}$'),
    CONSTRAINT business_compatibility_telemetry_count_check CHECK (decision_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_business_compatibility_telemetry_hourly_context
    ON business_compatibility_telemetry_hourly (business_context, observed_hour DESC);
