-- MIGRATION_KIND: mixed
-- SAFETY: Adds a stable code without changing certificate labels, status, expiry or usage. Only labels already accepted by the previous exact one-time rule gain one_time_admission; exact legacy subscription labels gain subscription. Re-running changes only rows still missing a code.
-- ROLLBACK: Keep the additive column. Before reverting the application, run the read-only type audit and block an old binary if priorVersionRollback.unsafeGrants is nonzero: its text-based rule could redeem a non-one-time row. Drop the column only after a separate approved cleanup when no application version reads it.
-- DATA_SCOPE: All existing certificates with type_code NULL at migration time. Exact normalized 'на одноразовий вхід' and 'абонемент' labels are mapped; every other label remains verification_only.

ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS type_code VARCHAR(32);

UPDATE certificates
SET type_code = CASE
    WHEN LOWER(BTRIM(type_text)) = 'на одноразовий вхід' THEN 'one_time_admission'
    WHEN LOWER(BTRIM(type_text)) = 'абонемент' THEN 'subscription'
    ELSE 'verification_only'
END
WHERE type_code IS NULL;

ALTER TABLE certificates
    ALTER COLUMN type_code SET DEFAULT 'verification_only',
    ALTER COLUMN type_code SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE certificates
        ADD CONSTRAINT certificates_type_code_check
        CHECK (type_code IN ('one_time_admission', 'subscription', 'verification_only'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
