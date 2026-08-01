-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable fields only. The base users.role is never changed by a QA lease; an expired lease is ignored by authorization automatically.
-- ROLLBACK: Stop issuing QA leases first. Existing fields can remain safely because they do not affect access after expiry; drop the named constraint and the three fields only after no deployed code reads them.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS qa_creator_lease_id UUID,
    ADD COLUMN IF NOT EXISTS qa_creator_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS qa_creator_lease_granted_by_user_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_qa_creator_lease_complete_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_qa_creator_lease_complete_check
            CHECK (
                (qa_creator_lease_id IS NULL
                 AND qa_creator_lease_expires_at IS NULL
                 AND qa_creator_lease_granted_by_user_id IS NULL)
                OR
                (qa_creator_lease_id IS NOT NULL
                 AND qa_creator_lease_expires_at IS NOT NULL
                 AND qa_creator_lease_granted_by_user_id IS NOT NULL)
            );
    END IF;
END $$;
