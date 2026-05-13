-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable provider lifecycle metadata and extends the durable delivery_status check for receipt-backed Viber/TurboSMS lifecycle states; no historical rows are backfilled.
-- ROLLBACK: Drop provider_lifecycle_at/provider_lifecycle_event/provider_lifecycle_source, remove related indexes, and restore the previous delivery_status check after remapping any delivered/read/later_failed rows.
-- OPERATOR_APPROVAL: required

ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS provider_lifecycle_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS provider_lifecycle_event VARCHAR(60),
    ADD COLUMN IF NOT EXISTS provider_lifecycle_source VARCHAR(40);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'conversation_messages_delivery_status_check'
    ) THEN
        ALTER TABLE conversation_messages
            DROP CONSTRAINT conversation_messages_delivery_status_check;
    END IF;

    ALTER TABLE conversation_messages
        ADD CONSTRAINT conversation_messages_delivery_status_check
        CHECK (
            delivery_status IS NULL
            OR delivery_status IN (
                'saved',
                'attempted',
                'accepted',
                'delivered',
                'read',
                'failed',
                'later_failed',
                'unknown'
            )
        );
END $$;

CREATE INDEX IF NOT EXISTS idx_conv_messages_provider_lifecycle_at
    ON conversation_messages(provider_lifecycle_at DESC)
    WHERE provider_lifecycle_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_messages_provider_lifecycle_source
    ON conversation_messages(provider_lifecycle_source)
    WHERE provider_lifecycle_source IS NOT NULL;
