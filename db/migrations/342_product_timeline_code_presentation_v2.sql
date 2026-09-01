-- MIGRATION_KIND: data-fix
-- SAFETY: Reinterprets existing products.timeline_code as a category-local product code only. It updates product catalog presentation codes and the supporting constraint/index, but does not change bookings, customers, payments, auth, or production secrets. Collision handling is deterministic and fails closed if invalid values remain.
-- OPERATOR_APPROVAL: required
-- DATA_SCOPE: All products with products.timeline_code. Canonical EventGenix product ids receive reviewed product-only codes; noncanonical rows have known category prefixes stripped and are de-duplicated within business_context/domain/category.
-- ROLLBACK: Restore global v341 semantics by dropping idx_products_active_timeline_code_v342 and products_timeline_code_shape_v342, setting canonical EventGenix ids back to the v341 mapping (kv1='КВ 1', kv4='КВ 4', kv5='КВ 5', kv6='КВ 6', kv7='КВ 7', kv8='КВ 8', kv9='КВ 9', kv10='КВ 10', kv11='КВ 11', anim60='АН 60', anim120='АН120', bubble='Бульб', neon_bubble='Неон', paper='Папір', dry_ice='Лід', football='Футб', mafia='Мафія', photo60='Фото', photo_magnets='Фото+', photo_magnet_extra='Магн', video='Відео', mk_candy='МКЦ', mk_thermomosaic='МКТ', mk_slime='МКС', mk_tshirt='МКФ', mk_cookie='МКП', mk_ecobag='МКЕ', mk_pizza_classic='МКПК', mk_pizza_custom='МКП+', mk_cakepops='МККП', mk_cupcake='МККА', mk_soap='МКМ', pinata='ПІН', pinata_custom='П PRO', custom='Інше'), then recreating products_timeline_code_shape_v341 and idx_products_active_timeline_code_v341 if the application code has also been rolled back.

DROP INDEX IF EXISTS idx_products_active_timeline_code_v341;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_timeline_code_shape_v341;

UPDATE products
SET timeline_code = CASE id
    WHEN 'kv1' THEN '1'
    WHEN 'kv4' THEN '4'
    WHEN 'kv5' THEN '5'
    WHEN 'kv6' THEN '6'
    WHEN 'kv7' THEN '7'
    WHEN 'kv8' THEN '8'
    WHEN 'kv9' THEN '9'
    WHEN 'kv10' THEN '10'
    WHEN 'kv11' THEN '11'
    WHEN 'anim60' THEN '60'
    WHEN 'anim120' THEN '120'
    WHEN 'bubble' THEN 'Бул'
    WHEN 'neon_bubble' THEN 'Нео'
    WHEN 'paper' THEN 'Пап'
    WHEN 'dry_ice' THEN 'Лід'
    WHEN 'football' THEN 'Фут'
    WHEN 'mafia' THEN 'Маф'
    WHEN 'photo60' THEN '60'
    WHEN 'photo_magnets' THEN 'Маг'
    WHEN 'photo_magnet_extra' THEN 'ДМ'
    WHEN 'video' THEN 'Від'
    WHEN 'mk_candy' THEN 'ЦУК'
    WHEN 'mk_thermomosaic' THEN 'ТЕР'
    WHEN 'mk_slime' THEN 'СЛМ'
    WHEN 'mk_tshirt' THEN 'РФУ'
    WHEN 'mk_cookie' THEN 'РПР'
    WHEN 'mk_ecobag' THEN 'РЕС'
    WHEN 'mk_pizza_classic' THEN 'КПЦ'
    WHEN 'mk_pizza_custom' THEN 'КП+'
    WHEN 'mk_cakepops' THEN 'КЕЙ'
    WHEN 'mk_cupcake' THEN 'КАП'
    WHEN 'mk_soap' THEN 'МИЛ'
    WHEN 'pinata' THEN 'STD'
    WHEN 'pinata_custom' THEN 'PRO'
    WHEN 'custom' THEN 'ІН'
    ELSE timeline_code
END
WHERE COALESCE(business_context, 'event_genix') = 'event_genix'
  AND id IN (
    'kv1', 'kv4', 'kv5', 'kv6', 'kv7', 'kv8', 'kv9', 'kv10', 'kv11',
    'anim60', 'anim120', 'bubble', 'neon_bubble', 'paper', 'dry_ice', 'football', 'mafia',
    'photo60', 'photo_magnets', 'photo_magnet_extra', 'video',
    'mk_candy', 'mk_thermomosaic', 'mk_slime', 'mk_tshirt', 'mk_cookie', 'mk_ecobag',
    'mk_pizza_classic', 'mk_pizza_custom', 'mk_cakepops', 'mk_cupcake', 'mk_soap',
    'pinata', 'pinata_custom', 'custom'
  );

UPDATE products
SET timeline_code = BTRIM(REGEXP_REPLACE(timeline_code, '^(КВ|АН|ШОУ|МК|ФОТО|П|ІНШ)[[:space:]-]+', '', 'i'))
WHERE timeline_code IS NOT NULL
  AND timeline_code ~* '^(КВ|АН|ШОУ|МК|ФОТО|П|ІНШ)[[:space:]-]+';

UPDATE products
SET timeline_code = BTRIM(REGEXP_REPLACE(timeline_code, '^КВ[[:space:]]*([0-9]+)$', '\1', 'i'))
WHERE timeline_code IS NOT NULL
  AND timeline_code ~* '^КВ[[:space:]]*[0-9]+$';

UPDATE products
SET timeline_code = BTRIM(REGEXP_REPLACE(timeline_code, '^МК(.+)$', '\1', 'i'))
WHERE timeline_code IS NOT NULL
  AND LOWER(BTRIM(category)) = 'masterclass'
  AND timeline_code ~* '^МК[^[:space:]-].+';

UPDATE products
SET timeline_code = LEFT(
        BTRIM(COALESCE(NULLIF(timeline_code, ''), NULLIF(code, ''), NULLIF(label, ''), NULLIF(name, ''), id)) || 'X',
        6
    )
WHERE timeline_code IS NULL OR BTRIM(timeline_code) = '';

DO $$
DECLARE
    collision RECORD;
    suffix_counter INTEGER;
    base_code TEXT;
    replacement TEXT;
BEGIN
    FOR collision IN
        SELECT ranked.id,
               ranked.business_context,
               ranked.domain,
               ranked.category,
               ranked.timeline_code
        FROM (
            SELECT id,
                   COALESCE(business_context, 'event_genix') AS business_context,
                   COALESCE(domain, 'program') AS domain,
                   LOWER(BTRIM(category)) AS category,
                   BTRIM(timeline_code) AS timeline_code,
                   ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(business_context, 'event_genix'), COALESCE(domain, 'program'), LOWER(BTRIM(category)), LOWER(BTRIM(timeline_code))
                       ORDER BY id
                   ) AS duplicate_rank
            FROM products
            WHERE COALESCE(is_active, TRUE) = TRUE
        ) ranked
        WHERE ranked.duplicate_rank > 1
        ORDER BY ranked.business_context, ranked.domain, ranked.category, LOWER(ranked.timeline_code), ranked.id
    LOOP
        suffix_counter := 2;
        base_code := LEFT(BTRIM(collision.timeline_code), 4);
        IF CHAR_LENGTH(base_code) < 1 THEN
            base_code := 'X';
        END IF;

        LOOP
            replacement := LEFT(base_code || suffix_counter::text, 6);
            EXIT WHEN NOT EXISTS (
                SELECT 1
                FROM products candidate
                WHERE candidate.id <> collision.id
                  AND COALESCE(candidate.business_context, 'event_genix') = collision.business_context
                  AND COALESCE(candidate.domain, 'program') = collision.domain
                  AND LOWER(BTRIM(candidate.category)) = collision.category
                  AND COALESCE(candidate.is_active, TRUE) = TRUE
                  AND LOWER(BTRIM(candidate.timeline_code)) = LOWER(replacement)
            );
            suffix_counter := suffix_counter + 1;
            IF suffix_counter > 9999 THEN
                RAISE EXCEPTION 'migration 342: timeline_code suffix space exhausted for product %', collision.id;
            END IF;
        END LOOP;

        UPDATE products
        SET timeline_code = replacement
        WHERE id = collision.id;
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM products
        WHERE timeline_code IS NULL
           OR CHAR_LENGTH(BTRIM(timeline_code)) < 1
           OR CHAR_LENGTH(BTRIM(timeline_code)) > 6
           OR timeline_code <> BTRIM(timeline_code)
           OR timeline_code ~ E'[\\r\\n]'
           OR timeline_code ~* E'[0-9]+[[:space:]]*(хв\\.?|min)'
    ) THEN
        RAISE EXCEPTION 'migration 342: invalid product timeline_code value remains';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM products
        WHERE COALESCE(is_active, TRUE) = TRUE
        GROUP BY COALESCE(business_context, 'event_genix'), COALESCE(domain, 'program'), LOWER(BTRIM(category)), LOWER(BTRIM(timeline_code))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'migration 342: active category-local product timeline_code collision remains';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_timeline_code_shape_v342'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_timeline_code_shape_v342
            CHECK (
                CHAR_LENGTH(BTRIM(timeline_code)) BETWEEN 1 AND 6
                AND timeline_code = BTRIM(timeline_code)
                AND timeline_code !~ E'[\\r\\n]'
                AND timeline_code !~* E'[0-9]+[[:space:]]*(хв\\.?|min)'
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_active_timeline_code_v342
    ON products (
        COALESCE(business_context, 'event_genix'),
        COALESCE(domain, 'program'),
        LOWER(BTRIM(category)),
        LOWER(BTRIM(timeline_code))
    )
    WHERE COALESCE(is_active, TRUE) = TRUE;

COMMENT ON COLUMN products.timeline_code IS
    'Required 1-6 character operator-managed product code used with category codes by timeline presentation resolver.';
