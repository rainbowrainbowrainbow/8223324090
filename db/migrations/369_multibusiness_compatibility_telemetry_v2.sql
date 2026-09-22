-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent aggregate telemetry and runtime reconciliation only. No users, memberships, permissions, business data, secrets, payloads, prices, or operational records are changed.
-- ROLLBACK: Retain telemetry evidence by default. Drop the v2 tables only after the exit gate is retired and every deployed recorder/report reader is removed.

CREATE TABLE IF NOT EXISTS business_compatibility_telemetry_v2_hourly (
    observed_hour TIMESTAMPTZ NOT NULL,
    business_context VARCHAR(64) NOT NULL,
    entry_family VARCHAR(48) NOT NULL,
    decision_stage VARCHAR(24) NOT NULL,
    authority_source VARCHAR(24) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    deployment_sha CHAR(40) NOT NULL,
    eligible_count BIGINT NOT NULL DEFAULT 0,
    collected_count BIGINT NOT NULL DEFAULT 0,
    gap_count BIGINT NOT NULL DEFAULT 0,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (observed_hour,business_context,entry_family,decision_stage,authority_source,outcome,deployment_sha),
    CONSTRAINT business_compatibility_v2_context_check CHECK (business_context ~ '^[a-z][a-z0-9_]{2,63}$'),
    CONSTRAINT business_compatibility_v2_family_check CHECK (entry_family IN ('http','profile','service','websocket','alternate_auth','provider','job','operator','public')),
    CONSTRAINT business_compatibility_v2_stage_check CHECK (decision_stage IN ('ingress','admission','domain','execution','serialization')),
    CONSTRAINT business_compatibility_v2_authority_check CHECK (authority_source IN ('membership','compatibility','machine_principal','missing_context','unknown')),
    CONSTRAINT business_compatibility_v2_outcome_check CHECK (outcome IN ('allowed','denied','unavailable')),
    CONSTRAINT business_compatibility_v2_sha_check CHECK (deployment_sha ~ '^[a-f0-9]{40}$'),
    CONSTRAINT business_compatibility_v2_counts_check CHECK (
        eligible_count >= 0 AND collected_count >= 0 AND gap_count >= 0
        AND collected_count + gap_count = eligible_count
    )
);

CREATE INDEX IF NOT EXISTS idx_business_compatibility_v2_context_hour
    ON business_compatibility_telemetry_v2_hourly (business_context,observed_hour DESC);

CREATE TABLE IF NOT EXISTS business_compatibility_telemetry_runtime (
    runtime_instance UUID NOT NULL,
    deployment_sha CHAR(40) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    eligible_count BIGINT NOT NULL DEFAULT 0,
    persisted_count BIGINT NOT NULL DEFAULT 0,
    failed_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (runtime_instance,deployment_sha),
    CONSTRAINT business_compatibility_runtime_sha_check CHECK (deployment_sha ~ '^[a-f0-9]{40}$'),
    CONSTRAINT business_compatibility_runtime_counts_check CHECK (
        eligible_count >= 0 AND persisted_count >= 0 AND failed_count >= 0
        AND persisted_count + failed_count = eligible_count
    )
);
