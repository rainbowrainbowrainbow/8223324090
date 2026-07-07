-- MIGRATION_KIND: schema
-- SAFETY: Additive deposit review fields only; existing banquet_deposits rows remain valid and optional.
-- ROLLBACK: Export affected banquet_deposits data first, then drop the indexes, constraints, and columns added here.
-- DATA_SCOPE: No destructive data changes or production data cleanup.

ALTER TABLE banquet_deposits
    ADD COLUMN IF NOT EXISTS expected_amount INTEGER,
    ADD COLUMN IF NOT EXISTS paid_amount INTEGER,
    ADD COLUMN IF NOT EXISTS manager_status VARCHAR(64) NOT NULL DEFAULT 'Очікуємо оплату',
    ADD COLUMN IF NOT EXISTS accounting_status VARCHAR(64) NOT NULL DEFAULT 'Не перевірено',
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS manager_note TEXT,
    ADD COLUMN IF NOT EXISTS accounting_note TEXT,
    ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS review_started_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE banquet_deposits
   SET expected_amount = amount
 WHERE expected_amount IS NULL
   AND amount IS NOT NULL;

UPDATE banquet_deposits
   SET paid_amount = amount
 WHERE paid_amount IS NULL
   AND amount IS NOT NULL
   AND status IN ('accountant_verified', 'corrected');

UPDATE banquet_deposits
   SET accounting_status = CASE
        WHEN status IN ('accountant_verified', 'corrected') THEN 'Підтверджено'
        WHEN status = 'cancelled' THEN 'Скасовано / повернено'
        ELSE accounting_status
   END
 WHERE accounting_status = 'Не перевірено'
   AND status IN ('accountant_verified', 'corrected', 'cancelled');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'banquet_deposits_expected_amount_check'
    ) THEN
        ALTER TABLE banquet_deposits
            ADD CONSTRAINT banquet_deposits_expected_amount_check
            CHECK (expected_amount IS NULL OR expected_amount >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'banquet_deposits_paid_amount_check'
    ) THEN
        ALTER TABLE banquet_deposits
            ADD CONSTRAINT banquet_deposits_paid_amount_check
            CHECK (paid_amount IS NULL OR paid_amount >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'banquet_deposits_manager_status_check'
    ) THEN
        ALTER TABLE banquet_deposits
            ADD CONSTRAINT banquet_deposits_manager_status_check
            CHECK (manager_status IN (
                'Не потрібен',
                'Очікуємо оплату',
                'Клієнт повідомив про оплату',
                'Потрібна перевірка бухгалтерії'
            ));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'banquet_deposits_accounting_status_check'
    ) THEN
        ALTER TABLE banquet_deposits
            ADD CONSTRAINT banquet_deposits_accounting_status_check
            CHECK (accounting_status IN (
                'Не перевірено',
                'На перевірці',
                'Підтверджено',
                'Оплату не знайдено',
                'Сума не збігається',
                'Скасовано / повернено'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_accounting_review
    ON banquet_deposits (business_context, accounting_status, event_date, due_date, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_review_started_by
    ON banquet_deposits (review_started_by)
    WHERE review_started_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_primary_booking_review
    ON banquet_deposits (business_context, primary_booking_id, updated_at DESC)
    WHERE primary_booking_id IS NOT NULL;
