-- MIGRATION_KIND: schema
-- SAFETY: Extends Viber Personal Bridge command status with terminal failed. Existing command rows are preserved and existing statuses remain valid.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Before rollback, confirm no omni_viber_personal_bridge_commands rows have status='failed', then restore the previous status CHECK without failed.

ALTER TABLE omni_viber_personal_bridge_commands
    DROP CONSTRAINT IF EXISTS omni_viber_personal_bridge_commands_status_check;

ALTER TABLE omni_viber_personal_bridge_commands
    ADD CONSTRAINT omni_viber_personal_bridge_commands_status_check
    CHECK (status IN ('queued','leased','dispatch_started','submitted_unconfirmed','failed','unknown','rejected'));
