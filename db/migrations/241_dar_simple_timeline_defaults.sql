-- MIGRATION_KIND: data-fix
-- SAFETY: Non-destructive Dar settings repair. It only inserts missing Dar timeline defaults or converts legacy disabled/no_timeline Dar settings to the new simple timeline default.
-- ROLLBACK: Restore settings rows business_cabinet:dar and timeline_display:dar from backup if an operator intentionally needs Dar disabled again.

WITH defaults AS (
    SELECT '{
        "version": 2,
        "timelineEnabled": true,
        "mode": "simple",
        "parkKitchenMode": "with_kitchen",
        "startPage": "timeline",
        "resourceModel": "specialist",
        "enabledModules": {
            "timeline": true,
            "bookings": true,
            "leads": true,
            "customers": true,
            "omni": true,
            "tasks": true,
            "products": false,
            "afisha": false,
            "kitchen": false,
            "resources": true,
            "teachers": false,
            "lessonSeries": false
        },
        "timelineFeatures": {
            "quickCloseSlot": true,
            "freeResources": true,
            "series": false,
            "afisha": false,
            "kitchen": false,
            "compactBlocks": true,
            "seriesBadge": false,
            "teacherConflict": false,
            "resourceCapacity": false
        },
        "bookingPolicy": {
            "allowLessonsWithoutTeacher": false,
            "allowLessonsWithoutGroup": true,
            "enforceTeacherConflict": false,
            "enforceResourceCapacity": false,
            "notifyFirstOccurrenceOnly": false
        },
        "context": "dar",
        "updatedAt": null,
        "updatedBy": "migration_241"
    }'::jsonb AS timeline
)
INSERT INTO settings (key, value)
SELECT 'timeline_display:dar', timeline::text
FROM defaults
ON CONFLICT (key) DO NOTHING;

WITH defaults AS (
    SELECT '{
        "version": 2,
        "timelineEnabled": true,
        "mode": "simple",
        "parkKitchenMode": "with_kitchen",
        "startPage": "timeline",
        "resourceModel": "specialist",
        "enabledModules": {
            "timeline": true,
            "bookings": true,
            "leads": true,
            "customers": true,
            "omni": true,
            "tasks": true,
            "products": false,
            "afisha": false,
            "kitchen": false,
            "resources": true,
            "teachers": false,
            "lessonSeries": false
        },
        "timelineFeatures": {
            "quickCloseSlot": true,
            "freeResources": true,
            "series": false,
            "afisha": false,
            "kitchen": false,
            "compactBlocks": true,
            "seriesBadge": false,
            "teacherConflict": false,
            "resourceCapacity": false
        },
        "bookingPolicy": {
            "allowLessonsWithoutTeacher": false,
            "allowLessonsWithoutGroup": true,
            "enforceTeacherConflict": false,
            "enforceResourceCapacity": false,
            "notifyFirstOccurrenceOnly": false
        },
        "context": "dar",
        "updatedAt": null,
        "updatedBy": "migration_241"
    }'::jsonb AS timeline
)
UPDATE settings
SET value = defaults.timeline::text
FROM defaults
WHERE key = 'timeline_display:dar'
  AND (
      value IS NULL
      OR value::jsonb->>'mode' = 'disabled'
      OR value::jsonb->>'timelineEnabled' = 'false'
      OR value::jsonb->'enabledModules'->>'timeline' = 'false'
  );

WITH defaults AS (
    SELECT
        '{
            "version": 2,
            "timelineEnabled": true,
            "mode": "simple",
            "parkKitchenMode": "with_kitchen",
            "startPage": "timeline",
            "resourceModel": "specialist",
            "enabledModules": {
                "timeline": true,
                "bookings": true,
                "leads": true,
                "customers": true,
                "omni": true,
                "tasks": true,
                "products": false,
                "afisha": false,
                "kitchen": false,
                "resources": true,
                "teachers": false,
                "lessonSeries": false
            },
            "timelineFeatures": {
                "quickCloseSlot": true,
                "freeResources": true,
                "series": false,
                "afisha": false,
                "kitchen": false,
                "compactBlocks": true,
                "seriesBadge": false,
                "teacherConflict": false,
                "resourceCapacity": false
            },
            "bookingPolicy": {
                "allowLessonsWithoutTeacher": false,
                "allowLessonsWithoutGroup": true,
                "enforceTeacherConflict": false,
                "enforceResourceCapacity": false,
                "notifyFirstOccurrenceOnly": false
            },
            "context": "dar",
            "updatedAt": null,
            "updatedBy": "migration_241"
        }'::jsonb AS timeline,
        '{"timeline": true, "bookings": true, "resources": true, "dashboard": true, "settings": true}'::jsonb AS module_flags
)
INSERT INTO settings (key, value)
SELECT 'business_cabinet:dar', jsonb_build_object(
    'version', 1,
    'source', 'dar_simple_timeline_default_migration',
    'context', 'dar',
    'businessContext', 'dar',
    'businessType', 'simple',
    'timelineEnabled', true,
    'timelineMode', 'simple',
    'parkKitchenMode', 'with_kitchen',
    'startPage', 'timeline',
    'resourceModel', 'specialist',
    'modules', jsonb_build_object('enabled', module_flags),
    'timeline', timeline,
    'guardrails', '[]'::jsonb,
    'updatedAt', null,
    'updatedBy', 'migration_241'
)::text
FROM defaults
ON CONFLICT (key) DO NOTHING;

WITH defaults AS (
    SELECT
        '{
            "version": 2,
            "timelineEnabled": true,
            "mode": "simple",
            "parkKitchenMode": "with_kitchen",
            "startPage": "timeline",
            "resourceModel": "specialist",
            "enabledModules": {
                "timeline": true,
                "bookings": true,
                "leads": true,
                "customers": true,
                "omni": true,
                "tasks": true,
                "products": false,
                "afisha": false,
                "kitchen": false,
                "resources": true,
                "teachers": false,
                "lessonSeries": false
            },
            "timelineFeatures": {
                "quickCloseSlot": true,
                "freeResources": true,
                "series": false,
                "afisha": false,
                "kitchen": false,
                "compactBlocks": true,
                "seriesBadge": false,
                "teacherConflict": false,
                "resourceCapacity": false
            },
            "bookingPolicy": {
                "allowLessonsWithoutTeacher": false,
                "allowLessonsWithoutGroup": true,
                "enforceTeacherConflict": false,
                "enforceResourceCapacity": false,
                "notifyFirstOccurrenceOnly": false
            },
            "context": "dar",
            "updatedAt": null,
            "updatedBy": "migration_241"
        }'::jsonb AS timeline,
        '{"timeline": true, "bookings": true, "resources": true, "dashboard": true, "settings": true}'::jsonb AS module_flags
)
UPDATE settings
SET value = (
    COALESCE(value::jsonb, '{}'::jsonb)
    || jsonb_build_object(
        'businessType', 'simple',
        'timelineEnabled', true,
        'timelineMode', 'simple',
        'parkKitchenMode', 'with_kitchen',
        'startPage', 'timeline',
        'resourceModel', 'specialist',
        'updatedBy', 'migration_241'
    )
    || jsonb_build_object(
        'modules',
        COALESCE(COALESCE(value::jsonb, '{}'::jsonb)->'modules', '{}'::jsonb)
        || jsonb_build_object(
            'enabled',
            COALESCE(COALESCE(value::jsonb, '{}'::jsonb)#>'{modules,enabled}', '{}'::jsonb) || defaults.module_flags
        )
    )
    || jsonb_build_object(
        'timeline',
        COALESCE(COALESCE(value::jsonb, '{}'::jsonb)->'timeline', '{}'::jsonb) || defaults.timeline
    )
)::text
FROM defaults
WHERE key = 'business_cabinet:dar'
  AND (
      value IS NULL
      OR value::jsonb->>'businessType' IN ('disabled', 'no_timeline')
      OR value::jsonb->>'timelineMode' = 'disabled'
      OR value::jsonb->>'timelineEnabled' = 'false'
      OR value::jsonb#>>'{timeline,mode}' = 'disabled'
      OR value::jsonb#>>'{timeline,timelineEnabled}' = 'false'
      OR value::jsonb#>>'{modules,enabled,timeline}' = 'false'
  );
