-- Migration 136: Catalog automations + page versioning
-- Part of: Каталоги Етап 5 — автоматизація

-- 1. Catalog automations table
CREATE TABLE IF NOT EXISTS catalog_automations (
    id SERIAL PRIMARY KEY,
    catalog_id VARCHAR(50) REFERENCES catalog_definitions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT DEFAULT 'manual',
    assigned_role TEXT DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalog_automations_catalog ON catalog_automations(catalog_id);

-- 2. Page version tracking
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- 3. Page history for rollback
CREATE TABLE IF NOT EXISTS catalog_page_history (
    id SERIAL PRIMARY KEY,
    catalog_page_id INTEGER REFERENCES catalog_pages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT,
    subtitle TEXT,
    description TEXT,
    price_label TEXT,
    image_url TEXT,
    items JSONB,
    theme TEXT,
    details JSONB,
    changed_by TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalog_page_history_page ON catalog_page_history(catalog_page_id);

-- 4. Track last edit timestamp on definitions
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
