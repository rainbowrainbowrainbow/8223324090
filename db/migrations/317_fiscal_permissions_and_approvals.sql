-- MIGRATION_KIND: schema
-- SAFETY: Additive fiscal authorization hardening only. It adds explicit cashier binding scope, hashed action-PIN metadata, and operation-bound approval fields without changing users, roles, secrets, legacy finance tables, or production data.
-- ROLLBACK: Disable the payment/fiscal feature flag, stop fiscal writes, export any new approval/binding metadata if needed, then drop the v317 constraints, indexes, and columns after application rollback.

ALTER TABLE fiscal_cashier_bindings
    ADD COLUMN IF NOT EXISTS crm_profile_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS fiscal_location_id BIGINT,
    ADD COLUMN IF NOT EXISTS capability_scope TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS action_pin_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS action_pin_set_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS action_pin_updated_by_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pin_last_failed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pin_last_verified_at TIMESTAMPTZ;

ALTER TABLE fiscal_operations
    ADD COLUMN IF NOT EXISTS initiated_by_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS approval_id BIGINT,
    ADD COLUMN IF NOT EXISTS server_approval_status VARCHAR(24) NOT NULL DEFAULT 'not_required';

ALTER TABLE fiscal_action_approvals
    ADD COLUMN IF NOT EXISTS fiscal_operation_id BIGINT,
    ADD COLUMN IF NOT EXISTS payment_order_id BIGINT,
    ADD COLUMN IF NOT EXISTS payment_refund_id BIGINT,
    ADD COLUMN IF NOT EXISTS consumed_by_operation_id BIGINT,
    ADD COLUMN IF NOT EXISTS approval_method VARCHAR(32) NOT NULL DEFAULT 'action_pin',
    ADD COLUMN IF NOT EXISTS approval_scope JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_cashier_bindings_profile_context_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT fk_fiscal_cashier_bindings_profile_context_v317
            FOREIGN KEY (fiscal_profile_id, crm_profile_key)
            REFERENCES fiscal_profiles(id, crm_profile_key) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_cashier_bindings_location_profile_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT fk_fiscal_cashier_bindings_location_profile_v317
            FOREIGN KEY (fiscal_location_id, fiscal_profile_id)
            REFERENCES fiscal_locations(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_cashier_bindings_pin_updated_by_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT fk_fiscal_cashier_bindings_pin_updated_by_v317
            FOREIGN KEY (action_pin_updated_by_user_id)
            REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_scope_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT chk_fiscal_cashier_bindings_scope_v317
            CHECK (
                status <> 'active'
                OR (
                    crm_profile_key IS NOT NULL
                    AND fiscal_location_id IS NOT NULL
                    AND action_pin_hash IS NOT NULL
                    AND BTRIM(action_pin_hash) <> ''
                    AND pin_failed_attempts >= 0
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_cashier_bindings_capability_scope_v317'
          AND conrelid = 'fiscal_cashier_bindings'::regclass
    ) THEN
        ALTER TABLE fiscal_cashier_bindings
            ADD CONSTRAINT chk_fiscal_cashier_bindings_capability_scope_v317
            CHECK (
                capability_scope <@ ARRAY[
                    'payments.view',
                    'payments.create',
                    'payments.confirm_received',
                    'fiscal.shift.open',
                    'fiscal.shift.close',
                    'fiscal.service_in',
                    'fiscal.service_out.request',
                    'fiscal.service_out.approve',
                    'fiscal.refund',
                    'fiscal.reconcile',
                    'fiscal.audit.view',
                    'fiscal.configure'
                ]::text[]
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_operations_initiated_by_v317'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT fk_fiscal_operations_initiated_by_v317
            FOREIGN KEY (initiated_by_user_id)
            REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_operations_approved_by_v317'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT fk_fiscal_operations_approved_by_v317
            FOREIGN KEY (approved_by_user_id)
            REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_operations_server_approval_status_v317'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT chk_fiscal_operations_server_approval_status_v317
            CHECK (server_approval_status IN ('not_required', 'required', 'approved', 'consumed', 'expired', 'revoked'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_action_approvals_operation_profile_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT fk_fiscal_action_approvals_operation_profile_v317
            FOREIGN KEY (fiscal_operation_id, fiscal_profile_id)
            REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_action_approvals_payment_order_profile_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT fk_fiscal_action_approvals_payment_order_profile_v317
            FOREIGN KEY (payment_order_id, fiscal_profile_id)
            REFERENCES payment_orders(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_action_approvals_refund_profile_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT fk_fiscal_action_approvals_refund_profile_v317
            FOREIGN KEY (payment_refund_id, fiscal_profile_id)
            REFERENCES payment_refunds(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_action_approvals_consumed_operation_profile_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT fk_fiscal_action_approvals_consumed_operation_profile_v317
            FOREIGN KEY (consumed_by_operation_id, fiscal_profile_id)
            REFERENCES fiscal_operations(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_action_approvals_operation_scope_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT chk_fiscal_action_approvals_operation_scope_v317
            CHECK (target_table <> 'fiscal_operations' OR fiscal_operation_id = target_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_action_approvals_method_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT chk_fiscal_action_approvals_method_v317
            CHECK (approval_method IN ('action_pin'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_action_approvals_timebox_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT chk_fiscal_action_approvals_timebox_v317
            CHECK (expires_at IS NULL OR expires_at > approved_at);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fiscal_action_approvals_distinct_service_out_v317'
          AND conrelid = 'fiscal_action_approvals'::regclass
    ) THEN
        ALTER TABLE fiscal_action_approvals
            ADD CONSTRAINT chk_fiscal_action_approvals_distinct_service_out_v317
            CHECK (action_type <> 'service_out' OR requested_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fiscal_operations_approval_profile_v317'
          AND conrelid = 'fiscal_operations'::regclass
    ) THEN
        ALTER TABLE fiscal_operations
            ADD CONSTRAINT fk_fiscal_operations_approval_profile_v317
            FOREIGN KEY (approval_id, fiscal_profile_id)
            REFERENCES fiscal_action_approvals(id, fiscal_profile_id) ON DELETE RESTRICT;
    END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_fiscal_cashier_bindings_scope_v317
    ON fiscal_cashier_bindings (user_id, fiscal_profile_id, crm_profile_key, fiscal_location_id, fiscal_register_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_cashier_bindings_explicit_scope_v317
    ON fiscal_cashier_bindings (user_id, fiscal_profile_id, crm_profile_key, fiscal_location_id, fiscal_register_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_cashier_bindings_pin_lock_v317
    ON fiscal_cashier_bindings (user_id, pin_locked_until)
    WHERE status = 'active' AND pin_locked_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_operations_approval_v317
    ON fiscal_operations (fiscal_profile_id, approval_required, server_approval_status, created_at DESC)
    WHERE approval_required = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_action_approvals_operation_active_v317
    ON fiscal_action_approvals (fiscal_profile_id, fiscal_operation_id, action_type)
    WHERE status = 'approved' AND consumed_at IS NULL AND fiscal_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_action_approvals_operation_v317
    ON fiscal_action_approvals (fiscal_profile_id, fiscal_operation_id, status, expires_at);

COMMENT ON COLUMN fiscal_cashier_bindings.action_pin_hash IS
    'bcrypt hash of the user-specific fiscal action PIN; raw PIN values must never be stored.';

COMMENT ON COLUMN fiscal_action_approvals.approval_hash IS
    'Server-generated approval nonce hash for one-time operation-bound approval; it is not a raw PIN, token, or provider secret.';
