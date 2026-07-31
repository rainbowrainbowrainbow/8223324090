-- MIGRATION_KIND: schema
-- SAFETY: Additive table/index-only migration for bot-native staff/account onboarding approvals. Does not mutate staff, users, schedules, salaries, outbox, or credentials.
-- ROLLBACK: Drop indexes idx_staff_account_onboarding_approvals_* and table staff_account_onboarding_approvals after verifying no pending/executed onboarding approvals are needed.
-- DATA_SCOPE: Approval request metadata and sanitized request/preview/result receipts only; plaintext one-time credential material is explicitly not stored.

-- 308_hermes_staff_account_onboarding_approvals.sql
-- Bot-native pending approval state for Event Genix staff + CRM-account onboarding.
-- Stores sanitized request/preview/result data only. One-time credential values must never be persisted here.

CREATE TABLE IF NOT EXISTS staff_account_onboarding_approvals (
    id BIGSERIAL PRIMARY KEY,
    request_uuid UUID NOT NULL UNIQUE,
    flow_version TEXT NOT NULL DEFAULT 'EG_STAFF_ACCOUNT_ONBOARDING_APPROVAL_FLOW_V1',
    request_type TEXT NOT NULL DEFAULT 'new_staff_with_account',
    status TEXT NOT NULL DEFAULT 'pending_approval',
    requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    primary_approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    fallback_approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    fallback_after_hours INTEGER NOT NULL DEFAULT 2,
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    preview_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_receipt JSONB,
    credential_issued BOOLEAN NOT NULL DEFAULT false,
    approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejected_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    executed_at TIMESTAMPTZ,
    execution_error_code TEXT,
    execution_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT staff_account_onboarding_approvals_status_check CHECK (
        status IN ('pending_approval', 'rejected', 'executing', 'executed', 'failed')
    ),
    CONSTRAINT staff_account_onboarding_approvals_no_request_secret CHECK (
        request_payload::text !~* '(password|credential|secret|token|api[_-]?key|cookie|session)'
    ),
    CONSTRAINT staff_account_onboarding_approvals_no_preview_secret CHECK (
        preview_payload::text !~* '(password|credential|secret|token|api[_-]?key|cookie|session)'
    ),
    CONSTRAINT staff_account_onboarding_approvals_no_result_password CHECK (
        COALESCE(result_receipt::text, '') !~* '"password"\s*:\s*"(?!\[REDACTED\])'
    )
);

CREATE INDEX IF NOT EXISTS idx_staff_account_onboarding_approvals_status_created
    ON staff_account_onboarding_approvals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_account_onboarding_approvals_primary_pending
    ON staff_account_onboarding_approvals (primary_approver_user_id, created_at DESC)
    WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_staff_account_onboarding_approvals_fallback_pending
    ON staff_account_onboarding_approvals (fallback_approver_user_id, created_at DESC)
    WHERE status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_staff_account_onboarding_approvals_payload_username
    ON staff_account_onboarding_approvals ((LOWER(request_payload #>> '{personal,username}')));
