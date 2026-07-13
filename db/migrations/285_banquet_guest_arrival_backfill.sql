-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently fills only NULL arrival values and materializes only legacy link components with exactly one active root banquet anchor and a valid HH:mm time; ambiguous records remain unchanged for operator review.
-- ROLLBACK: Keep copied arrival data. If application rollback is required, disable the Release A writer first; legacy groups created by this migration are identified by source='arrival_backfill_285' and should only be removed after a fresh audit and explicit operator approval.
-- DATA_SCOPE: Active banquet_groups with guest_arrival_time IS NULL plus ungrouped booking_banquet_links relation_type='banquet_activity'; no booking rows are updated.

-- Keep the deterministic component snapshot stable while the short backfill runs.
LOCK TABLE banquet_groups, banquet_group_bookings IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE booking_banquet_links IN SHARE MODE;

CREATE TEMP TABLE tmp_banquet_arrival_285_legacy_components
ON COMMIT DROP
AS
WITH RECURSIVE
legacy_edges AS (
    SELECT
        CASE
            WHEN LOWER(COALESCE(NULLIF(BTRIM(l.business_context), ''), 'event_genix')) IN ('park_zakrevsky', 'park', 'pzp') THEN 'event_genix'
            ELSE LOWER(COALESCE(NULLIF(BTRIM(l.business_context), ''), 'event_genix'))
        END AS business_context,
        l.booking_a_id,
        l.booking_b_id
    FROM booking_banquet_links l
    WHERE l.relation_type = 'banquet_activity'
      AND l.booking_a_id <> l.booking_b_id
),
legacy_nodes AS (
    SELECT business_context, booking_a_id AS booking_id FROM legacy_edges
    UNION
    SELECT business_context, booking_b_id AS booking_id FROM legacy_edges
),
reachable AS (
    SELECT business_context, booking_id AS origin_booking_id, booking_id AS reachable_booking_id
    FROM legacy_nodes
    UNION
    SELECT
        r.business_context,
        r.origin_booking_id,
        CASE
            WHEN e.booking_a_id = r.reachable_booking_id THEN e.booking_b_id
            ELSE e.booking_a_id
        END AS reachable_booking_id
    FROM reachable r
    JOIN legacy_edges e
      ON e.business_context = r.business_context
     AND (e.booking_a_id = r.reachable_booking_id OR e.booking_b_id = r.reachable_booking_id)
),
node_components AS (
    SELECT business_context, origin_booking_id AS booking_id, MIN(reachable_booking_id) AS component_key
    FROM reachable
    GROUP BY business_context, origin_booking_id
),
component_bookings AS (
    SELECT
        nc.business_context,
        nc.component_key,
        b.id,
        b.date,
        b.time,
        b.line_id,
        b.program_id,
        b.program_code,
        b.label,
        b.program_name,
        b.category,
        b.price,
        b.room,
        b.linked_to,
        b.status,
        b.group_name,
        b.extra_data,
        b.customer_id,
        b.banquet_guests,
        b.banquet_adults,
        b.banquet_tables,
        b.banquet_menu,
        CASE
            WHEN b.linked_to IS NULL OR BTRIM(b.linked_to) = '' THEN true
            ELSE false
        END AS is_root,
        CASE
            WHEN LOWER(COALESCE(NULLIF(BTRIM(b.status), ''), 'confirmed')) <> 'cancelled' THEN true
            ELSE false
        END AS is_active,
        CASE
            WHEN
                b.line_id = 'banquet-service'
                OR b.banquet_menu IS NOT NULL AND BTRIM(b.banquet_menu) <> ''
                OR b.banquet_guests IS NOT NULL
                OR b.banquet_adults IS NOT NULL
                OR b.banquet_tables IS NOT NULL
                OR LOWER(COALESCE(BTRIM(b.category), '')) = 'banquet'
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,menuPositions}') = 'array' THEN b.extra_data #> '{bookingPackage,menuPositions}' ELSE '[]'::jsonb END), 0) > 0
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{booking_package,menu_positions}') = 'array' THEN b.extra_data #> '{booking_package,menu_positions}' ELSE '[]'::jsonb END), 0) > 0
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,serviceEvents}') = 'array' THEN b.extra_data #> '{bookingPackage,serviceEvents}' ELSE '[]'::jsonb END), 0) > 0
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{booking_package,service_events}') = 'array' THEN b.extra_data #> '{booking_package,service_events}' ELSE '[]'::jsonb END), 0) > 0
                OR LOWER(CONCAT_WS(' ', b.category, b.label, b.program_name, b.program_code, b.group_name)) ~ '(banquet|kitchen|банкет|кух)'
            THEN true
            ELSE false
        END AS is_banquet_anchor,
        CASE
            WHEN
                (b.banquet_menu IS NOT NULL AND BTRIM(b.banquet_menu) <> '')
                OR b.banquet_guests IS NOT NULL
                OR b.banquet_adults IS NOT NULL
                OR b.banquet_tables IS NOT NULL
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,menuPositions}') = 'array' THEN b.extra_data #> '{bookingPackage,menuPositions}' ELSE '[]'::jsonb END), 0) > 0
                OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{booking_package,menu_positions}') = 'array' THEN b.extra_data #> '{booking_package,menu_positions}' ELSE '[]'::jsonb END), 0) > 0
            THEN true
            ELSE false
        END AS is_kitchen_candidate
    FROM node_components nc
    JOIN bookings b
      ON b.id = nc.booking_id
     AND CASE
            WHEN LOWER(COALESCE(NULLIF(BTRIM(b.business_context), ''), 'event_genix')) IN ('park_zakrevsky', 'park', 'pzp') THEN 'event_genix'
            ELSE LOWER(COALESCE(NULLIF(BTRIM(b.business_context), ''), 'event_genix'))
         END = nc.business_context
),
eligible_components AS (
    SELECT
        cb.business_context,
        cb.component_key,
        MIN(cb.id) FILTER (WHERE cb.is_banquet_anchor) AS anchor_booking_id,
        ARRAY_AGG(cb.id ORDER BY cb.id) AS booking_ids,
        COUNT(*) AS booking_count,
        COUNT(*) FILTER (WHERE cb.is_root AND cb.is_active) AS supported_booking_count,
        COUNT(*) FILTER (WHERE cb.is_root AND cb.is_active AND cb.is_banquet_anchor) AS anchor_count,
        COUNT(bgb.id) AS existing_membership_count
    FROM component_bookings cb
    LEFT JOIN banquet_group_bookings bgb ON bgb.booking_id = cb.id
    GROUP BY cb.business_context, cb.component_key
    HAVING COUNT(*) = COUNT(*) FILTER (WHERE cb.is_root AND cb.is_active)
       AND COUNT(*) FILTER (WHERE cb.is_root AND cb.is_active AND cb.is_banquet_anchor) = 1
       AND COUNT(bgb.id) = 0
),
resolved_components AS (
    SELECT
        ec.business_context,
        ec.component_key,
        ec.anchor_booking_id,
        ec.booking_ids,
        a.time AS guest_arrival_time,
        a.customer_id,
        a.date,
        a.room,
        COALESCE(NULLIF(BTRIM(a.group_name), ''), NULLIF(BTRIM(a.label), ''), NULLIF(BTRIM(a.program_name), '')) AS group_name,
        ('BQA285-' || UPPER(SUBSTRING(MD5(ec.business_context || CHR(1) || ec.component_key), 1, 32)))::varchar(50) AS group_id
    FROM eligible_components ec
    JOIN bookings a ON a.id = ec.anchor_booking_id
    WHERE a.time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
)
SELECT * FROM resolved_components;

INSERT INTO banquet_groups (
    id, business_context, primary_booking_id, customer_id, date, room,
    guest_arrival_time, group_name, status, source, meta, created_by, updated_by
)
SELECT
    rc.group_id,
    rc.business_context,
    rc.anchor_booking_id,
    rc.customer_id,
    rc.date,
    rc.room,
    rc.guest_arrival_time,
    rc.group_name,
    'active',
    'arrival_backfill_285',
    jsonb_build_object(
        'migration', '285_banquet_guest_arrival_backfill',
        'legacyComponentKey', rc.component_key,
        'resolver', 'single_banquet_anchor'
    ),
    'migration_285_banquet_guest_arrival_backfill',
    'migration_285_banquet_guest_arrival_backfill'
FROM tmp_banquet_arrival_285_legacy_components rc
ON CONFLICT (id) DO NOTHING;

INSERT INTO banquet_group_bookings (
    group_id, business_context, booking_id, role, sort_order, created_by
)
SELECT
    rc.group_id,
    rc.business_context,
    b.id,
    CASE
        WHEN b.id = rc.anchor_booking_id THEN 'primary'
        WHEN b.line_id <> 'banquet-service'
             AND LOWER(COALESCE(BTRIM(b.category), '')) IN ('activity', 'animation', 'show', 'quest', 'masterclass', 'pinata', 'photo', 'graduation') THEN 'activity'
        WHEN
            (b.banquet_menu IS NOT NULL AND BTRIM(b.banquet_menu) <> '')
            OR b.banquet_guests IS NOT NULL
            OR b.banquet_adults IS NOT NULL
            OR b.banquet_tables IS NOT NULL
            OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,menuPositions}') = 'array' THEN b.extra_data #> '{bookingPackage,menuPositions}' ELSE '[]'::jsonb END), 0) > 0
            OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(b.extra_data #> '{booking_package,menu_positions}') = 'array' THEN b.extra_data #> '{booking_package,menu_positions}' ELSE '[]'::jsonb END), 0) > 0
            THEN 'kitchen'
        WHEN b.line_id = 'banquet-service' THEN 'service'
        WHEN b.line_id <> 'banquet-service'
             AND (b.program_id IS NOT NULL OR NULLIF(BTRIM(COALESCE(b.program_name, '')), '') IS NOT NULL OR NULLIF(BTRIM(COALESCE(b.program_code, '')), '') IS NOT NULL OR COALESCE(b.price, 0) > 0)
             THEN 'activity'
        ELSE 'manual'
    END,
    CASE WHEN b.id = rc.anchor_booking_id THEN 10 ELSE 100 END,
    'migration_285_banquet_guest_arrival_backfill'
FROM tmp_banquet_arrival_285_legacy_components rc
JOIN banquet_groups bg
  ON bg.id = rc.group_id
 AND bg.source = 'arrival_backfill_285'
 AND bg.meta->>'legacyComponentKey' = rc.component_key
JOIN bookings b
  ON b.id = ANY(rc.booking_ids)
ON CONFLICT DO NOTHING;

WITH explicit_primary_stats AS (
    SELECT
        bg.id AS group_id,
        COUNT(*) FILTER (WHERE bgb.role = 'primary') AS explicit_primary_count,
        MIN(b.time) FILTER (WHERE bgb.role = 'primary') AS explicit_primary_time
    FROM banquet_groups bg
    LEFT JOIN banquet_group_bookings bgb
      ON bgb.group_id = bg.id
    LEFT JOIN bookings b
      ON b.id = bgb.booking_id
    WHERE LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
      AND bg.guest_arrival_time IS NULL
    GROUP BY bg.id
),
resolved_group_arrivals AS (
    SELECT
        bg.id AS group_id,
        CASE
            WHEN eps.explicit_primary_count = 1
                 AND eps.explicit_primary_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                THEN eps.explicit_primary_time
            WHEN eps.explicit_primary_count = 0
                 AND pb.time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                THEN pb.time
            ELSE NULL
        END AS guest_arrival_time
    FROM banquet_groups bg
    JOIN explicit_primary_stats eps ON eps.group_id = bg.id
    LEFT JOIN bookings pb
      ON pb.id = bg.primary_booking_id
    WHERE bg.guest_arrival_time IS NULL
      AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
)
UPDATE banquet_groups bg
SET guest_arrival_time = rga.guest_arrival_time,
    updated_at = NOW(),
    updated_by = 'migration_285_banquet_guest_arrival_backfill'
FROM resolved_group_arrivals rga
WHERE bg.id = rga.group_id
  AND bg.guest_arrival_time IS NULL
  AND rga.guest_arrival_time IS NOT NULL;
