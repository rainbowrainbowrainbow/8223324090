-- Timeline banquet orphan bookings inventory
-- Production impact: yes, read-only only.
--
-- Goal:
-- Find standalone bookings that look like they should belong to an existing
-- banquet group but are not attached to banquet_group_bookings and are not
-- covered by legacy booking_banquet_links.
--
-- How to run:
--   psql "$DATABASE_URL" -f docs/TIMELINE_BANQUET_ORPHAN_BOOKINGS_INVENTORY_READONLY_2026-06-24.sql
--
-- Safety:
-- - This script starts a READ ONLY transaction.
-- - It contains SELECT statements only.
-- - It does not attach, update, merge, delete, or repair any booking.
--
-- Manual repair rule after review:
-- - If the standalone row is truly a kitchen/menu/service member, attach it
--   through POST /api/banquets/:groupId/bookings with role "kitchen" or
--   recreate via POST /api/banquets/:groupId/member-booking when a new
--   canonical member must be created.
-- - If the standalone row is truly an activity member, attach it through
--   POST /api/banquets/:groupId/bookings with role "activity" or recreate via
--   POST /api/banquets/:groupId/activity-booking when a new canonical activity
--   must be created.
-- - Do not auto-merge based only on same customer/date/room/time proximity.
-- - Keep original standalone booking id and source payload available for audit.

BEGIN TRANSACTION READ ONLY;

-- 1) Schema evidence for operators.
-- This confirms which durable/legacy fields exist on the current DB.
SELECT
    'schema_check' AS report_section,
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'bookings',
      'banquet_groups',
      'banquet_group_bookings',
      'booking_banquet_links'
  )
  AND column_name IN (
      'id',
      'business_context',
      'booking_id',
      'group_id',
      'primary_booking_id',
      'customer_id',
      'date',
      'time',
      'duration',
      'room',
      'line_id',
      'linked_to',
      'extra_data',
      'relation_type',
      'role',
      'status'
  )
ORDER BY table_name, ordinal_position;

-- 2) Detailed suspect list with zero-safe counts repeated on every row.
WITH booking_base AS (
    SELECT
        b.id AS booking_id,
        COALESCE(b.business_context, 'event_genix') AS business_context,
        b.date,
        b.time,
        CASE
            WHEN b.time ~ '^[0-9]{1,2}:[0-9]{2}' THEN
                split_part(b.time, ':', 1)::int * 60
                + split_part(b.time, ':', 2)::int
            ELSE NULL
        END AS start_minute,
        CASE
            WHEN b.time ~ '^[0-9]{1,2}:[0-9]{2}' THEN
                split_part(b.time, ':', 1)::int * 60
                + split_part(b.time, ':', 2)::int
                + GREATEST(COALESCE(b.duration, 0), 0)
            ELSE NULL
        END AS end_minute,
        b.duration,
        b.customer_id,
        c.name AS customer_name,
        b.room,
        b.line_id,
        b.label,
        b.program_name,
        b.program_code,
        b.category,
        b.status,
        NULLIF(b.linked_to, '') AS linked_to,
        b.group_name,
        b.banquet_guests,
        b.banquet_adults,
        b.banquet_tables,
        b.banquet_menu,
        b.extra_data,
        COALESCE(
            b.extra_data #>> '{banquetGroup,groupId}',
            b.extra_data #>> '{banquetGroup,group_id}',
            b.extra_data #>> '{banquet_group,groupId}',
            b.extra_data #>> '{banquet_group,group_id}'
        ) AS extra_banquet_group_id,
        COALESCE(
            b.extra_data #>> '{banquetGroup,sourceBookingId}',
            b.extra_data #>> '{banquetGroup,source_booking_id}',
            b.extra_data #>> '{banquet_group,sourceBookingId}',
            b.extra_data #>> '{banquet_group,source_booking_id}',
            b.extra_data #>> '{bookingWorkspace,sourceBookingId}',
            b.extra_data #>> '{bookingWorkspace,source_booking_id}',
            b.extra_data #>> '{booking_workspace,sourceBookingId}',
            b.extra_data #>> '{booking_workspace,source_booking_id}'
        ) AS extra_source_booking_id,
        COALESCE(
            b.extra_data #>> '{banquetGroup,role}',
            b.extra_data #>> '{banquet_group,role}'
        ) AS extra_banquet_role,
        COALESCE(
            b.extra_data #>> '{bookingWorkspace,scenario}',
            b.extra_data #>> '{booking_workspace,scenario}'
        ) AS workspace_scenario,
        CASE
            WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,menuPositions}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{bookingPackage,menuPositions}')
            WHEN jsonb_typeof(b.extra_data #> '{booking_package,menu_positions}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{booking_package,menu_positions}')
            ELSE 0
        END AS menu_position_count,
        CASE
            WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,serviceEvents}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{bookingPackage,serviceEvents}')
            WHEN jsonb_typeof(b.extra_data #> '{booking_package,service_events}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{booking_package,service_events}')
            ELSE 0
        END AS service_event_count
    FROM bookings b
    LEFT JOIN customers c
        ON c.id = b.customer_id
       AND COALESCE(c.business_context, 'event_genix') = COALESCE(b.business_context, 'event_genix')
),
booking_flags AS (
    SELECT
        bb.*,
        LOWER(COALESCE(bb.category, '')) AS category_key,
        LOWER(COALESCE(bb.program_code, '')) AS program_code_key,
        LOWER(COALESCE(bb.workspace_scenario, '')) AS scenario_key,
        LOWER(CONCAT_WS(' ', bb.label, bb.program_name, bb.group_name, bb.customer_name)) AS title_key,
        (
            LOWER(COALESCE(bb.category, '')) IN ('kitchen', 'food', 'menu', 'banquet')
            OR LOWER(COALESCE(bb.program_code, '')) = 'kitchen'
            OR LOWER(COALESCE(bb.workspace_scenario, '')) IN ('kitchen_only', 'event_kitchen')
            OR bb.menu_position_count > 0
            OR bb.service_event_count > 0
            OR NULLIF(bb.banquet_menu, '') IS NOT NULL
            OR bb.banquet_guests IS NOT NULL
            OR bb.banquet_adults IS NOT NULL
            OR bb.banquet_tables IS NOT NULL
        ) AS kitchen_like,
        (
            LOWER(COALESCE(bb.category, '')) IN ('activity', 'animation', 'quest', 'show')
            OR LOWER(CONCAT_WS(' ', bb.label, bb.program_name, bb.program_code)) ~ '(маф|quest|квест|анім|anim|activity|гра)'
        ) AS activity_like
    FROM booking_base bb
),
legacy_linked_booking_ids AS (
    SELECT COALESCE(business_context, 'event_genix') AS business_context, booking_a_id AS booking_id
    FROM booking_banquet_links
    UNION
    SELECT COALESCE(business_context, 'event_genix') AS business_context, booking_b_id AS booking_id
    FROM booking_banquet_links
),
group_profiles AS (
    SELECT
        bg.id AS group_id,
        COALESCE(bg.business_context, 'event_genix') AS business_context,
        bg.primary_booking_id,
        bg.customer_id AS group_customer_id,
        COALESCE(bg.customer_id, primary_booking.customer_id) AS effective_customer_id,
        bg.date AS group_date,
        bg.room AS group_room,
        bg.group_name,
        bg.status AS group_status,
        primary_booking.customer_name AS primary_customer_name,
        primary_booking.room AS primary_room,
        primary_booking.line_id AS primary_line_id,
        primary_booking.time AS primary_time,
        primary_booking.start_minute AS primary_start_minute,
        primary_booking.end_minute AS primary_end_minute,
        MIN(member_booking.start_minute) FILTER (WHERE member_booking.start_minute IS NOT NULL) AS group_start_minute,
        MAX(member_booking.end_minute) FILTER (WHERE member_booking.end_minute IS NOT NULL) AS group_end_minute,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT member_booking.room), NULL) AS member_rooms,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT member_booking.line_id), NULL) AS member_line_ids,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT bgb.booking_id), NULL) AS member_booking_ids,
        COUNT(DISTINCT bgb.booking_id) AS member_count
    FROM banquet_groups bg
    LEFT JOIN booking_flags primary_booking
        ON primary_booking.booking_id = bg.primary_booking_id
       AND primary_booking.business_context = COALESCE(bg.business_context, 'event_genix')
    LEFT JOIN banquet_group_bookings bgb
        ON bgb.group_id = bg.id
       AND COALESCE(bgb.business_context, 'event_genix') = COALESCE(bg.business_context, 'event_genix')
    LEFT JOIN booking_flags member_booking
        ON member_booking.booking_id = bgb.booking_id
       AND member_booking.business_context = COALESCE(bg.business_context, 'event_genix')
    WHERE bg.status = 'active'
    GROUP BY
        bg.id,
        COALESCE(bg.business_context, 'event_genix'),
        bg.primary_booking_id,
        bg.customer_id,
        bg.date,
        bg.room,
        bg.group_name,
        bg.status,
        primary_booking.customer_id,
        primary_booking.customer_name,
        primary_booking.room,
        primary_booking.line_id,
        primary_booking.time,
        primary_booking.start_minute,
        primary_booking.end_minute
),
standalone_candidates AS (
    SELECT bf.*
    FROM booking_flags bf
    LEFT JOIN banquet_group_bookings bgb
        ON bgb.booking_id = bf.booking_id
       AND COALESCE(bgb.business_context, 'event_genix') = bf.business_context
    LEFT JOIN legacy_linked_booking_ids lli
        ON lli.booking_id = bf.booking_id
       AND lli.business_context = bf.business_context
    WHERE bgb.booking_id IS NULL
      AND lli.booking_id IS NULL
      AND bf.linked_to IS NULL
      AND bf.extra_banquet_group_id IS NULL
      AND bf.extra_source_booking_id IS NULL
      AND COALESCE(LOWER(bf.status), '') <> 'cancelled'
),
scored_pairs AS (
    SELECT
        cand.*,
        gp.group_id AS candidate_group_id,
        gp.primary_booking_id AS candidate_primary_booking_id,
        gp.group_name AS candidate_group_name,
        gp.effective_customer_id AS candidate_group_customer_id,
        gp.primary_customer_name AS candidate_primary_customer_name,
        gp.group_room AS candidate_group_room,
        gp.primary_room AS candidate_primary_room,
        gp.primary_line_id AS candidate_primary_line_id,
        gp.member_booking_ids AS candidate_member_booking_ids,
        gp.member_count AS candidate_member_count,
        (
            cand.customer_id IS NOT NULL
            AND gp.effective_customer_id IS NOT NULL
            AND cand.customer_id = gp.effective_customer_id
        ) AS same_customer,
        (
            NULLIF(LOWER(cand.room), '') IS NOT NULL
            AND (
                LOWER(cand.room) = LOWER(COALESCE(gp.group_room, ''))
                OR LOWER(cand.room) = LOWER(COALESCE(gp.primary_room, ''))
                OR LOWER(cand.room) = ANY(ARRAY(SELECT LOWER(member_room.value) FROM unnest(gp.member_rooms) AS member_room(value)))
            )
        ) AS same_room,
        (
            NULLIF(LOWER(cand.line_id), '') IS NOT NULL
            AND (
                LOWER(cand.line_id) = LOWER(COALESCE(gp.primary_line_id, ''))
                OR LOWER(cand.line_id) = ANY(ARRAY(SELECT LOWER(member_line.value) FROM unnest(gp.member_line_ids) AS member_line(value)))
            )
        ) AS same_line,
        (
            NULLIF(cand.title_key, '') IS NOT NULL
            AND (
                (
                    NULLIF(TRIM(gp.primary_customer_name), '') IS NOT NULL
                    AND (
                        cand.title_key LIKE '%' || LOWER(TRIM(gp.primary_customer_name)) || '%'
                        OR LOWER(TRIM(gp.primary_customer_name)) LIKE '%' || cand.title_key || '%'
                    )
                )
                OR (
                    NULLIF(TRIM(gp.group_name), '') IS NOT NULL
                    AND cand.title_key LIKE '%' || LOWER(TRIM(gp.group_name)) || '%'
                )
            )
        ) AS title_match,
        CASE
            WHEN cand.start_minute IS NULL THEN NULL
            WHEN COALESCE(gp.group_start_minute, gp.primary_start_minute) IS NULL THEN NULL
            WHEN cand.start_minute BETWEEN COALESCE(gp.group_start_minute, gp.primary_start_minute)
                AND COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute)
                THEN 0
            ELSE LEAST(
                ABS(cand.start_minute - COALESCE(gp.group_start_minute, gp.primary_start_minute)),
                ABS(cand.start_minute - COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute)),
                ABS(COALESCE(cand.end_minute, cand.start_minute) - COALESCE(gp.group_start_minute, gp.primary_start_minute)),
                ABS(COALESCE(cand.end_minute, cand.start_minute) - COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute))
            )
        END AS distance_minutes
    FROM standalone_candidates cand
    JOIN group_profiles gp
        ON gp.business_context = cand.business_context
       AND gp.group_date = cand.date
       AND gp.group_id IS NOT NULL
       AND gp.primary_booking_id IS DISTINCT FROM cand.booking_id
    WHERE cand.kitchen_like OR cand.activity_like OR cand.customer_id IS NOT NULL
),
filtered_pairs AS (
    SELECT
        sp.*,
        CASE
            WHEN sp.same_customer AND sp.same_room AND COALESCE(sp.distance_minutes, 99999) <= 30 THEN 1
            WHEN sp.same_customer AND COALESCE(sp.distance_minutes, 99999) <= 60 THEN 2
            WHEN sp.same_room AND COALESCE(sp.distance_minutes, 99999) <= 60 AND (sp.kitchen_like OR sp.activity_like) THEN 3
            WHEN sp.same_customer AND (sp.kitchen_like OR sp.activity_like) AND COALESCE(sp.distance_minutes, 99999) <= 180 THEN 4
            WHEN sp.title_match AND (sp.same_room OR sp.same_line) AND COALESCE(sp.distance_minutes, 99999) <= 180 THEN 5
            ELSE 99
        END AS review_priority
    FROM scored_pairs sp
    WHERE (
        sp.same_customer
        OR sp.same_room
        OR sp.same_line
        OR sp.title_match
    )
      AND COALESCE(sp.distance_minutes, 99999) <= 180
),
best_match AS (
    SELECT *
    FROM (
        SELECT
            fp.*,
            ROW_NUMBER() OVER (
                PARTITION BY fp.business_context, fp.booking_id
                ORDER BY fp.review_priority ASC, fp.distance_minutes ASC NULLS LAST, fp.candidate_group_id ASC
            ) AS match_rank
        FROM filtered_pairs fp
        WHERE fp.review_priority < 99
    ) ranked
    WHERE match_rank = 1
),
report_rows AS (
    SELECT
        *,
        CASE
            WHEN kitchen_like THEN 'kitchen'
            WHEN activity_like THEN 'activity'
            ELSE 'manual'
        END AS suggested_role,
        CASE
            WHEN same_customer AND same_room AND COALESCE(distance_minutes, 99999) <= 30
                THEN 'same customer + same room + close to active banquet'
            WHEN same_customer AND COALESCE(distance_minutes, 99999) <= 60
                THEN 'same customer + close to active banquet'
            WHEN same_room AND kitchen_like
                THEN 'kitchen/menu-like standalone in same room near active banquet'
            WHEN same_room AND activity_like
                THEN 'activity-like standalone in same room near active banquet'
            WHEN title_match
                THEN 'similar title/client text near active banquet'
            ELSE 'possible orphan near active banquet'
        END AS suspected_reason
    FROM best_match
)
SELECT
    'orphan_candidate_detail' AS report_section,
    COUNT(*) OVER () AS total_suspect_count,
    COUNT(*) FILTER (WHERE suggested_role = 'kitchen') OVER () AS kitchen_like_count,
    COUNT(*) FILTER (WHERE suggested_role = 'activity') OVER () AS activity_like_count,
    COUNT(*) FILTER (WHERE review_priority <= 2) OVER () AS high_confidence_count,
    business_context,
    booking_id,
    date,
    CONCAT(time, ' - ', CASE
        WHEN end_minute IS NULL THEN '?'
        ELSE LPAD(((end_minute / 60) % 24)::text, 2, '0') || ':' || LPAD((end_minute % 60)::text, 2, '0')
    END) AS time_range,
    distance_minutes,
    customer_id,
    customer_name,
    room,
    line_id,
    COALESCE(label, program_name, group_name, booking_id) AS title,
    category,
    program_code,
    workspace_scenario,
    menu_position_count,
    service_event_count,
    banquet_guests,
    candidate_group_id,
    candidate_primary_booking_id,
    candidate_group_name,
    candidate_group_customer_id,
    candidate_primary_customer_name,
    candidate_group_room,
    candidate_member_count,
    candidate_member_booking_ids,
    same_customer,
    same_room,
    same_line,
    title_match,
    suggested_role,
    review_priority,
    suspected_reason,
    CASE
        WHEN suggested_role IN ('kitchen', 'activity', 'service', 'manual') THEN
            'Manual review required. If correct, attach existing booking '
            || booking_id || ' to banquet group ' || candidate_group_id
            || ' with role "' || suggested_role
            || '" through POST /api/banquets/:groupId/bookings. Do not combine automatically.'
        ELSE
            'Manual review required before any repair.'
    END AS safe_repair_suggestion
FROM report_rows
ORDER BY review_priority ASC, date ASC, room ASC NULLS LAST, distance_minutes ASC NULLS LAST, booking_id ASC;

-- 3) Compact counts by reason and suggested role.
WITH booking_base AS (
    SELECT
        b.id AS booking_id,
        COALESCE(b.business_context, 'event_genix') AS business_context,
        b.date,
        b.time,
        CASE
            WHEN b.time ~ '^[0-9]{1,2}:[0-9]{2}' THEN
                split_part(b.time, ':', 1)::int * 60
                + split_part(b.time, ':', 2)::int
            ELSE NULL
        END AS start_minute,
        CASE
            WHEN b.time ~ '^[0-9]{1,2}:[0-9]{2}' THEN
                split_part(b.time, ':', 1)::int * 60
                + split_part(b.time, ':', 2)::int
                + GREATEST(COALESCE(b.duration, 0), 0)
            ELSE NULL
        END AS end_minute,
        b.duration,
        b.customer_id,
        c.name AS customer_name,
        b.room,
        b.line_id,
        b.label,
        b.program_name,
        b.program_code,
        b.category,
        b.status,
        NULLIF(b.linked_to, '') AS linked_to,
        b.group_name,
        b.banquet_guests,
        b.banquet_adults,
        b.banquet_tables,
        b.banquet_menu,
        b.extra_data,
        COALESCE(
            b.extra_data #>> '{banquetGroup,groupId}',
            b.extra_data #>> '{banquetGroup,group_id}',
            b.extra_data #>> '{banquet_group,groupId}',
            b.extra_data #>> '{banquet_group,group_id}'
        ) AS extra_banquet_group_id,
        COALESCE(
            b.extra_data #>> '{banquetGroup,sourceBookingId}',
            b.extra_data #>> '{banquetGroup,source_booking_id}',
            b.extra_data #>> '{banquet_group,sourceBookingId}',
            b.extra_data #>> '{banquet_group,source_booking_id}',
            b.extra_data #>> '{bookingWorkspace,sourceBookingId}',
            b.extra_data #>> '{bookingWorkspace,source_booking_id}',
            b.extra_data #>> '{booking_workspace,sourceBookingId}',
            b.extra_data #>> '{booking_workspace,source_booking_id}'
        ) AS extra_source_booking_id,
        COALESCE(
            b.extra_data #>> '{bookingWorkspace,scenario}',
            b.extra_data #>> '{booking_workspace,scenario}'
        ) AS workspace_scenario,
        CASE
            WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,menuPositions}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{bookingPackage,menuPositions}')
            WHEN jsonb_typeof(b.extra_data #> '{booking_package,menu_positions}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{booking_package,menu_positions}')
            ELSE 0
        END AS menu_position_count,
        CASE
            WHEN jsonb_typeof(b.extra_data #> '{bookingPackage,serviceEvents}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{bookingPackage,serviceEvents}')
            WHEN jsonb_typeof(b.extra_data #> '{booking_package,service_events}') = 'array'
                THEN jsonb_array_length(b.extra_data #> '{booking_package,service_events}')
            ELSE 0
        END AS service_event_count
    FROM bookings b
    LEFT JOIN customers c
        ON c.id = b.customer_id
       AND COALESCE(c.business_context, 'event_genix') = COALESCE(b.business_context, 'event_genix')
),
booking_flags AS (
    SELECT
        bb.*,
        LOWER(CONCAT_WS(' ', bb.label, bb.program_name, bb.group_name, bb.customer_name)) AS title_key,
        (
            LOWER(COALESCE(bb.category, '')) IN ('kitchen', 'food', 'menu', 'banquet')
            OR LOWER(COALESCE(bb.program_code, '')) = 'kitchen'
            OR LOWER(COALESCE(bb.workspace_scenario, '')) IN ('kitchen_only', 'event_kitchen')
            OR bb.menu_position_count > 0
            OR bb.service_event_count > 0
            OR NULLIF(bb.banquet_menu, '') IS NOT NULL
            OR bb.banquet_guests IS NOT NULL
            OR bb.banquet_adults IS NOT NULL
            OR bb.banquet_tables IS NOT NULL
        ) AS kitchen_like,
        (
            LOWER(COALESCE(bb.category, '')) IN ('activity', 'animation', 'quest', 'show')
            OR LOWER(CONCAT_WS(' ', bb.label, bb.program_name, bb.program_code)) ~ '(маф|quest|квест|анім|anim|activity|гра)'
        ) AS activity_like
    FROM booking_base bb
),
legacy_linked_booking_ids AS (
    SELECT COALESCE(business_context, 'event_genix') AS business_context, booking_a_id AS booking_id
    FROM booking_banquet_links
    UNION
    SELECT COALESCE(business_context, 'event_genix') AS business_context, booking_b_id AS booking_id
    FROM booking_banquet_links
),
group_profiles AS (
    SELECT
        bg.id AS group_id,
        COALESCE(bg.business_context, 'event_genix') AS business_context,
        bg.primary_booking_id,
        COALESCE(bg.customer_id, primary_booking.customer_id) AS effective_customer_id,
        bg.date AS group_date,
        bg.room AS group_room,
        bg.group_name,
        primary_booking.customer_name AS primary_customer_name,
        primary_booking.room AS primary_room,
        primary_booking.line_id AS primary_line_id,
        primary_booking.start_minute AS primary_start_minute,
        primary_booking.end_minute AS primary_end_minute,
        MIN(member_booking.start_minute) FILTER (WHERE member_booking.start_minute IS NOT NULL) AS group_start_minute,
        MAX(member_booking.end_minute) FILTER (WHERE member_booking.end_minute IS NOT NULL) AS group_end_minute,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT member_booking.room), NULL) AS member_rooms,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT member_booking.line_id), NULL) AS member_line_ids
    FROM banquet_groups bg
    LEFT JOIN booking_flags primary_booking
        ON primary_booking.booking_id = bg.primary_booking_id
       AND primary_booking.business_context = COALESCE(bg.business_context, 'event_genix')
    LEFT JOIN banquet_group_bookings bgb
        ON bgb.group_id = bg.id
       AND COALESCE(bgb.business_context, 'event_genix') = COALESCE(bg.business_context, 'event_genix')
    LEFT JOIN booking_flags member_booking
        ON member_booking.booking_id = bgb.booking_id
       AND member_booking.business_context = COALESCE(bg.business_context, 'event_genix')
    WHERE bg.status = 'active'
    GROUP BY
        bg.id,
        COALESCE(bg.business_context, 'event_genix'),
        bg.primary_booking_id,
        bg.customer_id,
        bg.date,
        bg.room,
        bg.group_name,
        primary_booking.customer_id,
        primary_booking.customer_name,
        primary_booking.room,
        primary_booking.line_id,
        primary_booking.start_minute,
        primary_booking.end_minute
),
standalone_candidates AS (
    SELECT bf.*
    FROM booking_flags bf
    LEFT JOIN banquet_group_bookings bgb
        ON bgb.booking_id = bf.booking_id
       AND COALESCE(bgb.business_context, 'event_genix') = bf.business_context
    LEFT JOIN legacy_linked_booking_ids lli
        ON lli.booking_id = bf.booking_id
       AND lli.business_context = bf.business_context
    WHERE bgb.booking_id IS NULL
      AND lli.booking_id IS NULL
      AND bf.linked_to IS NULL
      AND bf.extra_banquet_group_id IS NULL
      AND bf.extra_source_booking_id IS NULL
      AND COALESCE(LOWER(bf.status), '') <> 'cancelled'
),
scored_pairs AS (
    SELECT
        cand.*,
        gp.group_id AS candidate_group_id,
        (
            cand.customer_id IS NOT NULL
            AND gp.effective_customer_id IS NOT NULL
            AND cand.customer_id = gp.effective_customer_id
        ) AS same_customer,
        (
            NULLIF(LOWER(cand.room), '') IS NOT NULL
            AND (
                LOWER(cand.room) = LOWER(COALESCE(gp.group_room, ''))
                OR LOWER(cand.room) = LOWER(COALESCE(gp.primary_room, ''))
                OR LOWER(cand.room) = ANY(ARRAY(SELECT LOWER(member_room.value) FROM unnest(gp.member_rooms) AS member_room(value)))
            )
        ) AS same_room,
        (
            NULLIF(LOWER(cand.line_id), '') IS NOT NULL
            AND (
                LOWER(cand.line_id) = LOWER(COALESCE(gp.primary_line_id, ''))
                OR LOWER(cand.line_id) = ANY(ARRAY(SELECT LOWER(member_line.value) FROM unnest(gp.member_line_ids) AS member_line(value)))
            )
        ) AS same_line,
        (
            NULLIF(cand.title_key, '') IS NOT NULL
            AND (
                (
                    NULLIF(TRIM(gp.primary_customer_name), '') IS NOT NULL
                    AND (
                        cand.title_key LIKE '%' || LOWER(TRIM(gp.primary_customer_name)) || '%'
                        OR LOWER(TRIM(gp.primary_customer_name)) LIKE '%' || cand.title_key || '%'
                    )
                )
                OR (
                    NULLIF(TRIM(gp.group_name), '') IS NOT NULL
                    AND cand.title_key LIKE '%' || LOWER(TRIM(gp.group_name)) || '%'
                )
            )
        ) AS title_match,
        CASE
            WHEN cand.start_minute IS NULL THEN NULL
            WHEN COALESCE(gp.group_start_minute, gp.primary_start_minute) IS NULL THEN NULL
            WHEN cand.start_minute BETWEEN COALESCE(gp.group_start_minute, gp.primary_start_minute)
                AND COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute)
                THEN 0
            ELSE LEAST(
                ABS(cand.start_minute - COALESCE(gp.group_start_minute, gp.primary_start_minute)),
                ABS(cand.start_minute - COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute)),
                ABS(COALESCE(cand.end_minute, cand.start_minute) - COALESCE(gp.group_start_minute, gp.primary_start_minute)),
                ABS(COALESCE(cand.end_minute, cand.start_minute) - COALESCE(gp.group_end_minute, gp.primary_end_minute, gp.group_start_minute, gp.primary_start_minute))
            )
        END AS distance_minutes
    FROM standalone_candidates cand
    JOIN group_profiles gp
        ON gp.business_context = cand.business_context
       AND gp.group_date = cand.date
       AND gp.group_id IS NOT NULL
       AND gp.primary_booking_id IS DISTINCT FROM cand.booking_id
    WHERE cand.kitchen_like OR cand.activity_like OR cand.customer_id IS NOT NULL
),
filtered_pairs AS (
    SELECT
        sp.*,
        CASE
            WHEN sp.same_customer AND sp.same_room AND COALESCE(sp.distance_minutes, 99999) <= 30 THEN 1
            WHEN sp.same_customer AND COALESCE(sp.distance_minutes, 99999) <= 60 THEN 2
            WHEN sp.same_room AND COALESCE(sp.distance_minutes, 99999) <= 60 AND (sp.kitchen_like OR sp.activity_like) THEN 3
            WHEN sp.same_customer AND (sp.kitchen_like OR sp.activity_like) AND COALESCE(sp.distance_minutes, 99999) <= 180 THEN 4
            WHEN sp.title_match AND (sp.same_room OR sp.same_line) AND COALESCE(sp.distance_minutes, 99999) <= 180 THEN 5
            ELSE 99
        END AS review_priority
    FROM scored_pairs sp
    WHERE (
        sp.same_customer
        OR sp.same_room
        OR sp.same_line
        OR sp.title_match
    )
      AND COALESCE(sp.distance_minutes, 99999) <= 180
),
best_match AS (
    SELECT *
    FROM (
        SELECT
            fp.*,
            ROW_NUMBER() OVER (
                PARTITION BY fp.business_context, fp.booking_id
                ORDER BY fp.review_priority ASC, fp.distance_minutes ASC NULLS LAST, fp.candidate_group_id ASC
            ) AS match_rank
        FROM filtered_pairs fp
        WHERE fp.review_priority < 99
    ) ranked
    WHERE match_rank = 1
),
report_rows AS (
    SELECT
        *,
        CASE
            WHEN kitchen_like THEN 'kitchen'
            WHEN activity_like THEN 'activity'
            ELSE 'manual'
        END AS suggested_role,
        CASE
            WHEN same_customer AND same_room AND COALESCE(distance_minutes, 99999) <= 30
                THEN 'same customer + same room + close to active banquet'
            WHEN same_customer AND COALESCE(distance_minutes, 99999) <= 60
                THEN 'same customer + close to active banquet'
            WHEN same_room AND kitchen_like
                THEN 'kitchen/menu-like standalone in same room near active banquet'
            WHEN same_room AND activity_like
                THEN 'activity-like standalone in same room near active banquet'
            WHEN title_match
                THEN 'similar title/client text near active banquet'
            ELSE 'possible orphan near active banquet'
        END AS suspected_reason
    FROM best_match
)
SELECT
    'orphan_candidate_counts' AS report_section,
    business_context,
    suspected_reason,
    suggested_role,
    COUNT(*) AS suspect_count,
    MIN(distance_minutes) AS min_distance_minutes,
    MAX(distance_minutes) AS max_distance_minutes,
    COUNT(*) FILTER (WHERE review_priority <= 2) AS high_confidence_count
FROM report_rows
GROUP BY business_context, suspected_reason, suggested_role
ORDER BY suspect_count DESC, business_context, suspected_reason, suggested_role;

COMMIT;
