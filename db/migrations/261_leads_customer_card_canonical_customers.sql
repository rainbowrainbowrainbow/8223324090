-- MIGRATION_KIND: mixed
-- SAFETY: Idempotent CRM lead/customer data backfill. Existing customer_cards rows are preserved as archive/compat data; no rows are deleted. Additive legacy-compat columns are ensured before the data copy so older production schemas can safely retry this migration.
-- ROLLBACK: Restore customers.notes from backup if legacy card note blocks must be removed, then manually clear customers.lead_id/leads event fields that were populated by this migration.

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(40) DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS event_date DATE,
    ADD COLUMN IF NOT EXISTS children_count INTEGER,
    ADD COLUMN IF NOT EXISTS source_channel VARCHAR(50),
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    ADD COLUMN IF NOT EXISTS child_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS source VARCHAR(100),
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS social_identities JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS customer_cards (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    event_type VARCHAR(50),
    event_date DATE,
    guest_count INTEGER,
    children_count INTEGER,
    budget_approx INTEGER,
    how_found VARCHAR(100),
    email VARCHAR(100),
    channel VARCHAR(30),
    notes TEXT,
    business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE customer_cards
    ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS event_date DATE,
    ADD COLUMN IF NOT EXISTS guest_count INTEGER,
    ADD COLUMN IF NOT EXISTS children_count INTEGER,
    ADD COLUMN IF NOT EXISTS budget_approx INTEGER,
    ADD COLUMN IF NOT EXISTS how_found VARCHAR(100),
    ADD COLUMN IF NOT EXISTS email VARCHAR(100),
    ADD COLUMN IF NOT EXISTS channel VARCHAR(30),
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_customer_cards_lead ON customer_cards(lead_id);

UPDATE leads
SET status = CASE COALESCE(pipeline_stage, 'new')
        WHEN 'new' THEN 'new'
        WHEN 'contacted' THEN 'contact'
        WHEN 'info_sent' THEN 'contact'
        WHEN 'deal' THEN 'proposal'
        WHEN 'deposit_received' THEN 'booked'
        WHEN 'waiting' THEN 'booked'
        WHEN 'completed' THEN 'completed'
        WHEN 'closed' THEN 'completed'
        WHEN 'lost' THEN 'lost'
        ELSE COALESCE(status, 'new')
    END
WHERE COALESCE(status, '') IS DISTINCT FROM CASE COALESCE(pipeline_stage, 'new')
        WHEN 'new' THEN 'new'
        WHEN 'contacted' THEN 'contact'
        WHEN 'info_sent' THEN 'contact'
        WHEN 'deal' THEN 'proposal'
        WHEN 'deposit_received' THEN 'booked'
        WHEN 'waiting' THEN 'booked'
        WHEN 'completed' THEN 'completed'
        WHEN 'closed' THEN 'completed'
        WHEN 'lost' THEN 'lost'
        ELSE COALESCE(status, 'new')
    END;

WITH latest_cards AS (
    SELECT DISTINCT ON (COALESCE(cc.business_context, l.business_context, 'event_genix'), cc.lead_id)
        COALESCE(cc.business_context, l.business_context, 'event_genix') AS business_context,
        cc.lead_id,
        cc.event_date,
        cc.children_count
    FROM customer_cards cc
    JOIN leads l ON l.id = cc.lead_id
    WHERE cc.lead_id IS NOT NULL
    ORDER BY COALESCE(cc.business_context, l.business_context, 'event_genix'), cc.lead_id,
             cc.updated_at DESC NULLS LAST, cc.id DESC
)
UPDATE leads l
SET event_date = COALESCE(l.event_date, latest_cards.event_date),
    children_count = COALESCE(l.children_count, latest_cards.children_count),
    updated_at = NOW()
FROM latest_cards
WHERE l.id = latest_cards.lead_id
  AND COALESCE(l.business_context, 'event_genix') = latest_cards.business_context
  AND (
      (l.event_date IS NULL AND latest_cards.event_date IS NOT NULL)
      OR (l.children_count IS NULL AND latest_cards.children_count IS NOT NULL)
  );

WITH lead_cards AS (
    SELECT DISTINCT ON (COALESCE(cc.business_context, l.business_context, 'event_genix'), l.id)
        COALESCE(cc.business_context, l.business_context, 'event_genix') AS business_context,
        l.id,
        l.client_name,
        l.phone,
        l.instagram,
        l.source,
        l.source_channel,
        l.notes,
        regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') AS phone_digits,
        lower(regexp_replace(COALESCE(l.instagram, ''), '^@+', '', 'g')) AS instagram_key
    FROM customer_cards cc
    JOIN leads l ON l.id = cc.lead_id
    WHERE cc.lead_id IS NOT NULL
    ORDER BY COALESCE(cc.business_context, l.business_context, 'event_genix'), l.id,
             cc.updated_at DESC NULLS LAST, cc.id DESC
),
missing_customers AS (
    SELECT lc.*
    FROM lead_cards lc
    LEFT JOIN LATERAL (
        SELECT c.id
        FROM customers c
        WHERE COALESCE(c.business_context, 'event_genix') = lc.business_context
          AND (
              c.lead_id = lc.id
              OR (lc.phone_digits <> '' AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = lc.phone_digits)
              OR (lc.instagram_key <> '' AND lower(regexp_replace(COALESCE(c.instagram, ''), '^@+', '', 'g')) = lc.instagram_key)
          )
        ORDER BY
            CASE
                WHEN c.lead_id = lc.id THEN 0
                WHEN c.lead_id IS NULL THEN 1
                ELSE 2
            END,
            c.updated_at DESC NULLS LAST,
            c.id DESC
        LIMIT 1
    ) existing ON true
    WHERE existing.id IS NULL
)
INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)
SELECT
    business_context,
    COALESCE(NULLIF(client_name, ''), 'Lead #' || id),
    NULLIF(phone, ''),
    NULLIF(instagram, ''),
    NULL,
    COALESCE(NULLIF(source, ''), 'lead'),
    CONCAT_WS(E'\n',
        'Лід #' || id,
        CASE WHEN source IS NOT NULL OR source_channel IS NOT NULL THEN 'Джерело: ' || CONCAT_WS(' / ', NULLIF(source, ''), NULLIF(source_channel, '')) END,
        CASE WHEN notes IS NOT NULL AND notes <> '' THEN 'Нотатки ліда: ' || notes END
    ),
    id,
    '[]'::jsonb
FROM missing_customers;

WITH card_rows AS (
    SELECT
        cc.id AS card_id,
        cc.lead_id,
        COALESCE(cc.business_context, l.business_context, 'event_genix') AS business_context,
        regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') AS phone_digits,
        lower(regexp_replace(COALESCE(l.instagram, ''), '^@+', '', 'g')) AS instagram_key,
        '[legacy customer_card:' || cc.id || ']' AS marker,
        CONCAT_WS(E'\n',
            '[legacy customer_card:' || cc.id || ']',
            CASE WHEN cc.event_type IS NOT NULL AND cc.event_type <> '' THEN 'Тип події: ' || cc.event_type END,
            CASE WHEN cc.event_date IS NOT NULL THEN 'Дата події: ' || cc.event_date::text END,
            CASE WHEN cc.guest_count IS NOT NULL THEN 'Гостей: ' || cc.guest_count::text END,
            CASE WHEN cc.children_count IS NOT NULL THEN 'Дітей: ' || cc.children_count::text END,
            CASE WHEN cc.budget_approx IS NOT NULL THEN 'Бюджет: ' || cc.budget_approx::text END,
            CASE WHEN cc.how_found IS NOT NULL AND cc.how_found <> '' THEN 'Звідки дізнались: ' || cc.how_found END,
            CASE WHEN cc.email IS NOT NULL AND cc.email <> '' THEN 'Email: ' || cc.email END,
            CASE WHEN cc.channel IS NOT NULL AND cc.channel <> '' THEN 'Канал: ' || cc.channel END,
            CASE WHEN cc.notes IS NOT NULL AND cc.notes <> '' THEN 'Нотатки старої картки: ' || cc.notes END
        ) AS note_block
    FROM customer_cards cc
    JOIN leads l ON l.id = cc.lead_id
    WHERE cc.lead_id IS NOT NULL
),
targets AS (
    SELECT cr.*, target.id AS target_customer_id
    FROM card_rows cr
    JOIN LATERAL (
        SELECT c.id
        FROM customers c
        WHERE COALESCE(c.business_context, 'event_genix') = cr.business_context
          AND (
              c.lead_id = cr.lead_id
              OR (cr.phone_digits <> '' AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = cr.phone_digits)
              OR (cr.instagram_key <> '' AND lower(regexp_replace(COALESCE(c.instagram, ''), '^@+', '', 'g')) = cr.instagram_key)
          )
        ORDER BY
            CASE
                WHEN c.lead_id = cr.lead_id THEN 0
                WHEN c.lead_id IS NULL THEN 1
                ELSE 2
            END,
            c.updated_at DESC NULLS LAST,
            c.id DESC
        LIMIT 1
    ) target ON true
),
pending_blocks AS (
    SELECT t.target_customer_id, t.lead_id, t.card_id, t.note_block
    FROM targets t
    JOIN customers c ON c.id = t.target_customer_id
    WHERE t.note_block IS NOT NULL
      AND t.note_block <> ''
      AND POSITION(t.marker IN COALESCE(c.notes, '')) = 0
),
aggregated_blocks AS (
    SELECT
        target_customer_id,
        MIN(lead_id) AS lead_id,
        COUNT(DISTINCT lead_id) AS lead_count,
        string_agg(note_block, E'\n\n' ORDER BY card_id) AS notes_block
    FROM pending_blocks
    GROUP BY target_customer_id
)
UPDATE customers c
SET notes = CONCAT_WS(E'\n\n', NULLIF(c.notes, ''), aggregated_blocks.notes_block),
    lead_id = CASE
        WHEN c.lead_id IS NULL AND aggregated_blocks.lead_count = 1 THEN aggregated_blocks.lead_id
        ELSE c.lead_id
    END,
    updated_at = NOW()
FROM aggregated_blocks
WHERE c.id = aggregated_blocks.target_customer_id;

WITH card_targets AS (
    SELECT
        target.id AS target_customer_id,
        MIN(cc.lead_id) AS lead_id,
        COUNT(DISTINCT cc.lead_id) AS lead_count
    FROM customer_cards cc
    JOIN leads l ON l.id = cc.lead_id
    JOIN LATERAL (
        SELECT c.id
        FROM customers c
        WHERE COALESCE(c.business_context, 'event_genix') = COALESCE(cc.business_context, l.business_context, 'event_genix')
          AND (
              c.lead_id = cc.lead_id
              OR (regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') <> ''
                  AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'))
              OR (lower(regexp_replace(COALESCE(l.instagram, ''), '^@+', '', 'g')) <> ''
                  AND lower(regexp_replace(COALESCE(c.instagram, ''), '^@+', '', 'g')) = lower(regexp_replace(COALESCE(l.instagram, ''), '^@+', '', 'g')))
          )
        ORDER BY
            CASE
                WHEN c.lead_id = cc.lead_id THEN 0
                WHEN c.lead_id IS NULL THEN 1
                ELSE 2
            END,
            c.updated_at DESC NULLS LAST,
            c.id DESC
        LIMIT 1
    ) target ON true
    WHERE cc.lead_id IS NOT NULL
    GROUP BY target.id
)
UPDATE customers c
SET lead_id = card_targets.lead_id,
    updated_at = NOW()
FROM card_targets
WHERE c.id = card_targets.target_customer_id
  AND c.lead_id IS NULL
  AND card_targets.lead_count = 1;
