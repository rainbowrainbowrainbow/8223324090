-- Migration 135: Catalog enhancements — items grid, themes, layouts, public links
-- Part of: Каталоги — повний редизайн UI (Етап 1)

-- 1. Add items JSONB to catalog_pages (service grid like graduation)
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';

-- 2. Add color theme per page
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'gold';

-- 3. Add reference_url for Image2Image generation
ALTER TABLE catalog_pages ADD COLUMN IF NOT EXISTS reference_url TEXT;

-- 4. Add layout_style to catalog_definitions (default vs product)
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS layout_style TEXT DEFAULT 'default';

-- 5. Add public_token for shareable links without auth
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS public_token TEXT;

-- 6. Add cover_image_url for catalog card covers
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- 7. Add status (draft/ready) for catalog
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- 8. Add page count cache for performance
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 0;

-- 9. PDF download stats
ALTER TABLE catalog_definitions ADD COLUMN IF NOT EXISTS pdf_downloads INTEGER DEFAULT 0;

-- 10. Index on public_token for fast lookup
CREATE INDEX IF NOT EXISTS idx_catalog_definitions_public_token ON catalog_definitions(public_token) WHERE public_token IS NOT NULL;
