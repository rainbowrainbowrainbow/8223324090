-- v42.2: Business Card Categories
CREATE TABLE IF NOT EXISTS business_card_categories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

INSERT INTO business_card_categories (slug, title, sort_order) VALUES
    ('general', 'Загальне', 0),
    ('service', 'Послуги', 1),
    ('event', 'Події', 2),
    ('product', 'Товари', 3)
ON CONFLICT (slug) DO NOTHING;
