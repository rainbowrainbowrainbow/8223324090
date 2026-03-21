-- v33.5: Warehouse pinata materials & designs
ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS linked_product_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS supplier VARCHAR(100);

CREATE TABLE IF NOT EXISTS pinata_designs (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    prints_qty  INTEGER DEFAULT 0,
    image_url   TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pinata_designs_active ON pinata_designs(is_active);

-- Seed pinata stock items
INSERT INTO warehouse_stock (name, category, quantity, min_quantity, unit, linked_product_type, is_active, notes)
VALUES
    ('Основи піньят', 'pinata', 0, 5, 'шт', 'pinata_filler', true, 'Основа для виготовлення піньяти'),
    ('Гофробумага', 'pinata', 0, 5, 'рулон', 'pinata_filler', true, '1 рулон ≈ 1 піньята')
ON CONFLICT DO NOTHING;
