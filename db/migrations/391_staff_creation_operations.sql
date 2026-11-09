-- MIGRATION_KIND: schema
-- SAFETY: Additive ledger for Park staff creation and onboarding. Existing staff and accounts are untouched.
-- ROLLBACK: Roll back application code and leave the ledger in place so committed operation identities remain available.

CREATE TABLE IF NOT EXISTS staff_creation_operations (
    actor_user_id INTEGER NOT NULL,
    park_scope TEXT NOT NULL,
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('staff', 'onboarding')),
    operation_key UUID NOT NULL,
    request_hash TEXT NOT NULL,
    staff_id INTEGER NOT NULL,
    account_user_id INTEGER,
    staff_created BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, park_scope, operation_kind, operation_key)
);
