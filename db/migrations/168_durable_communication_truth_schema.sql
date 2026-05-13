-- MIGRATION_KIND: schema
-- SAFETY: Adds nullable durable Omni communication truth fields and non-destructive timestamp backfills; historical outbound messages are not marked as delivered.
-- ROLLBACK: Drop the added conversation_messages delivery columns, conversations timestamp columns, related indexes, and the delivery status check constraint if this schema slice is reverted.

ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS delivery_error TEXT,
    ADD COLUMN IF NOT EXISTS send_attempted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS provider_accepted_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'conversation_messages_delivery_status_check'
    ) THEN
        ALTER TABLE conversation_messages
            ADD CONSTRAINT conversation_messages_delivery_status_check
            CHECK (
                delivery_status IS NULL
                OR delivery_status IN ('saved', 'attempted', 'accepted', 'failed', 'unknown')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conv_messages_provider_message_id
    ON conversation_messages(provider_message_id)
    WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_messages_delivery_status
    ON conversation_messages(delivery_status)
    WHERE delivery_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_inbound_at
    ON conversations(last_inbound_at DESC)
    WHERE last_inbound_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_outbound_at
    ON conversations(last_outbound_at DESC)
    WHERE last_outbound_at IS NOT NULL;

UPDATE conversations c
SET last_inbound_at = latest.last_inbound_at
FROM (
    SELECT conversation_id, MAX(created_at) AS last_inbound_at
    FROM conversation_messages
    WHERE direction = 'inbound'
    GROUP BY conversation_id
) latest
WHERE c.id = latest.conversation_id
  AND c.last_inbound_at IS NULL;

UPDATE conversations c
SET last_outbound_at = latest.last_outbound_at
FROM (
    SELECT conversation_id, MAX(created_at) AS last_outbound_at
    FROM conversation_messages
    WHERE direction = 'outbound'
    GROUP BY conversation_id
) latest
WHERE c.id = latest.conversation_id
  AND c.last_outbound_at IS NULL;
