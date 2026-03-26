-- v38.12: Catalog pages — HTML pages with images for each catalog
-- Adds structured pages (cover + product pages) to existing catalog_definitions

CREATE TABLE IF NOT EXISTS catalog_pages (
    id SERIAL PRIMARY KEY,
    catalog_id VARCHAR(50) NOT NULL REFERENCES catalog_definitions(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    price INTEGER,
    price_label TEXT,
    image_url TEXT,
    background_url TEXT,
    details JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(catalog_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_catalog_pages_catalog ON catalog_pages(catalog_id, page_number);

-- Seed: Pinata catalog pages
INSERT INTO catalog_pages (catalog_id, page_number, title, subtitle, description, price, price_label, details) VALUES
    ('pinyata', 0, 'Каталог піньят', '🪅 Парк Закревського періоду', 'Оберіть ідеальну піньяту для вашого свята!', NULL, NULL, '{}'),
    ('pinyata', 1, 'Піньята', '🪅 Кругла піньята', 'Будь-яка кругла піньята з каталогу на ваш вибір. Наповнена цукерками та сюрпризами.', 700, 'від 700 ₴', '{"age":"2-99р","kids":"до 15","duration":"15 хв"}'),
    ('pinyata', 2, 'Піньята PRO', '🪅⭐ Унікальна форма', 'Унікальна форма з особливого розділу або піньята на індивідуальне замовлення.', 1000, 'від 1 000 ₴', '{"age":"2-99р","kids":"до 15","duration":"15 хв"}'),
    ('pinyata', 3, 'Власна піньята', '🪅🏠 Принесіть свою', 'Клієнт приносить свою піньяту. Ми тільки проводимо церемонію розбивання.', 300, 'від 300 ₴', '{"age":"2-99р","kids":"до 15","duration":"15 хв"}')
ON CONFLICT DO NOTHING;
