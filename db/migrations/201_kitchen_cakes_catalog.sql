-- MIGRATION_KIND: seed
-- SAFETY: Idempotent curated Kitchen/Cakes catalog seed. Rows are matched by stable ids or existing kitchen cake names, then upserted without deleting data.
-- ROLLBACK: Deactivate or delete products with updated_by='migration_201_kitchen_cakes_catalog' and linked price_rules after exporting any operator edits.
-- DATA_SCOPE: Products / Kitchen / Cakes curated catalog supplied by Kleshnya on 2026-05-21; 18 active cake rows ordered 1..18.

CREATE TEMP TABLE tmp_kitchen_cake_catalog (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    price INTEGER NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_kitchen_cake_catalog (id, code, name, price, description, sort_order) VALUES
('cake_tri_shokolady', 'CAKE-01', 'Три шоколади', 110, 'Три шари ніжного мусу на основі бельгійського шоколаду. Легкий, повітряний, делікатний смак із мʼякою шоколадною гармонією.', 1),
('cake_nutella', 'CAKE-02', 'Нутелла', 90, 'Тонкі шоколадно-медові коржі із заварним кремом. Насичений, затишний і дуже ніжний смак з характером Нутелли.', 2),
('cake_syrno_yohurtovyi', 'CAKE-03', 'Сирно-йогуртовий', 95, 'Легкий бісквіт, ніжна сирно-йогуртова начинка і вишня з приємною кислинкою. Свіжий і легкий торт, який дуже люблять діти.', 3),
('cake_forenuar', 'CAKE-04', 'Форенуар', 115, 'Шоколадний бісквіт, повітряний мус і соковита вишня. Насичений, елегантний і добре збалансований смак.', 4),
('cake_praha', 'CAKE-05', 'Прага', 140, 'Шоколадні коржі з ніжним кремом і легкою абрикосовою ноткою. Класика з глибоким шоколадним смаком.', 5),
('cake_snikers', 'CAKE-06', 'Снікерс', 110, 'Шоколадні коржі, вершковий крем-чіз, солона карамель і обсмажені горіхи. Яскравий, насичений і впізнаваний смак.', 6),
('cake_medovyk', 'CAKE-07', 'Медовик', 80, 'Запашні медові коржі зі сметанковим кремом. Мʼякий, затишний і домашній варіант.', 7),
('cake_esterhazi', 'CAKE-08', 'Естерхазі', 140, 'Меренгово-горіхові коржі з ніжним кремом. Благородний, вишуканий торт для особливих моментів.', 8),
('cake_smarahdovyi', 'CAKE-09', 'Смарагдовий', 110, 'Зелений бісквіт на основі шпинату, цитрусова мʼятна нотка і делікатний чізкейк. Натуральний, легкий і дуже оригінальний смак.', 9),
('cake_khreshchatyi_yar', 'CAKE-10', 'Хрещатий яр', 120, 'Шоколадні коржі поєднані з хрусткими горіховими. Насичений, шляхетний і багатошаровий смак.', 10),
('cake_napoleon', 'CAKE-11', 'Наполеон', 90, 'Тонкі листкові коржі з ніжним кремом. Легка хрусткість і знайомий смак дитинства.', 11),
('cake_horikhovo_makovyi', 'CAKE-12', 'Горіхово-маковий', 110, 'Поєднання горіхів, маку, мʼяких коржів і ніжного масляного крему. Теплий, домашній і святковий смак.', 12),
('cake_mandarynovyi', 'CAKE-13', 'Мандариновий', 110, 'Ніжний бісквіт, легкий мус і мандариново-хурмове компоте з маком. Свіжий, делікатний і цитрусовий.', 13),
('cake_chornychno_musovyi', 'CAKE-14', 'Чорнично-мусовий', 125, 'Повітряний чорничний мус, чизкейк і тонкий бісквіт. Ягідний, ніжний і вишуканий.', 14),
('cake_oreo', 'CAKE-15', 'Орео', 100, 'Шоколадні коржі, крем-чіз і шматочки печива Oreo. Ніжний торт із приємною хрумкою ноткою.', 15),
('cake_chervonyi_oksamyt', 'CAKE-16', 'Червоний оксамит', 115, 'Мʼякі червоні коржі та вершковий крем-чіз. Ніжна текстура і делікатний смак, у який легко закохатись.', 16),
('cake_lisova_kazka', 'CAKE-17', 'Лісова казка', 105, 'Шаровий зріз із природними кольорами коржів, ароматом халви й горіхами. Дуже ефектний і незвичний торт.', 17),
('cake_baunti', 'CAKE-18', 'Баунті', 100, 'Шоколадний бісквіт і соковита кокосова прошарка. Ніжний тропічний смак із мʼякою текстурою.', 18);

UPDATE products p
SET code = c.code,
    label = c.name,
    name = c.name,
    icon = '🎂',
    category = 'cake',
    duration = 0,
    price = c.price,
    hosts = 0,
    age_range = NULL,
    kids_capacity = NULL,
    description = c.description,
    domain = 'kitchen',
    kitchen_type = 'cake',
    short_description = c.description,
    promo_description = COALESCE(NULLIF(p.promo_description, ''), NULL),
    ingredients = COALESCE(NULLIF(p.ingredients, ''), NULL),
    tech_card = COALESCE(NULLIF(p.tech_card, ''), NULL),
    menu_section = NULL,
    serving_unit = '100г',
    weight_value = NULL,
    price_variant_note = NULL,
    availability_status = 'active',
    cake_decoration = COALESCE(NULLIF(p.cake_decoration, ''), NULL),
    is_per_child = false,
    has_filler = false,
    is_custom = false,
    is_active = true,
    sort_order = c.sort_order,
    updated_at = NOW(),
    updated_by = 'migration_201_kitchen_cakes_catalog'
FROM tmp_kitchen_cake_catalog c
WHERE p.id <> c.id
  AND COALESCE(p.domain, 'program') = 'kitchen'
  AND p.kitchen_type = 'cake'
  AND lower(trim(p.name)) = lower(trim(c.name));

INSERT INTO products (
    id, code, label, name, icon, category, duration, price, hosts,
    age_range, kids_capacity, description, domain, kitchen_type,
    short_description, promo_description, ingredients, tech_card,
    menu_section, serving_unit, weight_value, price_variant_note,
    availability_status, cake_decoration, is_per_child, has_filler,
    is_custom, is_active, sort_order, updated_by
)
SELECT
    c.id, c.code, c.name, c.name, '🎂', 'cake', 0, c.price, 0,
    NULL, NULL, c.description, 'kitchen', 'cake',
    c.description, NULL, NULL, NULL,
    NULL, '100г', NULL, NULL,
    'active', NULL, false, false,
    false, true, c.sort_order, 'migration_201_kitchen_cakes_catalog'
FROM tmp_kitchen_cake_catalog c
WHERE NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.id <> c.id
      AND COALESCE(p.domain, 'program') = 'kitchen'
      AND p.kitchen_type = 'cake'
      AND lower(trim(p.name)) = lower(trim(c.name))
)
ON CONFLICT (id) DO UPDATE SET
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
    tech_card = COALESCE(NULLIF(products.tech_card, ''), EXCLUDED.tech_card),
    menu_section = EXCLUDED.menu_section,
    serving_unit = EXCLUDED.serving_unit,
    weight_value = EXCLUDED.weight_value,
    price_variant_note = EXCLUDED.price_variant_note,
    availability_status = EXCLUDED.availability_status,
    cake_decoration = COALESCE(NULLIF(products.cake_decoration, ''), EXCLUDED.cake_decoration),
    is_per_child = EXCLUDED.is_per_child,
    has_filler = EXCLUDED.has_filler,
    is_custom = EXCLUDED.is_custom,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by;

WITH cake_targets AS (
    SELECT DISTINCT ON (c.id)
        c.*,
        p.id AS product_id
    FROM tmp_kitchen_cake_catalog c
    JOIN products p
      ON p.id = c.id
      OR (
        COALESCE(p.domain, 'program') = 'kitchen'
        AND p.kitchen_type = 'cake'
        AND lower(trim(p.name)) = lower(trim(c.name))
      )
    ORDER BY c.id, (p.id = c.id) DESC
),
cake_price_rules AS (
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
        'грн/100г' AS unit,
        'cake' AS category,
        'Центральна ціна для ' || name || ' у каталозі тортів' AS description
    FROM cake_targets
)
INSERT INTO price_rules (code, name, value, unit, category, description, product_id, updated_by)
SELECT code, name, value, unit, category, description, product_id, 'migration_201_kitchen_cakes_catalog'
FROM cake_price_rules
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
