-- Banquet deposit data-safety inventory.
-- Production impact: read-only report only.
--
-- Usage:
--   psql "$DATABASE_URL" -f docs/BANQUET_DEPOSIT_INVENTORY_READONLY_2026-06-23.sql
--
-- This file intentionally contains only SELECT statements. It must not mutate data.

SELECT
    'booking_column_map' AS section,
    jsonb_agg(
        jsonb_build_object(
            'column_name', column_name,
            'data_type', data_type,
            'is_nullable', is_nullable,
            'column_default', column_default
        )
        ORDER BY column_name
    ) AS columns
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = 'bookings'
  AND (
      column_name IN (
          'id',
          'business_context',
          'customer_id',
          'date',
          'linked_to',
          'extra_data',
          'payment_method',
          'payment_status',
          'paid_amount'
      )
      OR column_name ILIKE '%deposit%'
  );

WITH booking_rows AS (
    SELECT
        b.*,
        COALESCE(b.business_context, 'event_genix') AS resolved_business_context,
        COALESCE(b.extra_data, '{}'::jsonb) AS extra,
        to_jsonb(b) AS booking_json
    FROM bookings b
),
banquet_group_links AS (
    SELECT
        bgb.booking_id,
        jsonb_agg(
            jsonb_build_object(
                'source', 'banquet_group_bookings',
                'group_id', bgb.group_id,
                'role', bgb.role,
                'primary_booking_id', bg.primary_booking_id,
                'group_customer_id', bg.customer_id,
                'group_date', bg.date,
                'group_status', bg.status,
                'group_source', bg.source
            )
            ORDER BY bgb.role, bgb.group_id
        ) AS banquet_groups
    FROM banquet_group_bookings bgb
    LEFT JOIN banquet_groups bg ON bg.id = bgb.group_id
    GROUP BY bgb.booking_id
),
legacy_link_rows AS (
    SELECT
        booking_a_id AS booking_id,
        booking_b_id AS linked_booking_id,
        relation_type,
        label
    FROM booking_banquet_links
    UNION ALL
    SELECT
        booking_b_id AS booking_id,
        booking_a_id AS linked_booking_id,
        relation_type,
        label
    FROM booking_banquet_links
),
legacy_links AS (
    SELECT
        booking_id,
        jsonb_agg(
            jsonb_build_object(
                'source', 'booking_banquet_links',
                'linked_booking_id', linked_booking_id,
                'relation_type', relation_type,
                'label', label
            )
            ORDER BY linked_booking_id, relation_type
        ) AS legacy_booking_banquet_links
    FROM legacy_link_rows
    GROUP BY booking_id
),
inventory_base AS (
    SELECT
        br.id AS booking_id,
        br.resolved_business_context AS business_context,
        br.customer_id,
        br.date,
        NULLIF(
            jsonb_strip_nulls(
                jsonb_build_object(
                    'linked_to', br.linked_to,
                    'banquet_groups', bgl.banquet_groups,
                    'legacy_booking_banquet_links', ll.legacy_booking_banquet_links
                )
            ),
            '{}'::jsonb
        ) AS group_link,
        NULLIF(
            jsonb_strip_nulls(
                jsonb_build_object(
                    'extra_data.deposit', br.extra->'deposit',
                    'extra_data.banquetDeposit', br.extra->'banquetDeposit',
                    'extra_data.bookingDeposit', br.extra->'bookingDeposit',
                    'extra_data.bookingPayment.deposit', br.extra#>'{bookingPayment,deposit}',
                    'extra_data.payment.deposit', br.extra#>'{payment,deposit}',
                    'booking.depositAmount', br.booking_json->'depositAmount',
                    'booking.deposit_amount', br.booking_json->'deposit_amount',
                    'booking.banquetDepositAmount', br.booking_json->'banquetDepositAmount',
                    'booking.banquet_deposit_amount', br.booking_json->'banquet_deposit_amount',
                    'booking.depositPaymentMethod', br.booking_json->'depositPaymentMethod',
                    'booking.deposit_payment_method', br.booking_json->'deposit_payment_method',
                    'booking.depositPaymentStatus', br.booking_json->'depositPaymentStatus',
                    'booking.deposit_payment_status', br.booking_json->'deposit_payment_status',
                    'booking.depositNote', br.booking_json->'depositNote',
                    'booking.deposit_note', br.booking_json->'deposit_note',
                    'extra_data.depositAmount', br.extra->'depositAmount',
                    'extra_data.deposit_amount', br.extra->'deposit_amount',
                    'extra_data.banquetDepositAmount', br.extra->'banquetDepositAmount',
                    'extra_data.banquet_deposit_amount', br.extra->'banquet_deposit_amount',
                    'extra_data.depositPaymentMethod', br.extra->'depositPaymentMethod',
                    'extra_data.deposit_payment_method', br.extra->'deposit_payment_method',
                    'extra_data.depositPaymentStatus', br.extra->'depositPaymentStatus',
                    'extra_data.deposit_payment_status', br.extra->'deposit_payment_status',
                    'extra_data.depositNote', br.extra->'depositNote',
                    'extra_data.deposit_note', br.extra->'deposit_note'
                )
            ),
            '{}'::jsonb
        ) AS deposit_json,
        br.payment_method,
        br.payment_status,
        br.paid_amount,
        NULLIF(
            jsonb_strip_nulls(
                jsonb_build_object(
                    'payment_method', br.payment_method,
                    'payment_status', br.payment_status,
                    'paid_amount', br.paid_amount
                )
            ),
            '{}'::jsonb
        ) AS payment_context
    FROM booking_rows br
    LEFT JOIN banquet_group_links bgl ON bgl.booking_id = br.id
    LEFT JOIN legacy_links ll ON ll.booking_id = br.id
),
inventory_rows AS (
    SELECT
        *,
        CASE
            WHEN deposit_json IS NOT NULL THEN 'copy_explicit_deposit_json'
            WHEN COALESCE(paid_amount, 0) > 0
              OR COALESCE(NULLIF(payment_status, 'pending'), '') <> ''
                THEN 'report_only_paid_amount_or_payment_status'
            WHEN payment_method IS NOT NULL THEN 'report_only_payment_method_context'
            ELSE 'no_deposit_like_data'
        END AS copy_disposition
    FROM inventory_base
)
SELECT
    booking_id,
    business_context,
    customer_id,
    date,
    group_link,
    deposit_json,
    payment_method,
    payment_status,
    paid_amount,
    payment_context,
    copy_disposition
FROM inventory_rows
WHERE deposit_json IS NOT NULL
   OR COALESCE(paid_amount, 0) > 0
   OR COALESCE(NULLIF(payment_status, 'pending'), '') <> ''
   OR payment_method IS NOT NULL
ORDER BY business_context, date, booking_id;
