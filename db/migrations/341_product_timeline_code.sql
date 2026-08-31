-- MIGRATION_KIND: mixed
-- SAFETY: Adds one bounded presentation field to products, backfills every existing row deterministically, and fails closed if an active business/domain collision remains before the unique index is created. No booking, customer, payment, or authentication data is changed.
-- DATA_SCOPE: All products receive a 2-6 character timeline code. Canonical EventGenix programs receive reviewed codes; remaining catalog rows derive a stable code from existing product metadata, with deterministic suffixes only for active collisions.
-- ROLLBACK: Remove idx_products_active_timeline_code_v341 and products_timeline_code_shape_v341, then drop products.timeline_code only after the product API and timeline renderer no longer read it. The previous code/label/name fields remain unchanged throughout.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS timeline_code VARCHAR(6);

UPDATE products
SET timeline_code = CASE id
    WHEN 'kv1' THEN 'КВ 1'
    WHEN 'kv4' THEN 'КВ 4'
    WHEN 'kv5' THEN 'КВ 5'
    WHEN 'kv6' THEN 'КВ 6'
    WHEN 'kv7' THEN 'КВ 7'
    WHEN 'kv8' THEN 'КВ 8'
    WHEN 'kv9' THEN 'КВ 9'
    WHEN 'kv10' THEN 'КВ 10'
    WHEN 'kv11' THEN 'КВ 11'
    WHEN 'anim60' THEN 'АН 60'
    WHEN 'anim120' THEN 'АН120'
    WHEN 'bubble' THEN 'Бульб'
    WHEN 'neon_bubble' THEN 'Неон'
    WHEN 'paper' THEN 'Папір'
    WHEN 'dry_ice' THEN 'Лід'
    WHEN 'football' THEN 'Футб'
    WHEN 'mafia' THEN 'Мафія'
    WHEN 'photo60' THEN 'Фото'
    WHEN 'photo_magnets' THEN 'Фото+'
    WHEN 'photo_magnet_extra' THEN 'Магн'
    WHEN 'video' THEN 'Відео'
    WHEN 'mk_candy' THEN 'МКЦ'
    WHEN 'mk_thermomosaic' THEN 'МКТ'
    WHEN 'mk_slime' THEN 'МКС'
    WHEN 'mk_tshirt' THEN 'МКФ'
    WHEN 'mk_cookie' THEN 'МКП'
    WHEN 'mk_ecobag' THEN 'МКЕ'
    WHEN 'mk_pizza_classic' THEN 'МКПК'
    WHEN 'mk_pizza_custom' THEN 'МКП+'
    WHEN 'mk_cakepops' THEN 'МККП'
    WHEN 'mk_cupcake' THEN 'МККА'
    WHEN 'mk_soap' THEN 'МКМ'
    WHEN 'pinata' THEN 'ПІН'
    WHEN 'pinata_custom' THEN 'П PRO'
    WHEN 'custom' THEN 'Інше'
    ELSE timeline_code
END
WHERE COALESCE(business_context, 'event_genix') = 'event_genix'
  AND (timeline_code IS NULL OR BTRIM(timeline_code) = '')
  AND id IN (
    'kv1', 'kv4', 'kv5', 'kv6', 'kv7', 'kv8', 'kv9', 'kv10', 'kv11',
    'anim60', 'anim120', 'bubble', 'neon_bubble', 'paper', 'dry_ice', 'football', 'mafia',
    'photo60', 'photo_magnets', 'photo_magnet_extra', 'video',
    'mk_candy', 'mk_thermomosaic', 'mk_slime', 'mk_tshirt', 'mk_cookie', 'mk_ecobag',
    'mk_pizza_classic', 'mk_pizza_custom', 'mk_cakepops', 'mk_cupcake', 'mk_soap',
    'pinata', 'pinata_custom', 'custom'
  );

WITH source_values AS (
    SELECT id,
           LEFT(
               REGEXP_REPLACE(
                   BTRIM(COALESCE(NULLIF(code, ''), NULLIF(label, ''), NULLIF(name, ''), id)),
                   E'[\\r\\n\\t]+',
                   '',
                   'g'
               ),
               6
           ) AS candidate
    FROM products
    WHERE timeline_code IS NULL OR BTRIM(timeline_code) = ''
)
UPDATE products p
SET timeline_code = CASE
    WHEN CHAR_LENGTH(BTRIM(s.candidate)) >= 2 THEN BTRIM(s.candidate)
    ELSE LEFT(COALESCE(NULLIF(BTRIM(s.candidate), ''), 'X') || 'X', 2)
END
FROM source_values s
WHERE p.id = s.id;

DO $$
DECLARE
    collision RECORD;
    suffix_counter INTEGER;
    replacement TEXT;
BEGIN
    FOR collision IN
        SELECT ranked.id,
               ranked.business_context,
               ranked.domain,
               ranked.timeline_code
        FROM (
            SELECT id,
                   COALESCE(business_context, 'event_genix') AS business_context,
                   COALESCE(domain, 'program') AS domain,
                   timeline_code,
                   ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(business_context, 'event_genix'), COALESCE(domain, 'program'), LOWER(BTRIM(timeline_code))
                       ORDER BY id
                   ) AS duplicate_rank
            FROM products
            WHERE COALESCE(is_active, TRUE) = TRUE
        ) ranked
        WHERE ranked.duplicate_rank > 1
        ORDER BY ranked.business_context, ranked.domain, LOWER(BTRIM(ranked.timeline_code)), ranked.id
    LOOP
        suffix_counter := 2;
        LOOP
            replacement := LEFT(BTRIM(collision.timeline_code), 2) || LPAD(suffix_counter::text, 4, '0');
            EXIT WHEN NOT EXISTS (
                SELECT 1
                FROM products candidate
                WHERE candidate.id <> collision.id
                  AND COALESCE(candidate.business_context, 'event_genix') = collision.business_context
                  AND COALESCE(candidate.domain, 'program') = collision.domain
                  AND COALESCE(candidate.is_active, TRUE) = TRUE
                  AND LOWER(BTRIM(candidate.timeline_code)) = LOWER(replacement)
            );
            suffix_counter := suffix_counter + 1;
            IF suffix_counter > 9999 THEN
                RAISE EXCEPTION 'migration 341: timeline_code suffix space exhausted for product %', collision.id;
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
           OR CHAR_LENGTH(BTRIM(timeline_code)) < 2
           OR CHAR_LENGTH(BTRIM(timeline_code)) > 6
           OR timeline_code ~ E'[\\r\\n]'
    ) THEN
        RAISE EXCEPTION 'migration 341: invalid product timeline_code backfill';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM products
        WHERE COALESCE(is_active, TRUE) = TRUE
        GROUP BY COALESCE(business_context, 'event_genix'), COALESCE(domain, 'program'), LOWER(BTRIM(timeline_code))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'migration 341: active product timeline_code collision remains';
    END IF;
END $$;

ALTER TABLE products
    ALTER COLUMN timeline_code SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_timeline_code_shape_v341'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_timeline_code_shape_v341
            CHECK (
                CHAR_LENGTH(BTRIM(timeline_code)) BETWEEN 2 AND 6
                AND timeline_code = BTRIM(timeline_code)
                AND timeline_code !~ E'[\\r\\n]'
                AND timeline_code !~* E'[0-9]+[[:space:]]*(хв\\.?|min)'
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_active_timeline_code_v341
    ON products (
        COALESCE(business_context, 'event_genix'),
        COALESCE(domain, 'program'),
        LOWER(BTRIM(timeline_code))
    )
    WHERE COALESCE(is_active, TRUE) = TRUE;

COMMENT ON COLUMN products.timeline_code IS
    'Required 2-6 character operator-managed code used for compact timeline cards.';
