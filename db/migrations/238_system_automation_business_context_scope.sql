-- MIGRATION_KIND: schema
-- SAFETY: Additive business_context scope for system automation sources. Existing recurring task templates and auto-ordering rows remain in the default Event Genix business unless a warehouse stock row gives a stronger context. No automation rows are deleted.
-- ROLLBACK: Export non-event_genix task template and auto-ordering rows created after this migration, drop the scoped indexes, then drop the added business_context columns only if these automations are intentionally returned to a global model.

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE task_templates
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR trim(business_context) = '';

ALTER TABLE auto_order_rules
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE auto_order_requests
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE auto_order_rules aor
   SET business_context = COALESCE(ws.business_context, aor.business_context, 'event_genix')
  FROM warehouse_stock ws
 WHERE ws.id = aor.stock_id
   AND COALESCE(aor.business_context, 'event_genix') IS DISTINCT FROM COALESCE(ws.business_context, 'event_genix');

UPDATE auto_order_requests aor
   SET business_context = COALESCE(ws.business_context, aor.business_context, 'event_genix')
  FROM warehouse_stock ws
 WHERE ws.id = aor.stock_id
   AND COALESCE(aor.business_context, 'event_genix') IS DISTINCT FROM COALESCE(ws.business_context, 'event_genix');

CREATE INDEX IF NOT EXISTS idx_task_templates_business_active_created
    ON task_templates(business_context, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_order_rules_business_active_stock
    ON auto_order_rules(business_context, is_active, stock_id);

CREATE INDEX IF NOT EXISTS idx_auto_order_requests_business_status_created
    ON auto_order_requests(business_context, status, created_at DESC);
