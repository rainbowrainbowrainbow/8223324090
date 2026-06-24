-- Timeline identity broken rows inventory
-- Production impact: yes
-- READ ONLY: this script only runs SELECT statements.
-- Purpose:
--   Find bookings that can disappear from rooms/animators timelines because
--   their stored line identity, timelineIdentity JSON, linked animator row,
--   or banquet duplicate-marker role is inconsistent.
-- Safety:
--   Do not add UPDATE/DELETE/INSERT/MERGE/TRUNCATE/ALTER/DROP statements.
--   Run on a read-only production connection or replica where possible.
--   Export and review this output before preparing any repair script.
--   This report does not change production data.

WITH params AS (
    SELECT
        NULL::date AS date_from,
        NULL::date AS date_to,
        NULL::text AS business_context_filter
),
scoped_bookings AS (
    SELECT
        b.*,
        CASE
            WHEN lower(COALESCE(NULLIF(btrim(b.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                THEN 'event_genix'
            ELSE lower(COALESCE(NULLIF(btrim(b.business_context), ''), 'event_genix'))
        END AS normalized_business_context,
        lower(COALESCE(NULLIF(btrim(b.status), ''), 'confirmed')) AS normalized_status,
        COALESCE(b.extra_data, '{}'::jsonb) AS normalized_extra_data
    FROM bookings b
    CROSS JOIN params p
    WHERE (p.date_from IS NULL OR b.date >= to_char(p.date_from, 'YYYY-MM-DD'))
      AND (p.date_to IS NULL OR b.date <= to_char(p.date_to, 'YYYY-MM-DD'))
      AND (
          p.business_context_filter IS NULL
          OR CASE
                WHEN lower(COALESCE(NULLIF(btrim(b.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                    THEN 'event_genix'
                ELSE lower(COALESCE(NULLIF(btrim(b.business_context), ''), 'event_genix'))
             END = p.business_context_filter
      )
),
normalized AS (
    SELECT
        sb.*,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,lineId}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,line_id}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,lineId}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,line_id}', '')
        ) AS identity_line_id,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resourceId}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resource_id}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resourceId}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resource_id}', '')
        ) AS identity_resource_id,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resourceName}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resource_name}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,lineName}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,line_name}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resourceName}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resource_name}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,lineName}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,line_name}', '')
        ) AS identity_resource_name,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resourceType}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineIdentity,resource_type}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resourceType}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_identity,resource_type}', '')
        ) AS identity_resource_type,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,displaySurface}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,display_surface}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,displaySurface}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,display_surface}', '')
        ) AS stored_display_surface,
        COALESCE(
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,hiddenReason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,hidden_reason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,hiddenReason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,hidden_reason}', '')
        ) AS stored_hidden_reason,
        COALESCE(
            sb.normalized_extra_data -> 'timelineIdentity',
            sb.normalized_extra_data -> 'timeline_identity',
            '{}'::jsonb
        ) AS timeline_identity,
        COALESCE(
            sb.normalized_extra_data -> 'timelineProjection',
            sb.normalized_extra_data -> 'timeline_projection',
            '{}'::jsonb
        ) AS timeline_projection
    FROM scoped_bookings sb
),
resource_joined AS (
    SELECT
        n.*,
        COALESCE(NULLIF(n.line_id, ''), NULLIF(n.identity_line_id, ''), NULLIF(n.identity_resource_id, '')) AS effective_line_id,
        l.line_id AS matched_lines_by_date_line_id,
        l.name AS matched_lines_by_date_name,
        tr.resource_id AS matched_timeline_resource_id,
        tr.name AS matched_timeline_resource_name,
        tr.type AS matched_timeline_resource_type,
        bgb.group_id AS banquet_group_id,
        bgb.role AS banquet_group_role,
        bg.primary_booking_id AS banquet_group_primary_booking_id,
        bg.status AS banquet_group_status,
        primary_booking.category AS banquet_primary_category,
        primary_booking.extra_data AS banquet_primary_extra_data
    FROM normalized n
    LEFT JOIN lines_by_date l
      ON l.date = n.date
     AND l.line_id = COALESCE(NULLIF(n.line_id, ''), NULLIF(n.identity_line_id, ''), NULLIF(n.identity_resource_id, ''))
     AND CASE
            WHEN lower(COALESCE(NULLIF(btrim(l.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                THEN 'event_genix'
            ELSE lower(COALESCE(NULLIF(btrim(l.business_context), ''), 'event_genix'))
         END = n.normalized_business_context
    LEFT JOIN timeline_resources tr
      ON tr.resource_id = COALESCE(NULLIF(n.line_id, ''), NULLIF(n.identity_line_id, ''), NULLIF(n.identity_resource_id, ''))
     AND COALESCE(tr.is_active, true) = true
     AND CASE
            WHEN lower(COALESCE(NULLIF(btrim(tr.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                THEN 'event_genix'
            ELSE lower(COALESCE(NULLIF(btrim(tr.business_context), ''), 'event_genix'))
         END = n.normalized_business_context
    LEFT JOIN banquet_group_bookings bgb
      ON bgb.booking_id = n.id
    LEFT JOIN banquet_groups bg
      ON bg.id = bgb.group_id
    LEFT JOIN bookings primary_booking
      ON primary_booking.id = bg.primary_booking_id
),
issue_rows AS (
    SELECT
        'missing_line_id' AS issue_type,
        'manual_review' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Row has no stored line_id and no timelineIdentity line/resource id. Do not infer a line; operator must review source evidence.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND COALESCE(NULLIF(rj.line_id, ''), NULLIF(rj.identity_line_id, ''), NULLIF(rj.identity_resource_id, '')) IS NULL
      AND (
          lower(COALESCE(rj.category, '')) IN ('animation', 'activity', 'quest', 'show', 'masterclass', 'workshop', 'custom')
          OR NULLIF(rj.linked_to, '') IS NOT NULL
          OR NULLIF(rj.second_animator, '') IS NOT NULL
      )

    UNION ALL

    SELECT
        'line_id_without_matching_resource' AS issue_type,
        'review_then_repair' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Stored line id has no matching lines_by_date row for this date/business and no active timeline_resources row. Restore only from explicit date/resource evidence.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND NULLIF(rj.effective_line_id, '') IS NOT NULL
      AND rj.matched_lines_by_date_line_id IS NULL
      AND rj.matched_timeline_resource_id IS NULL
      AND rj.effective_line_id NOT IN ('banquet-service')

    UNION ALL

    SELECT
        'timeline_identity_line_mismatch' AS issue_type,
        'review_then_repair' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'bookings.line_id differs from timelineIdentity.lineId. Choose canonical value from reviewed create/reload evidence; preserve previous JSON under repair metadata.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND NULLIF(rj.line_id, '') IS NOT NULL
      AND NULLIF(rj.identity_line_id, '') IS NOT NULL
      AND rj.identity_line_id IS DISTINCT FROM rj.line_id

    UNION ALL

    SELECT
        'timeline_identity_resource_mismatch' AS issue_type,
        'review_then_repair' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'timelineIdentity.resourceId differs from bookings.line_id. Repair only after confirming whether this row belongs to lines_by_date or timeline_resources.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND NULLIF(rj.line_id, '') IS NOT NULL
      AND NULLIF(rj.identity_resource_id, '') IS NOT NULL
      AND rj.identity_resource_id IS DISTINCT FROM rj.line_id

    UNION ALL

    SELECT
        'stored_missing_animator_resource' AS issue_type,
        'rerun_after_code_fix' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Stored projection says missing_animator_resource. Recheck current API projection first; repair data only if the current row still lacks valid line evidence.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND rj.stored_hidden_reason = 'missing_animator_resource'

    UNION ALL

    SELECT
        'computed_missing_animator_resource_candidate' AS issue_type,
        'manual_review' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Animation/activity row has no usable animator line evidence. Keep hidden until an operator confirms the correct resource.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND lower(COALESCE(rj.category, '')) IN ('animation', 'activity', 'quest', 'show', 'masterclass', 'workshop', 'custom')
      AND COALESCE(NULLIF(rj.effective_line_id, ''), NULLIF(rj.identity_line_id, ''), NULLIF(rj.identity_resource_id, '')) IS NULL

    UNION ALL

    SELECT
        'linked_missing_timeline_identity' AS issue_type,
        'idempotent_json_rebuild_after_review' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Linked child has line_id but missing timelineIdentity. If line_id matches resource evidence, rebuild JSON only; do not rewrite line_id.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND NULLIF(rj.linked_to, '') IS NOT NULL
      AND NULLIF(rj.line_id, '') IS NOT NULL
      AND COALESCE(NULLIF(rj.identity_line_id, ''), NULLIF(rj.identity_resource_id, '')) IS NULL

    UNION ALL

    SELECT
        'second_animator_missing_linked_booking' AS issue_type,
        'manual_review_then_create_linked_row' AS repair_mode,
        parent.id AS booking_id,
        NULLIF(parent.linked_to, '') AS parent_booking_id,
        parent.date,
        parent.normalized_business_context AS business_context,
        parent.line_id,
        parent.identity_line_id,
        parent.identity_resource_id,
        parent.effective_line_id,
        COALESCE(parent.matched_lines_by_date_name, parent.matched_timeline_resource_name, parent.identity_resource_name) AS line_name,
        parent.identity_resource_type,
        parent.category,
        parent.room,
        parent.second_animator,
        parent.banquet_group_id,
        parent.banquet_group_role,
        parent.banquet_group_primary_booking_id,
        parent.stored_display_surface,
        parent.stored_hidden_reason,
        parent.timeline_identity,
        parent.timeline_projection,
        'Parent has second_animator but no active linked child. Create a linked row only after conflict and zero-price linked-row review.' AS suspected_repair_action
    FROM resource_joined parent
    WHERE parent.normalized_status <> 'cancelled'
      AND NULLIF(parent.linked_to, '') IS NULL
      AND NULLIF(parent.second_animator, '') IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM resource_joined child
          WHERE child.normalized_status <> 'cancelled'
            AND NULLIF(child.linked_to, '') = parent.id
      )

    UNION ALL

    SELECT
        'banquet_activity_hidden_by_duplicate_marker_risk' AS issue_type,
        'code_or_manual_review_no_data_update' AS repair_mode,
        rj.id AS booking_id,
        NULLIF(rj.linked_to, '') AS parent_booking_id,
        rj.date,
        rj.normalized_business_context AS business_context,
        rj.line_id,
        rj.identity_line_id,
        rj.identity_resource_id,
        rj.effective_line_id,
        COALESCE(rj.matched_lines_by_date_name, rj.matched_timeline_resource_name, rj.identity_resource_name) AS line_name,
        rj.identity_resource_type,
        rj.category,
        rj.room,
        rj.second_animator,
        rj.banquet_group_id,
        rj.banquet_group_role,
        rj.banquet_group_primary_booking_id,
        rj.stored_display_surface,
        rj.stored_hidden_reason,
        rj.timeline_identity,
        rj.timeline_projection,
        'Primary banquet booking is a real animation/activity and should render as booking_block. Do not repair data unless API projection is hidden; otherwise fix duplicate-marker frontend/code classification.' AS suspected_repair_action
    FROM resource_joined rj
    WHERE rj.normalized_status <> 'cancelled'
      AND rj.banquet_group_id IS NOT NULL
      AND rj.banquet_group_primary_booking_id = rj.id
      AND lower(COALESCE(rj.category, '')) IN ('animation', 'activity', 'quest', 'show', 'masterclass', 'workshop', 'custom')
      AND COALESCE(NULLIF(rj.room, ''), '') <> ''
      AND EXISTS (
          SELECT 1
          FROM resource_joined service_row
          WHERE service_row.banquet_group_id = rj.banquet_group_id
            AND service_row.id <> rj.id
            AND service_row.normalized_status <> 'cancelled'
            AND (
                lower(COALESCE(service_row.banquet_group_role, '')) IN ('kitchen', 'service')
                OR COALESCE(service_row.stored_display_surface, '') = 'service_marker'
                OR service_row.normalized_extra_data ? 'bookingPackage'
                OR service_row.normalized_extra_data ? 'booking_package'
            )
      )
)
SELECT
    issue_type,
    repair_mode,
    COUNT(*) OVER (PARTITION BY issue_type) AS issue_type_count,
    COUNT(*) OVER () AS total_issue_rows,
    booking_id,
    parent_booking_id,
    date,
    business_context,
    line_id,
    identity_line_id,
    identity_resource_id,
    effective_line_id,
    line_name,
    identity_resource_type,
    category,
    room,
    second_animator,
    banquet_group_id,
    banquet_group_role,
    banquet_group_primary_booking_id,
    stored_display_surface,
    stored_hidden_reason,
    timeline_identity,
    timeline_projection,
    suspected_repair_action
FROM issue_rows
ORDER BY issue_type, date DESC, booking_id;
