-- MIGRATION_KIND: schema
-- SAFETY: Adds purpose/provider metadata to Omni provider connections, extends status vocabulary with needs_rebind, and safely reclassifies report-bot-shaped legacy Telegram rows without deleting report bot credentials.
-- ROLLBACK: Drop idx_omni_provider_connections_provider_purpose, remove provider/purpose columns, restore the previous status constraint without needs_rebind after manually confirming no rows still use needs_rebind.
-- OPERATOR_APPROVAL: required

ALTER TABLE omni_provider_connections
    ADD COLUMN IF NOT EXISTS provider VARCHAR(40),
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(40);

UPDATE omni_provider_connections
   SET provider = CASE
        WHEN channel IN ('telegram', 'report_bot') THEN 'telegram'
        ELSE channel
       END
 WHERE provider IS NULL OR provider = '';

UPDATE omni_provider_connections
   SET purpose = CASE
        WHEN channel = 'telegram' THEN 'inbox'
        WHEN channel = 'report_bot' THEN 'reports'
        WHEN channel = 'binotel' THEN 'history'
        ELSE 'inbox'
       END
 WHERE purpose IS NULL OR purpose = '';

ALTER TABLE omni_provider_connections
    ALTER COLUMN provider SET DEFAULT 'unknown',
    ALTER COLUMN provider SET NOT NULL,
    ALTER COLUMN purpose SET DEFAULT 'primary',
    ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE omni_provider_connections
    DROP CONSTRAINT IF EXISTS omni_provider_connections_status_check;

ALTER TABLE omni_provider_connections
    ADD CONSTRAINT omni_provider_connections_status_check
    CHECK (status IN (
        'connected',
        'disconnected',
        'limited',
        'token_expired',
        'misconfigured',
        'webhook_missing',
        'history_only',
        'provider_unreachable',
        'needs_rebind'
    ));

DO $$
DECLARE
    has_legacy_report_shape BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM omni_provider_connections
         WHERE channel = 'telegram'
           AND (
                COALESCE(credentials->'values', '{}'::jsonb) ? 'apiKey'
             OR COALESCE(credentials->'secrets', '{}'::jsonb) ? 'apiKey'
             OR COALESCE(credentials->'values', '{}'::jsonb) ? 'webhookSecret'
             OR COALESCE(credentials->'secrets', '{}'::jsonb) ? 'webhookSecret'
             OR COALESCE(account_display_name, '') ILIKE '%report%'
             OR COALESCE(account_display_name, '') ILIKE '%звіт%'
           )
    )
    INTO has_legacy_report_shape;

    IF has_legacy_report_shape THEN
        INSERT INTO omni_provider_connections (
            channel, provider, purpose, provider_kind, status, credentials, account_display_name,
            masked_identifier, send_enabled, receive_enabled, warning, last_checked_at,
            last_changed_at, changed_by_user_id, changed_by, last_test_at, last_test_status,
            last_test_message, disconnected_at, created_at, updated_at
        )
        SELECT
            'report_bot',
            'telegram',
            'reports',
            provider_kind,
            status,
            credentials,
            COALESCE(account_display_name, 'Бот звітів'),
            masked_identifier,
            send_enabled,
            receive_enabled,
            COALESCE(warning, 'Legacy Telegram binding reclassified as report bot.'),
            last_checked_at,
            NOW(),
            changed_by_user_id,
            COALESCE(changed_by, 'legacy repair'),
            last_test_at,
            last_test_status,
            last_test_message,
            disconnected_at,
            NOW(),
            NOW()
          FROM omni_provider_connections
         WHERE channel = 'telegram'
           AND NOT EXISTS (SELECT 1 FROM omni_provider_connections WHERE channel = 'report_bot')
         ON CONFLICT (channel) DO NOTHING;

        UPDATE omni_provider_connections
           SET provider = 'telegram',
               purpose = 'inbox',
               status = 'needs_rebind',
               credentials = '{}'::jsonb,
               account_display_name = NULL,
               masked_identifier = NULL,
               send_enabled = false,
               receive_enabled = false,
               warning = 'Legacy Telegram row looked like a report/alerts bot. It was separated from Telegram inbox; reconnect the real inbox bot.',
               last_changed_at = NOW(),
               disconnected_at = NOW(),
               updated_at = NOW()
         WHERE channel = 'telegram';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_omni_provider_connections_provider_purpose
    ON omni_provider_connections(provider, purpose);
