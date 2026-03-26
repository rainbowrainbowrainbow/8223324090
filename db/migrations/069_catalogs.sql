-- 069_catalogs.sql — Catalogs and catalog pages
-- v28.1.0: Catalog system for product catalogs (graduation, pinatas, cakes, etc.)

CREATE TABLE IF NOT EXISTS catalogs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255),
    description TEXT,
    cover_url TEXT,
    background_url TEXT,
    category VARCHAR(100) DEFAULT 'general',
    status VARCHAR(50) DEFAULT 'draft',
    sort_order INT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_by INT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_pages (
    id SERIAL PRIMARY KEY,
    catalog_id INT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
    page_number INT NOT NULL DEFAULT 1,
    title VARCHAR(255),
    subtitle VARCHAR(255),
    description TEXT,
    price_label VARCHAR(100),
    detail TEXT,
    image_url TEXT,
    background_url TEXT,
    product_id VARCHAR(100),
    layout VARCHAR(50) DEFAULT 'image-left',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(catalog_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_catalog_pages_catalog ON catalog_pages(catalog_id);
CREATE INDEX IF NOT EXISTS idx_catalogs_status ON catalogs(status);
