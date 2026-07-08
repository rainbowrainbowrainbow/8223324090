-- MIGRATION_KIND: seed
-- SAFETY: Idempotent Kitchen/Menu cake decoration seed. Rows are matched by stable ids or existing Event Genix kitchen menu names, then upserted without deleting data.
-- ROLLBACK: Deactivate or delete products with updated_by='migration_283_kitchen_cake_decorations_catalog' and linked price_rules after exporting any operator edits.
-- DATA_SCOPE: Products / Kitchen / Menu / Cake decorations supplied by operator request on 2026-07-08; 5 active rows ordered 1..5.

CREATE TEMP TABLE tmp_kitchen_cake_decorations_catalog (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    menu_section VARCHAR(120) NOT NULL,
    icon TEXT NOT NULL,
    price INTEGER NOT NULL,
    serving_unit VARCHAR(60) NOT NULL,
    price_variant_note TEXT,
    description TEXT NOT NULL,
    tech_card TEXT NOT NULL,
    sort_order INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_kitchen_cake_decorations_catalog (
    id, code, name, menu_section, icon, price, serving_unit,
    price_variant_note, description, tech_card, sort_order
) VALUES
('cake_decor_sweets', 'CAKEDECOR-001', 'Солодощі', 'Оформлення торта', '🍬', 250, 'додаток', NULL, 'Солодке оформлення торта для дитячого свята.', 'Source: operator request 2026-07-08; Cake decoration: sweets; Price: 250 грн', 1),
('cake_decor_berries', 'CAKEDECOR-002', 'Ягідне оформлення', 'Оформлення торта', '🍓', 500, 'додаток', NULL, 'Ягідне оформлення торта для святкового вигляду.', 'Source: operator request 2026-07-08; Cake decoration: berries; Price: 500 грн', 2),
('cake_decor_rice_picture', 'CAKEDECOR-003', 'Рисова картинка', 'Оформлення торта', '🖼️', 150, 'додаток', 'Будь-яка тематика', 'Рисова картинка на торт у будь-якій тематиці.', 'Source: operator request 2026-07-08; Cake decoration: rice picture; Price: 150 грн; Any theme', 3),
('cake_decor_cream_inscription', 'CAKEDECOR-004', 'Крем + напис', 'Оформлення торта', '🍰', 0, 'додаток', 'Безкоштовно', 'Кремове оформлення з написом без доплати.', 'Source: operator request 2026-07-08; Cake decoration: cream and inscription; Price: free', 4),
('cake_decor_custom', 'CAKEDECOR-005', 'Індивідуальне оформлення', 'Оформлення торта', '🌟', 0, 'додаток', 'Прораховується окремо', 'Індивідуальне тематичне оформлення торта; фінальну ціну підтверджує оператор.', 'Source: operator request 2026-07-08; Cake decoration: custom; Price: calculated separately', 5);

UPDATE products p
SET business_context = 'event_genix',
    code = c.code,
    label = c.name,
    name = c.name,
    icon = c.icon,
    category = 'menu',
    duration = 0,
    price = c.price,
    hosts = 0,
    age_range = NULL,
    kids_capacity = NULL,
    description = c.description,
    domain = 'kitchen',
    kitchen_type = 'menu',
    short_description = c.description,
    promo_description = COALESCE(NULLIF(p.promo_description, ''), NULL),
    ingredients = COALESCE(NULLIF(p.ingredients, ''), NULL),
    tech_card = c.tech_card,
    menu_section = c.menu_section,
    serving_unit = c.serving_unit,
    weight_value = NULL,
    price_variant_note = c.price_variant_note,
    availability_status = 'active',
    cake_decoration = NULL,
    is_per_child = false,
    has_filler = false,
    is_custom = false,
    is_active = true,
    sort_order = c.sort_order,
    updated_at = NOW(),
    updated_by = 'migration_283_kitchen_cake_decorations_catalog'
FROM tmp_kitchen_cake_decorations_catalog c
WHERE p.id <> c.id
  AND COALESCE(p.business_context, 'event_genix') = 'event_genix'
  AND COALESCE(p.domain, 'program') = 'kitchen'
  AND p.kitchen_type = 'menu'
  AND lower(trim(p.name)) = lower(trim(c.name));

INSERT INTO products (
    id, business_context, code, label, name, icon, category, duration, price, hosts,
    age_range, kids_capacity, description, domain, kitchen_type,
    short_description, promo_description, ingredients, tech_card,
    menu_section, serving_unit, weight_value, price_variant_note,
    availability_status, cake_decoration, is_per_child, has_filler,
    is_custom, is_active, sort_order, updated_by
)
SELECT
    c.id, 'event_genix', c.code, c.name, c.name, c.icon, 'menu', 0, c.price, 0,
    NULL, NULL, c.description, 'kitchen', 'menu',
    c.description, NULL, NULL, c.tech_card,
    c.menu_section, c.serving_unit, NULL, c.price_variant_note,
    'active', NULL, false, false,
    false, true, c.sort_order, 'migration_283_kitchen_cake_decorations_catalog'
FROM tmp_kitchen_cake_decorations_catalog c
WHERE NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.id <> c.id
      AND COALESCE(p.business_context, 'event_genix') = 'event_genix'
      AND COALESCE(p.domain, 'program') = 'kitchen'
      AND p.kitchen_type = 'menu'
      AND lower(trim(p.name)) = lower(trim(c.name))
)
ON CONFLICT (id) DO UPDATE SET
    business_context = EXCLUDED.business_context,
    code = EXCLUDED.code,
    label = EXCLUDED.label,
    name = EXCLUDED.name,
    icon = EXCLUDED.icon,
    category = EXCLUDED.category,
    duration = EXCLUDED.duration,
    price = EXCLUDED.price,
    hosts = EXCLUDED.hosts,
    age_range = EXCLUDED.age_range,
    kids_capacity = EXCLUDED.kids_capacity,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    kitchen_type = EXCLUDED.kitchen_type,
    short_description = EXCLUDED.short_description,
    promo_description = COALESCE(NULLIF(products.promo_description, ''), EXCLUDED.promo_description),
    ingredients = COALESCE(NULLIF(products.ingredients, ''), EXCLUDED.ingredients),
    tech_card = EXCLUDED.tech_card,
    menu_section = EXCLUDED.menu_section,
    serving_unit = EXCLUDED.serving_unit,
    weight_value = EXCLUDED.weight_value,
    price_variant_note = EXCLUDED.price_variant_note,
    availability_status = EXCLUDED.availability_status,
    cake_decoration = EXCLUDED.cake_decoration,
    is_per_child = EXCLUDED.is_per_child,
    has_filler = EXCLUDED.has_filler,
    is_custom = EXCLUDED.is_custom,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by;

WITH decoration_targets AS (
    SELECT DISTINCT ON (c.id)
        c.*,
        p.id AS product_id
    FROM tmp_kitchen_cake_decorations_catalog c
    JOIN products p
      ON p.id = c.id
      OR (
        COALESCE(p.business_context, 'event_genix') = 'event_genix'
        AND COALESCE(p.domain, 'program') = 'kitchen'
        AND p.kitchen_type = 'menu'
        AND lower(trim(p.name)) = lower(trim(c.name))
      )
    ORDER BY c.id, (p.id = c.id) DESC
),
decoration_price_rules AS (
    SELECT
        product_id,
        ('prod_' ||
            left(
                COALESCE(NULLIF(regexp_replace(lower(product_id), '[^a-z0-9]+', '_', 'g'), ''), 'item'),
                36
            ) ||
            '_' ||
            substr(md5(product_id), 1, 8)
        ) AS code,
        name,
        price AS value,
        'грн/' || serving_unit AS unit,
        'menu' AS category,
        'Центральна ціна для оформлення торта: ' || name AS description
    FROM decoration_targets
)
INSERT INTO price_rules (code, name, value, unit, category, description, product_id, updated_by)
SELECT code, name, value, unit, category, description, product_id, 'migration_283_kitchen_cake_decorations_catalog'
FROM decoration_price_rules
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    value = EXCLUDED.value,
    unit = EXCLUDED.unit,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    product_id = CASE
        WHEN price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id THEN EXCLUDED.product_id
        ELSE price_rules.product_id
    END,
    updated_at = NOW(),
    updated_by = CASE
        WHEN price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id THEN EXCLUDED.updated_by
        ELSE price_rules.updated_by
    END
WHERE price_rules.product_id IS NULL OR price_rules.product_id = EXCLUDED.product_id;
