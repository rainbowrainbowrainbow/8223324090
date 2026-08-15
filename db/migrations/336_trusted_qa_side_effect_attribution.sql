-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable Trusted QA attribution columns and indexes only. No existing production rows are read, backfilled, deleted, or validated.
-- DATA_SCOPE: schema-only attribution for side-effect tables that may exist in a given deployment.
-- ROLLBACK: Disable Trusted QA automation first, export cleanup_pending/blocked runs, then drop the v336 indexes and nullable trusted_qa_run_* columns/foreign keys from affected side-effect tables if required.

DO $$
DECLARE
    target_table TEXT;
    run_fk_name TEXT;
    entity_fk_name TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'warehouse_stock_movements',
        'warehouse_history',
        'rule_execution_log',
        'notification_outbox',
        'chat_messages',
        'announcements'
    ] LOOP
        IF to_regclass('public.' || quote_ident(target_table)) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS trusted_qa_run_id BIGINT', target_table);
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS trusted_qa_run_entity_id BIGINT', target_table);
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS trusted_qa_run_public_id VARCHAR(100)', target_table);

            run_fk_name := target_table || '_trusted_qa_run_id_fkey_v336';
            entity_fk_name := target_table || '_trusted_qa_run_entity_id_fkey_v336';

            IF to_regclass('public.trusted_qa_runs') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = run_fk_name) THEN
                EXECUTE format(
                    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (trusted_qa_run_id) REFERENCES trusted_qa_runs(id) ON DELETE SET NULL NOT VALID',
                    target_table,
                    run_fk_name
                );
            END IF;

            IF to_regclass('public.trusted_qa_run_entities') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = entity_fk_name) THEN
                EXECUTE format(
                    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (trusted_qa_run_entity_id) REFERENCES trusted_qa_run_entities(id) ON DELETE SET NULL NOT VALID',
                    target_table,
                    entity_fk_name
                );
            END IF;

            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON %I (trusted_qa_run_id) WHERE trusted_qa_run_id IS NOT NULL',
                'idx_' || target_table || '_tqa_run_v336',
                target_table
            );
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON %I (trusted_qa_run_entity_id) WHERE trusted_qa_run_entity_id IS NOT NULL',
                'idx_' || target_table || '_tqa_entity_v336',
                target_table
            );
            EXECUTE format(
                'CREATE INDEX IF NOT EXISTS %I ON %I (trusted_qa_run_public_id) WHERE trusted_qa_run_public_id IS NOT NULL',
                'idx_' || target_table || '_tqa_public_v336',
                target_table
            );
        END IF;
    END LOOP;
END $$;
