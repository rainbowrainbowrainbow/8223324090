-- MIGRATION_KIND: schema
-- SAFETY: Additive report template/draft tables plus a submitted_via compatibility constraint expansion; existing report rows and finance/report-bot flows are preserved.
-- ROLLBACK: Drop report_table_drafts and report_templates, then restore the old reports_submitted_via_check if template-origin reports must be disabled.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: no existing rows are rewritten; only the reports.submitted_via constraint is widened and system report templates are upserted.

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_submitted_via_check;
ALTER TABLE reports
    ADD CONSTRAINT reports_submitted_via_check
    CHECK (submitted_via IN ('bot', 'web', 'manual', 'web-template', 'template'));

CREATE TABLE IF NOT EXISTS report_templates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(220) NOT NULL,
    category VARCHAR(120) DEFAULT 'Custom',
    layout VARCHAR(80) DEFAULT 'custom',
    description TEXT,
    purpose TEXT,
    schema_json JSONB NOT NULL DEFAULT '{"columns":[],"rows":[]}'::jsonb,
    default_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    source VARCHAR(40) NOT NULL DEFAULT 'system',
    scope VARCHAR(30) NOT NULL DEFAULT 'global',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_username VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_templates_active_scope
    ON report_templates(is_active, scope, category);

CREATE INDEX IF NOT EXISTS idx_report_templates_owner
    ON report_templates(created_by_username)
    WHERE created_by_username IS NOT NULL;

CREATE TABLE IF NOT EXISTS report_table_drafts (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES report_templates(id) ON DELETE SET NULL,
    title VARCHAR(220) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    table_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_username VARCHAR(100),
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_table_drafts_owner_status
    ON report_table_drafts(created_by_username, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_table_drafts_template
    ON report_table_drafts(template_id);

INSERT INTO report_templates (
    code, title, category, layout, description, purpose, schema_json, default_report_json, source, scope, is_active
) VALUES
(
    'finance-day-summary',
    'Фінансовий підсумок дня',
    'Фінанси',
    'financial',
    'Доходи, витрати, маржа й короткий коментар по зміні.',
    'Швидкий щоденний фінансовий звіт для бухгалтера або директора.',
    '{"columns":[{"key":"date","label":"Дата","type":"date","placeholder":"2026-05-22"},{"key":"income","label":"Доходи","type":"number","placeholder":"0","total":"sum"},{"key":"expense","label":"Витрати","type":"number","placeholder":"0","total":"sum"},{"key":"profit","label":"Прибуток","type":"number","placeholder":"0","total":"sum"},{"key":"comment","label":"Коментар","type":"text","placeholder":"Що вплинуло на результат?"}],"rows":[{"date":"","income":"","expense":"","profit":"","comment":""},{"date":"","income":"","expense":"","profit":"","comment":""}]}'::jsonb,
    '{"type":"income","category":"Інше","hashtag":"table-finance","amountColumn":"profit"}'::jsonb,
    'system',
    'global',
    true
),
(
    'operations-checklist',
    'Операційний чекліст',
    'Операції',
    'checklist',
    'Контроль зон, відповідальних і статусів перед/після зміни.',
    'Стандартна таблиця для операційного контролю без фінансового перерахунку.',
    '{"columns":[{"key":"zone","label":"Зона","type":"text","placeholder":"Reception / зал / кухня"},{"key":"task","label":"Що перевірити","type":"text","placeholder":"Каса, чистота, реквізит..."},{"key":"owner","label":"Відповідальний","type":"text","placeholder":"Імʼя"},{"key":"status","label":"Статус","type":"text","placeholder":"OK / ризик / зробити"},{"key":"note","label":"Нотатка","type":"text","placeholder":"Що потрібно доробити?"}],"rows":[{"zone":"Reception","task":"Каса і чеки","owner":"","status":"","note":""},{"zone":"Зал","task":"Чистота та безпека","owner":"","status":"","note":""},{"zone":"Склад","task":"Реквізит і витратники","owner":"","status":"","note":""}]}'::jsonb,
    '{"type":"expense","category":"Офіс","hashtag":"table-ops","amountColumn":null}'::jsonb,
    'system',
    'global',
    true
),
(
    'payroll-staff',
    'Команда / payroll',
    'HR',
    'payroll',
    'Години, ставки, бонуси й сума до виплати по працівниках.',
    'Таблична заготовка для передачі зарплатного звіту у фінанси.',
    '{"columns":[{"key":"employee","label":"Працівник","type":"text","placeholder":"Імʼя"},{"key":"role","label":"Роль","type":"text","placeholder":"Аніматор / адміністратор"},{"key":"hours","label":"Години","type":"number","placeholder":"0","total":"sum"},{"key":"rate","label":"Ставка","type":"number","placeholder":"0"},{"key":"bonus","label":"Бонус","type":"number","placeholder":"0","total":"sum"},{"key":"total","label":"До виплати","type":"number","placeholder":"0","total":"sum"}],"rows":[{"employee":"","role":"","hours":"","rate":"","bonus":"","total":""},{"employee":"","role":"","hours":"","rate":"","bonus":"","total":""}]}'::jsonb,
    '{"type":"expense","category":"ЗП","hashtag":"table-payroll","amountColumn":"total"}'::jsonb,
    'system',
    'global',
    true
),
(
    'custom-table',
    'Кастомна таблиця',
    'Custom',
    'custom',
    'Порожній універсальний формат, коли потрібен нестандартний звіт.',
    'Швидкий старт для ручного табличного звіту.',
    '{"columns":[{"key":"item","label":"Позиція","type":"text","placeholder":"Назва рядка"},{"key":"value","label":"Значення","type":"number","placeholder":"0","total":"sum"},{"key":"comment","label":"Коментар","type":"text","placeholder":"Деталі"}],"rows":[{"item":"","value":"","comment":""},{"item":"","value":"","comment":""},{"item":"","value":"","comment":""}]}'::jsonb,
    '{"type":"expense","category":"Інше","hashtag":"table-custom","amountColumn":"value"}'::jsonb,
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
