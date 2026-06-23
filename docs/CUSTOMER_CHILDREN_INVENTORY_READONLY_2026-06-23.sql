-- Customer children data-safety inventory, read-only.
-- Date: 2026-06-23
-- Scope: existing child-like data before introducing canonical customer_children.
-- Safety: SELECT-only report inside a read-only transaction. No persistent writes.
-- Usage: psql "$DATABASE_URL" -f docs/CUSTOMER_CHILDREN_INVENTORY_READONLY_2026-06-23.sql

START TRANSACTION READ ONLY;

-- 1) Schema/source map for operator confirmation.
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'customers' AND column_name IN ('id', 'business_context', 'name', 'phone', 'instagram', 'lead_id', 'child_name', 'child_birthday'))
      OR (table_name = 'leads' AND column_name IN ('id', 'business_context', 'client_name', 'phone', 'instagram', 'children_count', 'child_age', 'celebrants', 'raw_payload'))
      OR (table_name = 'customer_cards' AND column_name IN ('id', 'business_context', 'lead_id', 'children_count'))
      OR (table_name = 'lead_customer_links' AND column_name IN ('id', 'business_context', 'lead_id', 'customer_id', 'link_type', 'source', 'metadata'))
      OR (table_name = 'bookings' AND column_name IN ('id', 'business_context', 'customer_id', 'date', 'label', 'kids_count', 'extra_data'))
  )
ORDER BY table_name, ordinal_position;

-- 2) Customer-level inventory. This is the main report for safe copy planning.
WITH explicit_links AS (
    SELECT
        COALESCE(lcl.business_context, 'event_genix') AS business_context,
        lcl.customer_id,
        lcl.lead_id,
        COALESCE(lcl.link_type, 'lead_customer_links') AS link_source
    FROM lead_customer_links lcl
    WHERE lcl.customer_id IS NOT NULL
      AND lcl.lead_id IS NOT NULL

    UNION

    SELECT
        COALESCE(c.business_context, 'event_genix') AS business_context,
        c.id AS customer_id,
        c.lead_id,
        'customers.lead_id' AS link_source
    FROM customers c
    WHERE c.lead_id IS NOT NULL
),
lead_sources AS (
    SELECT
        el.business_context,
        el.customer_id,
        l.id AS lead_id,
        el.link_source,
        l.client_name,
        l.phone,
        l.instagram,
        l.children_count,
        l.child_age,
        CASE
            WHEN jsonb_typeof(COALESCE(l.celebrants, '[]'::jsonb)) = 'array'
            THEN jsonb_array_length(COALESCE(l.celebrants, '[]'::jsonb))
            ELSE 0
        END AS celebrants_count,
        COALESCE(l.celebrants, '[]'::jsonb) AS celebrants,
        (
            COALESCE(l.raw_payload, '{}'::jsonb)::text ~* '(child|children|kids|celebrant|birthday|birth_date|child_name|childName|дит|іменин)'
        ) AS raw_payload_has_child_refs
    FROM explicit_links el
    JOIN leads l
      ON l.id = el.lead_id
     AND COALESCE(l.business_context, 'event_genix') = el.business_context
),
lead_rollup AS (
    SELECT
        business_context,
        customer_id,
        ARRAY_AGG(DISTINCT lead_id ORDER BY lead_id) AS lead_ids,
        MAX(celebrants_count) AS max_lead_celebrants_count,
        BOOL_OR(celebrants_count > 1) AS any_lead_has_multiple_celebrants,
        BOOL_OR(raw_payload_has_child_refs) AS any_lead_raw_payload_has_child_refs,
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'lead_id', lead_id,
                'link_source', link_source,
                'client_name', client_name,
                'children_count', children_count,
                'child_age', child_age,
                'celebrants_count', celebrants_count,
                'celebrants', celebrants,
                'raw_payload_has_child_refs', raw_payload_has_child_refs
            )
            ORDER BY lead_id
        ) AS lead_context_json
    FROM lead_sources
    GROUP BY business_context, customer_id
),
booking_rollup AS (
    SELECT
        COALESCE(b.business_context, 'event_genix') AS business_context,
        b.customer_id,
        ARRAY_AGG(b.id::text ORDER BY b.date DESC NULLS LAST, b.id) AS booking_ids,
        MAX(NULLIF(b.kids_count, 0)) AS max_booking_kids_count,
        BOOL_OR(COALESCE(b.extra_data, '{}'::jsonb)::text ~* '(child|children|kids|celebrant|birthday|birth_date|child_name|childName|дит|іменин)') AS any_booking_extra_data_has_child_refs,
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'booking_id', b.id,
                'date', b.date,
                'label', b.label,
                'kids_count', b.kids_count,
                'extra_data_has_child_refs', COALESCE(b.extra_data, '{}'::jsonb)::text ~* '(child|children|kids|celebrant|birthday|birth_date|child_name|childName|дит|іменин)',
                'extra_data', CASE
                    WHEN COALESCE(b.extra_data, '{}'::jsonb)::text ~* '(child|children|kids|celebrant|birthday|birth_date|child_name|childName|дит|іменин)'
                    THEN b.extra_data
                    ELSE NULL
                END
            )
            ORDER BY b.date DESC NULLS LAST, b.id
        ) AS booking_context_json
    FROM bookings b
    WHERE b.customer_id IS NOT NULL
    GROUP BY COALESCE(b.business_context, 'event_genix'), b.customer_id
),
card_rollup AS (
    SELECT
        COALESCE(cc.business_context, l.business_context, 'event_genix') AS business_context,
        c.id AS customer_id,
        MAX(NULLIF(cc.children_count, 0)) AS max_customer_card_children_count,
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'customer_card_id', cc.id,
                'lead_id', cc.lead_id,
                'children_count', cc.children_count,
                'event_date', cc.event_date,
                'notes_present', cc.notes IS NOT NULL AND cc.notes <> ''
            )
            ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC
        ) FILTER (WHERE cc.id IS NOT NULL) AS customer_cards_json
    FROM customer_cards cc
    JOIN leads l
      ON l.id = cc.lead_id
    LEFT JOIN explicit_links el
      ON el.lead_id = l.id
     AND el.business_context = COALESCE(cc.business_context, l.business_context, 'event_genix')
    LEFT JOIN customers c
      ON c.id = el.customer_id
    WHERE c.id IS NOT NULL
    GROUP BY COALESCE(cc.business_context, l.business_context, 'event_genix'), c.id
),
customer_report AS (
    SELECT
        c.id AS customer_id,
        COALESCE(c.business_context, 'event_genix') AS business_context,
        c.name AS customer_name,
        c.phone,
        c.instagram,
        c.lead_id AS legacy_customer_lead_id,
        c.child_name,
        c.child_birthday,
        lr.lead_ids,
        lr.max_lead_celebrants_count,
        lr.any_lead_has_multiple_celebrants,
        lr.any_lead_raw_payload_has_child_refs,
        lr.lead_context_json,
        br.booking_ids,
        br.max_booking_kids_count,
        br.any_booking_extra_data_has_child_refs,
        br.booking_context_json,
        cr.max_customer_card_children_count,
        cr.customer_cards_json,
        (
            c.child_name IS NOT NULL
            AND (
                c.child_name ~ '[,;/|+&]'
                OR POSITION(E'\n' IN c.child_name) > 0
            )
        ) AS suspected_multi_child_text,
        (
            c.child_name IS NOT NULL
            AND c.child_name ~* '(^|[^0-9])([0-9]{1,2})([[:space:]]*(р|рок|роки|років|лет|years?|y))?([^0-9]|$)'
        ) AS suspected_age_in_name,
        (c.child_name IS NOT NULL AND c.child_birthday IS NULL) AS birthday_missing,
        (c.child_name IS NULL AND c.child_birthday IS NOT NULL) AS birthday_without_name,
        (
            COALESCE(lr.max_lead_celebrants_count, 0) > 1
            AND c.child_name IS NOT NULL
        ) AS linked_lead_multiple_celebrants_but_customer_single_field,
        (
            COALESCE(cr.max_customer_card_children_count, 0) > 1
            AND c.child_name IS NOT NULL
        ) AS legacy_card_count_gt_one_but_customer_single_field
    FROM customers c
    LEFT JOIN lead_rollup lr
      ON lr.customer_id = c.id
     AND lr.business_context = COALESCE(c.business_context, 'event_genix')
    LEFT JOIN booking_rollup br
      ON br.customer_id = c.id
     AND br.business_context = COALESCE(c.business_context, 'event_genix')
    LEFT JOIN card_rollup cr
      ON cr.customer_id = c.id
     AND cr.business_context = COALESCE(c.business_context, 'event_genix')
)
SELECT
    customer_id,
    business_context,
    customer_name,
    phone,
    instagram,
    legacy_customer_lead_id,
    child_name,
    child_birthday,
    lead_ids,
    booking_ids,
    max_lead_celebrants_count,
    max_customer_card_children_count,
    max_booking_kids_count,
    suspected_multi_child_text,
    suspected_age_in_name,
    birthday_missing,
    birthday_without_name,
    linked_lead_multiple_celebrants_but_customer_single_field,
    legacy_card_count_gt_one_but_customer_single_field,
    any_lead_raw_payload_has_child_refs,
    any_booking_extra_data_has_child_refs,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN suspected_multi_child_text THEN 'suspected_multi_child_text' END,
        CASE WHEN suspected_age_in_name THEN 'suspected_age_in_name' END,
        CASE WHEN birthday_missing THEN 'birthday_missing' END,
        CASE WHEN birthday_without_name THEN 'birthday_without_name' END,
        CASE WHEN linked_lead_multiple_celebrants_but_customer_single_field THEN 'linked_lead_multiple_celebrants_but_customer_single_field' END,
        CASE WHEN legacy_card_count_gt_one_but_customer_single_field THEN 'legacy_card_count_gt_one_but_customer_single_field' END,
        CASE WHEN any_lead_raw_payload_has_child_refs THEN 'lead_raw_payload_has_child_refs' END,
        CASE WHEN any_booking_extra_data_has_child_refs THEN 'booking_extra_data_has_child_refs' END
    ], NULL) AS issue_codes,
    lead_context_json,
    customer_cards_json,
    booking_context_json
FROM customer_report
WHERE child_name IS NOT NULL
   OR child_birthday IS NOT NULL
   OR COALESCE(max_lead_celebrants_count, 0) > 0
   OR COALESCE(max_customer_card_children_count, 0) > 0
   OR COALESCE(max_booking_kids_count, 0) > 0
   OR any_lead_raw_payload_has_child_refs
   OR any_booking_extra_data_has_child_refs
ORDER BY
    CASE
        WHEN linked_lead_multiple_celebrants_but_customer_single_field THEN 0
        WHEN suspected_multi_child_text THEN 1
        WHEN suspected_age_in_name THEN 2
        WHEN birthday_missing THEN 3
        WHEN birthday_without_name THEN 4
        ELSE 5
    END,
    business_context,
    customer_id;

-- 3) Lead-level child data that has not necessarily reached a customer card.
WITH explicit_links AS (
    SELECT
        COALESCE(lcl.business_context, 'event_genix') AS business_context,
        lcl.customer_id,
        lcl.lead_id,
        COALESCE(lcl.link_type, 'lead_customer_links') AS link_source
    FROM lead_customer_links lcl
    WHERE lcl.customer_id IS NOT NULL
      AND lcl.lead_id IS NOT NULL

    UNION

    SELECT
        COALESCE(c.business_context, 'event_genix') AS business_context,
        c.id AS customer_id,
        c.lead_id,
        'customers.lead_id' AS link_source
    FROM customers c
    WHERE c.lead_id IS NOT NULL
),
lead_report AS (
    SELECT
        l.id AS lead_id,
        COALESCE(l.business_context, 'event_genix') AS business_context,
        l.client_name,
        l.phone,
        l.instagram,
        l.children_count,
        l.child_age,
        CASE
            WHEN jsonb_typeof(COALESCE(l.celebrants, '[]'::jsonb)) = 'array'
            THEN jsonb_array_length(COALESCE(l.celebrants, '[]'::jsonb))
            ELSE 0
        END AS celebrants_count,
        COALESCE(l.celebrants, '[]'::jsonb) AS celebrants,
        COALESCE(l.raw_payload, '{}'::jsonb)::text ~* '(child|children|kids|celebrant|birthday|birth_date|child_name|childName|дит|іменин)' AS raw_payload_has_child_refs,
        ARRAY_AGG(DISTINCT el.customer_id) FILTER (WHERE el.customer_id IS NOT NULL) AS linked_customer_ids
    FROM leads l
    LEFT JOIN explicit_links el
      ON el.lead_id = l.id
     AND el.business_context = COALESCE(l.business_context, 'event_genix')
    GROUP BY l.id
)
SELECT
    lead_id,
    business_context,
    client_name,
    phone,
    instagram,
    children_count,
    child_age,
    celebrants_count,
    celebrants,
    raw_payload_has_child_refs,
    linked_customer_ids,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN celebrants_count > 1 THEN 'lead_multiple_celebrants' END,
        CASE WHEN celebrants_count = 0 AND children_count IS NOT NULL THEN 'count_only_no_celebrants' END,
        CASE WHEN celebrants_count > 0 AND linked_customer_ids IS NULL THEN 'lead_child_data_without_customer_link' END,
        CASE WHEN raw_payload_has_child_refs THEN 'raw_payload_has_child_refs' END
    ], NULL) AS issue_codes
FROM lead_report
WHERE celebrants_count > 0
   OR children_count IS NOT NULL
   OR child_age IS NOT NULL
   OR raw_payload_has_child_refs
ORDER BY
    CASE WHEN celebrants_count > 1 THEN 0 ELSE 1 END,
    business_context,
    lead_id;

ROLLBACK;
