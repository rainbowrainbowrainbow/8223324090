-- MIGRATION_KIND: mixed
-- SAFETY: Additive customer_children table plus idempotent copy from explicit customers child fields and linked leads.celebrants only; legacy customer, lead, booking, and customer_cards fields are not rewritten.
-- ROLLBACK: Export customer_children, then DROP INDEX IF EXISTS idx_customer_children_lead_celebrant_unique, idx_customer_children_legacy_customer_unique, idx_customer_children_source, idx_customer_children_booking, idx_customer_children_lead, idx_customer_children_business_customer; DROP TABLE IF EXISTS customer_children if needed.
-- DATA_SCOPE: customers.child_name/customers.child_birthday and explicit leads.celebrants linked to existing customers through lead_customer_links or customers.lead_id only.

CREATE TABLE IF NOT EXISTS customer_children (
    id                 BIGSERIAL PRIMARY KEY,
    business_context   VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    customer_id        INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    lead_id            INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    booking_id         VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL,
    name               TEXT,
    birthday           DATE,
    age_snapshot       INTEGER,
    note               TEXT,
    source_kind        VARCHAR(64) NOT NULL,
    source_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_children_source_kind_check
        CHECK (NULLIF(BTRIM(source_kind), '') IS NOT NULL),
    CONSTRAINT customer_children_age_snapshot_check
        CHECK (age_snapshot IS NULL OR (age_snapshot >= 0 AND age_snapshot <= 120)),
    CONSTRAINT customer_children_source_payload_object_check
        CHECK (jsonb_typeof(source_payload) = 'object'),
    CONSTRAINT customer_children_has_data_check
        CHECK (
            NULLIF(BTRIM(COALESCE(name, '')), '') IS NOT NULL
            OR birthday IS NOT NULL
            OR age_snapshot IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(note, '')), '') IS NOT NULL
        )
);

CREATE INDEX IF NOT EXISTS idx_customer_children_business_customer
    ON customer_children(business_context, customer_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_customer_children_lead
    ON customer_children(business_context, lead_id)
    WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_children_booking
    ON customer_children(business_context, booking_id)
    WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_children_source
    ON customer_children(business_context, source_kind);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_children_legacy_customer_unique
    ON customer_children(business_context, customer_id, source_kind)
    WHERE source_kind = 'legacy_customer_child';

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_children_lead_celebrant_unique
    ON customer_children(
        business_context,
        customer_id,
        lead_id,
        ((source_payload->>'celebrant_index'))
    )
    WHERE source_kind = 'lead_celebrant' AND lead_id IS NOT NULL;

WITH legacy_customer_rows AS (
    SELECT
        COALESCE(c.business_context, 'event_genix') AS business_context,
        c.id AS customer_id,
        c.lead_id,
        c.child_name,
        c.child_birthday,
        regexp_match(
            COALESCE(c.child_name, ''),
            '(^|[^0-9])([0-9]{1,2})([[:space:]]*(р|рок|роки|років|лет|years?|y))([^0-9]|$)',
            'i'
        ) AS age_match
    FROM customers c
    WHERE NULLIF(BTRIM(COALESCE(c.child_name, '')), '') IS NOT NULL
       OR c.child_birthday IS NOT NULL
),
legacy_customer_normalized AS (
    SELECT
        business_context,
        customer_id,
        lead_id,
        CASE
            WHEN age_match IS NOT NULL THEN NULLIF(
                BTRIM(
                    regexp_replace(
                        COALESCE(child_name, ''),
                        '([[:space:],;/-]+[0-9]{1,2}[[:space:]]*(р|рок|роки|років|лет|years?|y)?[[:space:][:punct:]]*)$',
                        '',
                        'i'
                    )
                ),
                ''
            )
            ELSE NULLIF(BTRIM(COALESCE(child_name, '')), '')
        END AS normalized_name,
        child_name,
        child_birthday,
        CASE
            WHEN age_match IS NOT NULL THEN ((age_match)[2])::INTEGER
            ELSE NULL
        END AS age_snapshot
    FROM legacy_customer_rows
)
INSERT INTO customer_children (
    business_context,
    customer_id,
    lead_id,
    name,
    birthday,
    age_snapshot,
    note,
    source_kind,
    source_payload,
    sort_order
)
SELECT
    lcn.business_context,
    lcn.customer_id,
    lcn.lead_id,
    COALESCE(lcn.normalized_name, NULLIF(BTRIM(COALESCE(lcn.child_name, '')), '')),
    lcn.child_birthday,
    lcn.age_snapshot,
    NULL,
    'legacy_customer_child',
    jsonb_build_object(
        'source_table', 'customers',
        'source_customer_id', lcn.customer_id,
        'source_columns', jsonb_build_object(
            'child_name', lcn.child_name,
            'child_birthday', lcn.child_birthday
        ),
        'copy_rule', 'legacy_customer_child_fields',
        'age_snapshot_from_name', lcn.age_snapshot IS NOT NULL,
        'original_child_name_preserved', true
    ),
    0
FROM legacy_customer_normalized lcn
WHERE NOT EXISTS (
    SELECT 1
    FROM customer_children existing
    WHERE existing.business_context = lcn.business_context
      AND existing.customer_id = lcn.customer_id
      AND existing.source_kind = 'legacy_customer_child'
);

WITH raw_link_candidates AS (
    SELECT
        COALESCE(lcl.business_context, 'event_genix') AS business_context,
        lcl.customer_id,
        lcl.lead_id,
        COALESCE(lcl.link_type, 'lead_customer_links') AS link_source
    FROM lead_customer_links lcl
    WHERE lcl.customer_id IS NOT NULL
      AND lcl.lead_id IS NOT NULL

    UNION ALL

    SELECT
        COALESCE(c.business_context, 'event_genix') AS business_context,
        c.id AS customer_id,
        c.lead_id,
        'customers.lead_id' AS link_source
    FROM customers c
    WHERE c.lead_id IS NOT NULL
),
lead_links AS (
    SELECT
        rlc.business_context,
        rlc.customer_id,
        rlc.lead_id,
        jsonb_agg(DISTINCT rlc.link_source ORDER BY rlc.link_source) AS link_sources
    FROM raw_link_candidates rlc
    JOIN customers c
      ON c.id = rlc.customer_id
     AND COALESCE(c.business_context, 'event_genix') = rlc.business_context
    JOIN leads l
      ON l.id = rlc.lead_id
     AND COALESCE(l.business_context, 'event_genix') = rlc.business_context
    GROUP BY rlc.business_context, rlc.customer_id, rlc.lead_id
),
lead_celebrants_raw AS (
    SELECT
        ll.business_context,
        ll.customer_id,
        ll.lead_id,
        ll.link_sources,
        (celebrant_row.ordinality - 1)::INTEGER AS celebrant_index,
        celebrant_row.celebrant AS celebrant,
        NULLIF(BTRIM(COALESCE(
            celebrant_row.celebrant->>'name',
            celebrant_row.celebrant->>'childName',
            celebrant_row.celebrant->>'child_name',
            ''
        )), '') AS raw_name,
        NULLIF(BTRIM(COALESCE(
            celebrant_row.celebrant->>'birthday',
            celebrant_row.celebrant->>'birthDate',
            celebrant_row.celebrant->>'birth_date',
            ''
        )), '') AS birthday_text,
        NULLIF(BTRIM(COALESCE(
            celebrant_row.celebrant->>'age',
            celebrant_row.celebrant->>'childAge',
            celebrant_row.celebrant->>'child_age',
            ''
        )), '') AS age_text,
        NULLIF(BTRIM(COALESCE(
            celebrant_row.celebrant->>'notes',
            celebrant_row.celebrant->>'note',
            ''
        )), '') AS raw_note
    FROM lead_links ll
    JOIN leads l
      ON l.id = ll.lead_id
     AND COALESCE(l.business_context, 'event_genix') = ll.business_context
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(COALESCE(l.celebrants, '[]'::jsonb)) = 'array'
            THEN COALESCE(l.celebrants, '[]'::jsonb)
            ELSE '[]'::jsonb
        END
    ) WITH ORDINALITY AS celebrant_row(celebrant, ordinality)
    WHERE jsonb_typeof(celebrant_row.celebrant) = 'object'
),
lead_celebrants_parts AS (
    SELECT
        lcr.*,
        regexp_match(lcr.birthday_text, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$') AS birthday_parts
    FROM lead_celebrants_raw lcr
),
lead_celebrants_numbers AS (
    SELECT
        lcp.*,
        CASE WHEN lcp.birthday_parts IS NOT NULL THEN ((lcp.birthday_parts)[1])::INTEGER ELSE NULL END AS birth_year,
        CASE WHEN lcp.birthday_parts IS NOT NULL THEN ((lcp.birthday_parts)[2])::INTEGER ELSE NULL END AS birth_month,
        CASE WHEN lcp.birthday_parts IS NOT NULL THEN ((lcp.birthday_parts)[3])::INTEGER ELSE NULL END AS birth_day,
        CASE
            WHEN lcp.age_text ~ '^[0-9]{1,3}$' THEN
                CASE
                    WHEN lcp.age_text::INTEGER BETWEEN 0 AND 120 THEN lcp.age_text::INTEGER
                    ELSE NULL
                END
            ELSE NULL
        END AS normalized_age_snapshot
    FROM lead_celebrants_parts lcp
),
lead_celebrants_normalized AS (
    SELECT
        lcn.*,
        CASE
            WHEN birth_year IS NOT NULL
             AND birth_month BETWEEN 1 AND 12
             AND birth_day BETWEEN 1 AND
                CASE birth_month
                    WHEN 1 THEN 31
                    WHEN 2 THEN CASE
                        WHEN (birth_year % 400 = 0) OR (birth_year % 4 = 0 AND birth_year % 100 <> 0) THEN 29
                        ELSE 28
                    END
                    WHEN 3 THEN 31
                    WHEN 4 THEN 30
                    WHEN 5 THEN 31
                    WHEN 6 THEN 30
                    WHEN 7 THEN 31
                    WHEN 8 THEN 31
                    WHEN 9 THEN 30
                    WHEN 10 THEN 31
                    WHEN 11 THEN 30
                    WHEN 12 THEN 31
                    ELSE 0
                END
            THEN make_date(birth_year, birth_month, birth_day)
            ELSE NULL
        END AS normalized_birthday
    FROM lead_celebrants_numbers lcn
)
INSERT INTO customer_children (
    business_context,
    customer_id,
    lead_id,
    name,
    birthday,
    age_snapshot,
    note,
    source_kind,
    source_payload,
    sort_order
)
SELECT
    lcn.business_context,
    lcn.customer_id,
    lcn.lead_id,
    lcn.raw_name,
    lcn.normalized_birthday,
    lcn.normalized_age_snapshot,
    lcn.raw_note,
    'lead_celebrant',
    jsonb_build_object(
        'source_table', 'leads',
        'source_lead_id', lcn.lead_id,
        'source_customer_id', lcn.customer_id,
        'celebrant_index', lcn.celebrant_index,
        'celebrant', lcn.celebrant,
        'link_sources', lcn.link_sources,
        'copy_rule', 'explicit_lead_celebrants',
        'birthday_copied', lcn.normalized_birthday IS NOT NULL,
        'birthday_rejected', lcn.birthday_text IS NOT NULL AND lcn.normalized_birthday IS NULL,
        'age_snapshot_copied', lcn.normalized_age_snapshot IS NOT NULL
    ),
    10 + lcn.celebrant_index
FROM lead_celebrants_normalized lcn
WHERE (
        lcn.raw_name IS NOT NULL
        OR lcn.normalized_birthday IS NOT NULL
        OR lcn.normalized_age_snapshot IS NOT NULL
        OR lcn.raw_note IS NOT NULL
    )
  AND NOT EXISTS (
      SELECT 1
      FROM customer_children existing
      WHERE existing.business_context = lcn.business_context
        AND existing.customer_id = lcn.customer_id
        AND existing.lead_id = lcn.lead_id
        AND existing.source_kind = 'lead_celebrant'
        AND existing.source_payload->>'celebrant_index' = lcn.celebrant_index::TEXT
  );
