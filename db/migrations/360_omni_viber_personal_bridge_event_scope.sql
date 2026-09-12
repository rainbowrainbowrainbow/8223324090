-- MIGRATION_KIND: schema
-- SAFETY: Narrows Viber Personal Bridge event idempotency to the exact bridge/account/epoch tuple. Existing rows keep their event records; no Omni conversations or messages are deleted.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Drop the replacement primary key and restore the previous (business_context, bridge_id, event_id) primary key after confirming no same-event-id rows exist across account epochs.

ALTER TABLE omni_viber_personal_bridge_events
    DROP CONSTRAINT IF EXISTS omni_viber_personal_bridge_events_pkey;

ALTER TABLE omni_viber_personal_bridge_events
    ADD CONSTRAINT omni_viber_personal_bridge_events_pkey
    PRIMARY KEY (business_context, bridge_id, account_id, account_epoch, event_id);

CREATE INDEX IF NOT EXISTS idx_omni_viber_personal_events_identity
    ON omni_viber_personal_bridge_events (business_context, bridge_id, account_id, account_epoch, status, received_at);
