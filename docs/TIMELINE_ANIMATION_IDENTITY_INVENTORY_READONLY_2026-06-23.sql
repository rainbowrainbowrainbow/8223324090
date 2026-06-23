-- Timeline animation identity inventory
-- Production impact: yes
-- READ ONLY: this script only runs SELECT statements.
-- Purpose:
--   Find existing animation/linked animator bookings whose timeline identity can
--   make them disappear from the animator timeline.
-- Safety:
--   Do not add UPDATE/DELETE/INSERT statements to this file.
--   Run on a read-only connection or replica where possible.
--   Review the output before preparing any repair migration/script.

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
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,hiddenReason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timelineProjection,hidden_reason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,hiddenReason}', ''),
            NULLIF(sb.normalized_extra_data #>> '{timeline_projection,hidden_reason}', '')
        ) AS stored_hidden_reason,
        COALESCE(
            sb.normalized_extra_data -> 'timelineIdentity',
            sb.normalized_extra_data -> 'timeline_identity',
            '{}'::jsonb
        ) AS timeline_identity
    FROM scoped_bookings sb
),
line_joined AS (
    SELECT
        n.*,
        l.line_id AS matched_line_id,
        l.name AS matched_line_name,
        tr.resource_id AS matched_resource_id,
        tr.name AS matched_resource_name,
        tr.type AS matched_resource_type
    FROM normalized n
    LEFT JOIN lines_by_date l
      ON l.date = n.date
     AND l.line_id = n.line_id
     AND CASE
            WHEN lower(COALESCE(NULLIF(btrim(l.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                THEN 'event_genix'
            ELSE lower(COALESCE(NULLIF(btrim(l.business_context), ''), 'event_genix'))
         END = n.normalized_business_context
    LEFT JOIN timeline_resources tr
      ON tr.resource_id = n.line_id
     AND COALESCE(tr.is_active, true) = true
     AND CASE
            WHEN lower(COALESCE(NULLIF(btrim(tr.business_context), ''), 'event_genix')) IN ('park', 'pzp', 'park_zakrevsky')
                THEN 'event_genix'
            ELSE lower(COALESCE(NULLIF(btrim(tr.business_context), ''), 'event_genix'))
         END = n.normalized_business_context
),
issue_rows AS (
    SELECT
        'animation_missing_line_id' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'manual_review_required: assign a canonical animator line only from explicit UI/source evidence; do not infer from paid/service data' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND lower(COALESCE(lj.category, '')) IN ('animation', 'activity', 'quest', 'show', 'masterclass', 'workshop', 'custom')
      AND COALESCE(NULLIF(lj.line_id, ''), NULLIF(lj.identity_line_id, ''), NULLIF(lj.identity_resource_id, '')) IS NULL

    UNION ALL

    SELECT
        'linked_missing_timeline_identity' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'if line_id matches lines_by_date, rebuild timelineIdentity from that line; otherwise manual review before repair' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND NULLIF(lj.linked_to, '') IS NOT NULL
      AND COALESCE(NULLIF(lj.identity_line_id, ''), NULLIF(lj.identity_resource_id, '')) IS NULL

    UNION ALL

    SELECT
        'line_id_without_lines_by_date' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'manual_review_required: restore the missing lines_by_date row only if the staff/resource/date evidence is explicit' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND NULLIF(lj.line_id, '') IS NOT NULL
      AND lj.matched_line_id IS NULL
      AND lj.matched_resource_id IS NULL
      AND lj.line_id NOT IN ('banquet-service')

    UNION ALL

    SELECT
        'timeline_identity_line_mismatch' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'manual_review_required: choose canonical line_id from create/reload evidence, then preserve previous identity in repair metadata' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND NULLIF(lj.line_id, '') IS NOT NULL
      AND NULLIF(lj.identity_line_id, '') IS NOT NULL
      AND lj.identity_line_id IS DISTINCT FROM lj.line_id

    UNION ALL

    SELECT
        'stored_missing_animator_resource' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'review current backend projection; repair stored line identity only if the row still lacks a valid animator resource after code fix' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND lj.stored_hidden_reason = 'missing_animator_resource'

    UNION ALL

    SELECT
        'computed_missing_animator_resource_candidate' AS issue_type,
        lj.id AS booking_id,
        NULLIF(lj.linked_to, '') AS parent_booking_id,
        lj.date,
        lj.normalized_business_context AS business_context,
        lj.line_id,
        COALESCE(lj.matched_line_name, lj.matched_resource_name, lj.identity_resource_name) AS line_name,
        lj.second_animator,
        lj.timeline_identity,
        lj.stored_hidden_reason,
        'manual_review_required: row has no usable line_id/timelineIdentity evidence, so repair cannot be automatic' AS suspected_repair_action
    FROM line_joined lj
    WHERE lj.normalized_status <> 'cancelled'
      AND lower(COALESCE(lj.category, '')) IN ('animation', 'activity', 'quest', 'show', 'masterclass', 'workshop', 'custom')
      AND COALESCE(NULLIF(lj.line_id, ''), NULLIF(lj.identity_line_id, ''), NULLIF(lj.identity_resource_id, '')) IS NULL

    UNION ALL

    SELECT
        'second_animator_missing_linked_booking' AS issue_type,
        parent.id AS booking_id,
        NULLIF(parent.linked_to, '') AS parent_booking_id,
        parent.date,
        parent.normalized_business_context AS business_context,
        parent.line_id,
        COALESCE(parent.matched_line_name, parent.matched_resource_name, parent.identity_resource_name) AS line_name,
        parent.second_animator,
        parent.timeline_identity,
        parent.stored_hidden_reason,
        'create missing linked booking only after conflict check and explicit second animator line/resource confirmation' AS suspected_repair_action
    FROM line_joined parent
    WHERE parent.normalized_status <> 'cancelled'
      AND NULLIF(parent.linked_to, '') IS NULL
      AND NULLIF(parent.second_animator, '') IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM line_joined child
          WHERE child.normalized_status <> 'cancelled'
            AND NULLIF(child.linked_to, '') = parent.id
      )
)
SELECT
    issue_type,
    COUNT(*) OVER (PARTITION BY issue_type) AS issue_type_count,
    COUNT(*) OVER () AS total_issue_rows,
    booking_id,
    parent_booking_id,
    date,
    business_context,
    line_id,
    line_name,
    second_animator,
    timeline_identity,
    stored_hidden_reason,
    suspected_repair_action
FROM issue_rows
ORDER BY issue_type, date DESC, booking_id;
