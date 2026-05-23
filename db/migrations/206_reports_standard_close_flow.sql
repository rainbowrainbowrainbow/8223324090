-- MIGRATION_KIND: mixed
-- SAFETY: Additive lifecycle columns, additive indexes, and an idempotent system template upsert; existing report accounting statuses and rows are preserved.
-- ROLLBACK: Deactivate or delete report_templates.code='park-standard-report', then drop the added lifecycle/snapshot columns and indexes if the close flow must be reverted.

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS report_lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closed_by_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS locked_snapshot JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_lifecycle_status_check'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_lifecycle_status_check
            CHECK (report_lifecycle_status IN ('open', 'closed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_lifecycle_closed
    ON reports(report_lifecycle_status, closed_at DESC)
    WHERE report_lifecycle_status = 'closed';

CREATE INDEX IF NOT EXISTS idx_reports_closed_by
    ON reports(closed_by_username, closed_at DESC)
    WHERE closed_by_username IS NOT NULL;

ALTER TABLE report_table_drafts
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closed_by_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS locked_snapshot JSONB;

INSERT INTO report_templates (
    code, title, category, layout, description, purpose, schema_json, default_report_json, source, scope, is_active
) VALUES (
    'park-standard-report',
    'Стандартний звіт',
    'Парк',
    'park-standard',
    'Фіксований стандартний звіт парку: дата, категорія, документ, сума і коментар.',
    'Щоденний park expense report для передачі бухгалтеру після закриття.',
    '{
        "columns": [
            {"key":"date","label":"Дата","type":"date","placeholder":""},
            {"key":"category","label":"Категорія","type":"select","options":["афіша","костюми","анімації","розходники","дар","квест","шоу","мафія","акція"],"placeholder":"Оберіть категорію"},
            {"key":"document","label":"Документ","type":"select","options":["чек","без чека","тов чек","виписка","інше"],"placeholder":"Оберіть документ"},
            {"key":"amount","label":"Сума","type":"number","placeholder":"0","total":"sum"},
            {"key":"comment","label":"Коментар","type":"text","placeholder":"Коментар для бухгалтера"}
        ],
        "rows": [
            {"date":"","category":"","document":"","amount":"","comment":""},
            {"date":"","category":"","document":"","amount":"","comment":""},
            {"date":"","category":"","document":"","amount":"","comment":""}
        ]
    }'::jsonb,
    '{
        "type":"expense",
        "category":"Стандартний звіт",
        "hashtag":"table-park-standard",
        "amountColumn":"amount",
        "totalLabel":"Ітого",
        "subtotalRules":[
            {"label":"Ітого ДАР","categoryColumn":"category","categoryValue":"дар","amountColumn":"amount"}
        ]
    }'::jsonb,
    'system',
    'global',
    true
)
ON CONFLICT (code) DO UPDATE SET
    title = EXCLUDED.title,
    category = EXCLUDED.category,
    layout = EXCLUDED.layout,
    description = EXCLUDED.description,
    purpose = EXCLUDED.purpose,
    schema_json = EXCLUDED.schema_json,
    default_report_json = EXCLUDED.default_report_json,
    source = EXCLUDED.source,
    scope = EXCLUDED.scope,
    is_active = true,
    updated_at = NOW();
