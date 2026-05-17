-- MIGRATION_KIND: mixed
-- SAFETY: Additive warehouse/procurement schema expansion with idempotent seeds and backfills only.
-- ROLLBACK: Drop newly added indexes/tables/columns manually if rollback is required; seeded locations are idempotent operational reference data.

-- v0.55.11: Warehouse multi-location + procurement + contractors system

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO warehouse_locations (slug, name, description, sort_order)
VALUES
    ('animators_room', 'Аніматорська', 'Основний склад реквізиту та піньят', 10),
    ('office', 'Офіс', 'Адміністративні та офісні залишки', 20),
    ('behind_curtain', 'За шторкою', 'Локальне зберігання декору/реквізиту', 30),
    ('under_tubing', 'Під тюбінгом', 'Склад під тюбінговою зоною', 40),
    ('under_small_trampolines', 'Під маленькими батутами', 'Нижня складська точка біля батутів', 50),
    ('new_year', 'Новорічний склад', 'Сезонний склад новорічного декору', 60)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS contractors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    specialty JSONB DEFAULT '[]'::jsonb,
    telegram_chat_id BIGINT,
    telegram_username VARCHAR(100),
    invite_token VARCHAR(50) UNIQUE,
    phone VARCHAR(40),
    notes TEXT,
    category VARCHAR(80) DEFAULT 'general',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE contractors
    ADD COLUMN IF NOT EXISTS preferred_channel VARCHAR(30) DEFAULT 'phone',
    ADD COLUMN IF NOT EXISTS first_message_template TEXT,
    ADD COLUMN IF NOT EXISTS repeat_order_template TEXT,
    ADD COLUMN IF NOT EXISTS intro_context TEXT,
    ADD COLUMN IF NOT EXISTS ordering_notes TEXT,
    ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_preferred BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS reliability_score NUMERIC(4,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_ordered_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_order_price NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS last_order_item_summary TEXT,
    ADD COLUMN IF NOT EXISTS price_note TEXT,
    ADD COLUMN IF NOT EXISTS lead_time_days INTEGER,
    ADD COLUMN IF NOT EXISTS minimum_order_note TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS preferred_contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS purchase_unit_price NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sku VARCHAR(80),
    ADD COLUMN IF NOT EXISTS is_procured_externally BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

ALTER TABLE procurement_lists
    ADD COLUMN IF NOT EXISTS target_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source VARCHAR(40) DEFAULT 'manual';

ALTER TABLE procurement_items
    ADD COLUMN IF NOT EXISTS warehouse_stock_id INTEGER REFERENCES warehouse_stock(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS note TEXT,
    ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(40) DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_price NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMP;

UPDATE procurement_items
SET warehouse_stock_id = stock_id
WHERE warehouse_stock_id IS NULL
  AND stock_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse_stock_movements (
    id SERIAL PRIMARY KEY,
    warehouse_stock_id INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    movement_type VARCHAR(30) NOT NULL,
    from_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    to_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    quantity NUMERIC(12,2) NOT NULL,
    reason TEXT,
    related_procurement_item_id INTEGER REFERENCES procurement_items(id) ON DELETE SET NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contractor_stock_links (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    warehouse_stock_id INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    contractor_sku VARCHAR(120),
    last_price NUMERIC(12,2),
    lead_time_days INTEGER,
    minimum_order_qty NUMERIC(12,2),
    is_primary BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (contractor_id, warehouse_stock_id)
);

UPDATE warehouse_stock ws
SET location_id = wl.id,
    category = 'pinata',
    is_procured_externally = true,
    updated_at = NOW()
FROM warehouse_locations wl
WHERE wl.slug = 'animators_room'
  AND ws.linked_product_type = 'pinata_filler';

UPDATE warehouse_stock ws
SET location_id = wl.id,
    updated_at = NOW()
FROM warehouse_locations wl
WHERE wl.slug = 'office'
  AND ws.location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_locations_active_sort ON warehouse_locations(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_location ON warehouse_stock(location_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_contractor ON warehouse_stock(preferred_contractor_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_sku ON warehouse_stock(sku);
CREATE INDEX IF NOT EXISTS idx_procurement_lists_location ON procurement_lists(target_location_id);
CREATE INDEX IF NOT EXISTS idx_procurement_lists_contractor ON procurement_lists(contractor_id);
CREATE INDEX IF NOT EXISTS idx_procurement_items_warehouse_stock ON procurement_items(warehouse_stock_id);
CREATE INDEX IF NOT EXISTS idx_procurement_items_contractor ON procurement_items(contractor_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_movements_stock ON warehouse_stock_movements(warehouse_stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_movements_to_location ON warehouse_stock_movements(to_location_id);
CREATE INDEX IF NOT EXISTS idx_contractor_stock_links_stock ON contractor_stock_links(warehouse_stock_id);
