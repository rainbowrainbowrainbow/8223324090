-- MIGRATION_KIND: mixed
-- SAFETY: Additive banquet_deposits table plus idempotent copy from explicit bookings.extra_data deposit JSON only; existing bookings and finance payment fields are not rewritten.
-- ROLLBACK: Export banquet_deposits, then DROP INDEX IF EXISTS idx_banquet_deposits_legacy_source_unique, idx_banquet_deposits_accountant_task, idx_banquet_deposits_lead, idx_banquet_deposits_banquet_group, idx_banquet_deposits_primary_booking, idx_banquet_deposits_business_status_date; DROP TABLE IF EXISTS banquet_deposits if needed.
-- DATA_SCOPE: explicit deposit JSON in bookings.extra_data only; bookings.paid_amount/payment_status are report context and are never copied into banquet_deposits.amount.

CREATE TABLE IF NOT EXISTS banquet_deposits (
    id                         BIGSERIAL PRIMARY KEY,
    business_context           VARCHAR(64) NOT NULL DEFAULT 'event_genix',
    banquet_group_id           VARCHAR(50) REFERENCES banquet_groups(id) ON DELETE SET NULL,
    primary_booking_id         VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL,
    lead_id                    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    customer_id                INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    accountant_task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    client_name_snapshot       TEXT,
    event_date                 DATE,
    banquet_number_snapshot    VARCHAR(100),
    amount                     INTEGER,
    payment_method             VARCHAR(20),
    status                     VARCHAR(32) NOT NULL DEFAULT 'manager_reported',
    source_kind                VARCHAR(64) NOT NULL DEFAULT 'manual',
    source_payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    manager_reported_at        TIMESTAMPTZ,
    manager_reported_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_at                TIMESTAMPTZ,
    verified_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
    corrected_at               TIMESTAMPTZ,
    corrected_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
    finance_transaction_id     INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL,
    meta                       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT banquet_deposits_amount_check
        CHECK (amount IS NULL OR amount >= 0),
    CONSTRAINT banquet_deposits_payment_method_check
        CHECK (payment_method IS NULL OR payment_method IN ('cash', 'card')),
    CONSTRAINT banquet_deposits_status_check
        CHECK (status IN ('manager_reported', 'needs_booking_link', 'accountant_verified', 'corrected', 'cancelled')),
    CONSTRAINT banquet_deposits_source_payload_object_check
        CHECK (jsonb_typeof(source_payload) = 'object'),
    CONSTRAINT banquet_deposits_meta_object_check
        CHECK (jsonb_typeof(meta) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_business_status_date
    ON banquet_deposits(business_context, status, event_date);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_primary_booking
    ON banquet_deposits(primary_booking_id);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_banquet_group
    ON banquet_deposits(banquet_group_id);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_lead
    ON banquet_deposits(lead_id);

CREATE INDEX IF NOT EXISTS idx_banquet_deposits_accountant_task
    ON banquet_deposits(accountant_task_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_banquet_deposits_legacy_source_unique
    ON banquet_deposits(
        source_kind,
        ((source_payload->>'source_booking_id')),
        ((source_payload->>'source_path'))
    )
    WHERE source_kind = 'legacy_booking_extra_data';

WITH booking_rows AS (
    SELECT
        b.id AS booking_id,
        COALESCE(b.business_context, 'event_genix') AS business_context,
        b.customer_id,
        b.date AS booking_date,
        b.label AS booking_label,
        b.group_name,
        b.created_at AS booking_created_at,
        b.updated_at AS booking_updated_at,
        b.payment_method AS booking_payment_method,
        b.payment_status AS booking_payment_status,
        b.paid_amount AS booking_paid_amount,
        b.extra_data AS original_extra_data,
        COALESCE(b.extra_data, '{}'::jsonb) AS extra
    FROM bookings b
    WHERE b.extra_data IS NOT NULL
      AND jsonb_typeof(b.extra_data) = 'object'
),
object_candidates AS (
    SELECT
        br.*,
        candidate.source_path,
        candidate.source_rank,
        candidate.source_value
    FROM booking_rows br
    CROSS JOIN LATERAL (
        VALUES
            ('extra_data.deposit', 10, br.extra->'deposit'),
            ('extra_data.banquetDeposit', 20, br.extra->'banquetDeposit'),
            ('extra_data.bookingDeposit', 30, br.extra->'bookingDeposit'),
            ('extra_data.bookingPayment.deposit', 40, br.extra#>'{bookingPayment,deposit}'),
            ('extra_data.payment.deposit', 50, br.extra#>'{payment,deposit}')
    ) AS candidate(source_path, source_rank, source_value)
    WHERE candidate.source_value IS NOT NULL
      AND candidate.source_value <> 'null'::jsonb
      AND candidate.source_value <> '{}'::jsonb
),
root_amount_candidates AS (
    SELECT
        br.*,
        root_amount.source_path,
        root_amount.source_rank,
        jsonb_strip_nulls(
            jsonb_build_object(
                'amount', root_amount.amount_value,
                'paymentMethod', COALESCE(br.extra->'depositPaymentMethod', br.extra->'deposit_payment_method'),
                'paymentStatus', COALESCE(br.extra->'depositPaymentStatus', br.extra->'deposit_payment_status'),
                'note', COALESCE(br.extra->'depositNote', br.extra->'deposit_note')
            )
        ) AS source_value
    FROM booking_rows br
    CROSS JOIN LATERAL (
        SELECT amount_candidate.source_path, amount_candidate.source_rank, amount_candidate.amount_value
        FROM (
            VALUES
                ('extra_data.depositAmount', 60, br.extra->'depositAmount'),
                ('extra_data.deposit_amount', 61, br.extra->'deposit_amount'),
                ('extra_data.banquetDepositAmount', 62, br.extra->'banquetDepositAmount'),
                ('extra_data.banquet_deposit_amount', 63, br.extra->'banquet_deposit_amount')
        ) AS amount_candidate(source_path, source_rank, amount_value)
        WHERE amount_candidate.amount_value IS NOT NULL
          AND amount_candidate.amount_value <> 'null'::jsonb
        ORDER BY amount_candidate.source_rank
        LIMIT 1
    ) AS root_amount
),
candidate_rows AS (
    SELECT * FROM object_candidates
    UNION ALL
    SELECT * FROM root_amount_candidates
),
all_markers AS (
    SELECT
        booking_id,
        jsonb_object_agg(source_path, source_value ORDER BY source_rank, source_path) AS markers
    FROM candidate_rows
    GROUP BY booking_id
),
selected_candidates AS (
    SELECT DISTINCT ON (booking_id)
        *
    FROM candidate_rows
    ORDER BY booking_id, source_rank, source_path
),
selected_with_raw AS (
    SELECT
        sc.*,
        CASE
            WHEN jsonb_typeof(sc.source_value) = 'object' THEN COALESCE(
                sc.source_value->>'amount',
                sc.source_value->>'depositAmount',
                sc.source_value->>'deposit_amount',
                sc.source_value->>'value'
            )
            WHEN jsonb_typeof(sc.source_value) IN ('number', 'string') THEN btrim(sc.source_value::text, '"')
            ELSE NULL
        END AS raw_amount_text,
        CASE
            WHEN jsonb_typeof(sc.source_value) = 'object' THEN COALESCE(
                sc.source_value->>'paymentMethod',
                sc.source_value->>'payment_method',
                sc.source_value->>'method'
            )
            ELSE NULL
        END AS raw_payment_method_text
    FROM selected_candidates sc
),
cleaned_candidates AS (
    SELECT
        swr.*,
        NULLIF(
            replace(regexp_replace(COALESCE(swr.raw_amount_text, ''), '[^0-9,.-]', '', 'g'), ',', '.'),
            ''
        ) AS cleaned_amount_text,
        lower(regexp_replace(COALESCE(swr.raw_payment_method_text, ''), '[[:space:]_-]+', '', 'g')) AS cleaned_payment_method
    FROM selected_with_raw swr
),
parsed_candidates AS (
    SELECT
        cc.*,
        CASE
            WHEN cc.cleaned_amount_text ~ '^[0-9]+(\.[0-9]+)?$'
                THEN cc.cleaned_amount_text::numeric
            ELSE NULL
        END AS parsed_amount
    FROM cleaned_candidates cc
),
normalized_candidates AS (
    SELECT
        pc.*,
        CASE
            WHEN pc.parsed_amount BETWEEN 0 AND 2147483647
                THEN ROUND(pc.parsed_amount)::integer
            ELSE NULL
        END AS normalized_amount,
        CASE
            WHEN pc.cleaned_payment_method IN ('cash', 'gotivka', 'hotivka', 'nal', 'nalichka') THEN 'cash'
            WHEN pc.cleaned_payment_method IN ('card', 'karta', 'kartka', 'bankcard', 'bankcardpayment', 'terminal') THEN 'card'
            ELSE NULL
        END AS normalized_payment_method
    FROM parsed_candidates pc
),
enriched_candidates AS (
    SELECT
        nc.*,
        bgb.group_id AS banquet_group_id,
        bg.primary_booking_id AS group_primary_booking_id,
        bg.customer_id AS group_customer_id,
        bg.id AS group_snapshot_id,
        CASE
            WHEN nc.booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN nc.booking_date::date
            ELSE NULL
        END AS normalized_event_date
    FROM normalized_candidates nc
    LEFT JOIN banquet_group_bookings bgb ON bgb.booking_id = nc.booking_id
    LEFT JOIN banquet_groups bg ON bg.id = bgb.group_id
),
copy_rows AS (
    SELECT
        ec.*,
        COALESCE(ec.group_primary_booking_id, ec.booking_id) AS resolved_primary_booking_id,
        COALESCE(ec.group_customer_id, ec.customer_id) AS resolved_customer_id,
        COALESCE(ec.group_snapshot_id, ec.group_primary_booking_id, ec.booking_id) AS resolved_banquet_number
    FROM enriched_candidates ec
)
INSERT INTO banquet_deposits (
    business_context,
    banquet_group_id,
    primary_booking_id,
    lead_id,
    customer_id,
    accountant_task_id,
    client_name_snapshot,
    event_date,
    banquet_number_snapshot,
    amount,
    payment_method,
    status,
    source_kind,
    source_payload,
    manager_reported_at,
    manager_reported_by,
    verified_at,
    verified_by,
    corrected_at,
    corrected_by,
    finance_transaction_id,
    meta
)
SELECT
    cr.business_context,
    cr.banquet_group_id,
    cr.resolved_primary_booking_id,
    lead_match.lead_id,
    cr.resolved_customer_id,
    NULL,
    COALESCE(NULLIF(c.name, ''), NULLIF(lead_match.client_name, ''), NULLIF(cr.booking_label, ''), NULLIF(cr.group_name, '')),
    cr.normalized_event_date,
    cr.resolved_banquet_number,
    cr.normalized_amount,
    cr.normalized_payment_method,
    'manager_reported',
    'legacy_booking_extra_data',
    jsonb_build_object(
        'migration', '269_banquet_deposits',
        'copy_rule', 'explicit_bookings_extra_data_only',
        'source_table', 'bookings',
        'source_booking_id', cr.booking_id,
        'source_path', cr.source_path,
        'source_value', cr.source_value,
        'all_explicit_deposit_markers', am.markers
    ),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_strip_nulls(
        jsonb_build_object(
            'data_scope', 'explicit deposit JSON in bookings.extra_data only',
            'selected_source_rank', cr.source_rank,
            'original_extra_data', cr.original_extra_data,
            'booking_context', jsonb_strip_nulls(
                jsonb_build_object(
                    'booking_id', cr.booking_id,
                    'business_context', cr.business_context,
                    'date', cr.booking_date,
                    'created_at', cr.booking_created_at,
                    'updated_at', cr.booking_updated_at,
                    'payment_method', cr.booking_payment_method,
                    'payment_status', cr.booking_payment_status,
                    'paid_amount', cr.booking_paid_amount
                )
            ),
            'amount_parse', jsonb_strip_nulls(
                jsonb_build_object(
                    'raw_amount', cr.raw_amount_text,
                    'cleaned_amount', cr.cleaned_amount_text,
                    'parsed_amount', cr.parsed_amount
                )
            ),
            'payment_method_parse', jsonb_strip_nulls(
                jsonb_build_object(
                    'raw_payment_method', cr.raw_payment_method_text,
                    'normalized_payment_method', cr.normalized_payment_method
                )
            ),
            'paid_amount_ignored', COALESCE(cr.booking_paid_amount, 0) > 0,
            'payment_status_ignored', COALESCE(NULLIF(cr.booking_payment_status, 'pending'), '') <> ''
        )
    )
FROM copy_rows cr
JOIN all_markers am ON am.booking_id = cr.booking_id
LEFT JOIN customers c ON c.id = cr.resolved_customer_id
LEFT JOIN LATERAL (
    SELECT lead_source.lead_id, lead_source.client_name
    FROM (
        SELECT l.id AS lead_id, l.client_name, 0 AS priority
        FROM leads l
        WHERE l.booking_id = cr.booking_id
          AND COALESCE(l.business_context, cr.business_context) = cr.business_context

        UNION ALL

        SELECT l.id AS lead_id, l.client_name, 1 AS priority
        FROM leads l
        WHERE c.lead_id IS NOT NULL
          AND l.id = c.lead_id
          AND COALESCE(l.business_context, cr.business_context) = cr.business_context

        UNION ALL

        SELECT l.id AS lead_id, l.client_name, 2 AS priority
        FROM lead_customer_links lcl
        JOIN leads l ON l.id = lcl.lead_id
        WHERE cr.resolved_customer_id IS NOT NULL
          AND lcl.customer_id = cr.resolved_customer_id
          AND COALESCE(lcl.business_context, cr.business_context) = cr.business_context
          AND COALESCE(l.business_context, cr.business_context) = cr.business_context
    ) lead_source
    ORDER BY lead_source.priority, lead_source.lead_id
    LIMIT 1
) AS lead_match ON true
ON CONFLICT DO NOTHING;
