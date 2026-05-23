-- MIGRATION_KIND: schema
-- SAFETY: additive personal template tables only; existing tasks and subtasks are not rewritten.
-- ROLLBACK: Drop task_decomposition_template_items and task_decomposition_templates after exporting saved decomposition templates if they must be preserved.

CREATE TABLE IF NOT EXISTS task_decomposition_templates (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    category VARCHAR(64),
    subcategory VARCHAR(64),
    scope TEXT DEFAULT 'personal',
    source_type TEXT DEFAULT 'manual',
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_task_decomposition_templates_scope
        CHECK (scope IN ('personal')),
    CONSTRAINT chk_task_decomposition_templates_source_type
        CHECK (source_type IN ('manual','template','ai','template_ai','mixed')),
    CONSTRAINT chk_task_decomposition_templates_usage
        CHECK (usage_count >= 0)
);

CREATE TABLE IF NOT EXISTS task_decomposition_template_items (
    id BIGSERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES task_decomposition_templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    source_type TEXT DEFAULT 'template',
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_task_decomposition_template_items_source_type
        CHECK (source_type IN ('manual','template','ai','system'))
);

CREATE INDEX IF NOT EXISTS idx_task_decomposition_templates_owner
    ON task_decomposition_templates(owner_user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_decomposition_templates_category
    ON task_decomposition_templates(owner_user_id, category, subcategory)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_task_decomposition_template_items_template
    ON task_decomposition_template_items(template_id, sort_order, id);
