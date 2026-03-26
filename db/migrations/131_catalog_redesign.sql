-- v131: Catalog Redesign — new columns for pages, definitions, history, automations

-- catalog_definitions: layout style + public token + stats
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS layout_style TEXT DEFAULT 'default';
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS public_token TEXT;
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS pdf_downloads INTEGER DEFAULT 0;
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS last_pdf_download TIMESTAMPTZ;

-- catalog_pages: reference, items grid, theme, versioning
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS reference_url TEXT;
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'gold';
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS layout TEXT DEFAULT 'side-by-side';
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Page history for versioning / rollback
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
    changed_by TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_page_history_page ON catalog_page_history(catalog_page_id);

-- Catalog automations
CREATE TABLE IF NOT EXISTS catalog_automations (
    id SERIAL PRIMARY KEY,
    catalog_id VARCHAR(50) REFERENCES catalog_definitions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT DEFAULT 'manual' CHECK(trigger_type IN ('manual','on_publish','on_update')),
    assigned_role TEXT DEFAULT 'admin',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_automations_catalog ON catalog_automations(catalog_id);
