#!/usr/bin/env node
'use strict';

/**
 * Read-only Task cleanup inventory.
 *
 * This script intentionally has no apply mode. It opens a PostgreSQL
 * READ ONLY transaction, verifies the transaction mode, runs SELECT queries,
 * writes an optional deterministic manifest, and always rolls back.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {
    MACHINE_CREATORS,
    MACHINE_SOURCE_TYPES,
    MACHINE_TASK_TYPES,
    PRIVATE_OR_PERSONAL,
    TASK_AUTOMATION_MARKER_SCOPE_VERSION,
    TERMINAL_STATUSES,
    hasAutomationMarkerScope,
    taskHumanTouchSql
} = require('../services/taskAutomationPolicy');

const CLASSIFIER_VERSION = 'task_cleanup_inventory_v1_2026_08_09';
const BLOCKED_FLAGS = new Set([
    '--apply',
    '--archive',
    '--backfill',
    '--delete',
    '--execute',
    '--fix',
    '--mutate',
    '--repair',
    '--update',
    '--write'
]);
const TERMINAL_STATUS_SET = new Set(TERMINAL_STATUSES);
const PRIVATE_OR_PERSONAL_SET = new Set(PRIVATE_OR_PERSONAL);
const MACHINE_CREATED_BY = new Set(['rule_engine']);
const MACHINE_SOURCE_TYPE_SET = new Set([...MACHINE_SOURCE_TYPES, 'manual']);
const MACHINE_TASK_TYPE_SET = new Set(MACHINE_TASK_TYPES.filter(type => type !== 'recurring'));
const LEGACY_AUTOMATION_TASK_TYPES = new Set(['auto', 'auto_complete', 'recurring']);
const LEGACY_AUTOMATION_SOURCE_TYPES = new Set(['automation', 'trigger', 'recurring', 'booking']);
const LEGACY_AUTOMATION_CREATORS = new Set([...MACHINE_CREATORS, 'automation']);
const CANCELLED_BOOKING_STATUSES = new Set(['cancelled', 'canceled']);

function usage() {
    return [
        'Usage:',
        '  node scripts/task-cleanup-inventory.js [--output .codex-temp/task-cleanup-inventory/manifest.json]',
        '',
        'Connection:',
        '  TASK_CLEANUP_AUDIT_DATABASE_URL, TASK_AUDIT_DATABASE_URL, or PRODUCTION_READONLY_DATABASE_URL.',
        '',
        'Safety:',
        '  Read-only only. Write/apply/archive/delete/update flags are refused.',
        '  The DB transaction is BEGIN ... READ ONLY and always ends with ROLLBACK.',
        '',
        'Output:',
        '  stdout: aggregate summary without production IDs.',
        '  --output: full deterministic JSON manifest with IDs, counts, classifier version, and checksum.'
    ].join('\n');
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function parseArgs(argv) {
    const options = {
        output: '',
        printManifest: false,
        help: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (BLOCKED_FLAGS.has(arg)) {
            throw new Error(`${arg} is not supported: this inventory is read-only only`);
        }
        const readValue = name => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
            index += 1;
            return value.trim();
        };
        if (arg === '--output') options.output = readValue(arg);
        else if (arg === '--print-manifest') options.printManifest = true;
        else if (!arg.startsWith('--') && !options.output) options.output = arg.trim();
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

function poolConfig(env = process.env) {
    const connectionString = String(
        env.TASK_CLEANUP_AUDIT_DATABASE_URL
        || env.TASK_AUDIT_DATABASE_URL
        || env.PRODUCTION_READONLY_DATABASE_URL
        || ''
    ).trim();
    if (!connectionString) {
        const error = new Error(
            'Set TASK_CLEANUP_AUDIT_DATABASE_URL, TASK_AUDIT_DATABASE_URL, or PRODUCTION_READONLY_DATABASE_URL before running task cleanup inventory'
        );
        error.code = 'TASK_CLEANUP_READ_ONLY_DATABASE_REQUIRED';
        throw error;
    }
    return {
        connectionString,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        application_name: 'task_cleanup_readonly_inventory'
    };
}

function canonicalDueDateSql(alias = 't') {
    return `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE
            WHEN LEFT(COALESCE(${alias}.date::text, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN LEFT(${alias}.date::text, 10)::date
            ELSE NULL
        END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
}

const INVENTORY_TABLES = Object.freeze([
    'task_logs',
    'task_action_history',
    'task_subtasks',
    'task_dependencies',
    'task_observers',
    'task_bundle_tasks'
]);

function canReadTable(tableAccess = {}, tableName) {
    return tableAccess[tableName]?.selectable !== false;
}

function optionalCountSql(tableAccess, tableName, sqlWhenReadable) {
    return canReadTable(tableAccess, tableName) ? sqlWhenReadable : '0';
}

function humanTouchedSql(tableAccess = {}) {
    const checks = [];
    if (canReadTable(tableAccess, 'task_logs')) {
        checks.push(`EXISTS (
                SELECT 1
                FROM task_logs tl
                WHERE tl.task_id = t.id
                  AND LOWER(COALESCE(tl.actor, '')) NOT IN ('', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle')
                LIMIT 1
            )`);
    }
    if (canReadTable(tableAccess, 'task_action_history')) {
        checks.push(`EXISTS (
                SELECT 1
                FROM task_action_history tah
                WHERE tah.task_id = t.id
                  AND (
                      tah.actor_user_id IS NOT NULL
                      OR LOWER(COALESCE(tah.actor_name_snapshot, '')) NOT IN ('', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle')
                  )
                LIMIT 1
            )`);
    }
    if (!checks.length) return 'FALSE';
    return taskHumanTouchSql('t', {
        includeTaskLogs: canReadTable(tableAccess, 'task_logs'),
        includeTaskActionHistory: canReadTable(tableAccess, 'task_action_history')
    });
}

function buildInventorySql(options = {}) {
    const tableAccess = options.tableAccess || {};
    const dueDate = canonicalDueDateSql('t');
    return `
        WITH runtime AS (
            SELECT
                (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS kyiv_today,
                NOW() AS captured_at
        )
        SELECT
            t.id::int AS id,
            COALESCE(t.business_context, 'event_genix') AS business_context,
            LOWER(COALESCE(t.status, 'todo')) AS status,
            t.archived_at IS NOT NULL AS archived,
            LOWER(COALESCE(t.archive_reason, '')) AS archive_reason,
            LOWER(COALESCE(t.type, '')) AS task_type_legacy,
            LOWER(COALESCE(t.source_type, '')) AS source_type,
            NULLIF(BTRIM(COALESCE(t.source_id, '')), '') AS source_id,
            LOWER(COALESCE(t.source_entity_type, '')) AS source_entity_type,
            LOWER(COALESCE(t.related_entity_type, '')) AS related_entity_type,
            LOWER(COALESCE(t.source_module, '')) AS source_module,
            LOWER(NULLIF(BTRIM(COALESCE(t.created_by, '')), '')) AS created_by_normalized,
            COALESCE(t.created_by_user_id, 0)::int AS created_by_user_id,
            COALESCE(t.owner_user_id, 0)::int AS owner_user_id,
            LOWER(COALESCE(t.visibility, 'team')) AS visibility,
            LOWER(COALESCE(t.task_mode, 'work')) AS task_mode,
            LOWER(COALESCE(t.workflow_state, 'todo')) AS workflow_state,
            COALESCE(t.focus_rank, 0)::int AS focus_rank,
            t.snoozed_until IS NOT NULL AS has_snooze,
            (t.snoozed_until IS NOT NULL AND t.snoozed_until > NOW()) AS has_future_snooze,
            (${dueDate})::text AS due_date,
            (NOT (LOWER(COALESCE(t.status, 'todo')) = ANY(ARRAY['done','completed','cancelled','canceled','archived']))
                AND t.archived_at IS NULL) AS active,
            (NOT (LOWER(COALESCE(t.status, 'todo')) = ANY(ARRAY['done','completed','cancelled','canceled','archived']))
                AND t.archived_at IS NULL
                AND (t.snoozed_until IS NULL OR t.snoozed_until <= NOW())
                AND ${dueDate} < runtime.kyiv_today::date) AS canonical_overdue,
            ${humanTouchedSql(tableAccess)} AS human_touched,
            COALESCE((${optionalCountSql(tableAccess, 'task_subtasks', 'SELECT COUNT(*)::int FROM task_subtasks st WHERE st.task_id = t.id')}), 0) AS subtask_count,
            COALESCE((${optionalCountSql(tableAccess, 'task_dependencies', `
                SELECT COUNT(*)::int
                FROM task_dependencies td
                WHERE td.task_id = t.id OR td.depends_on_task_id = t.id
            `)}), 0) AS dependency_count,
            COALESCE((${optionalCountSql(tableAccess, 'task_observers', 'SELECT COUNT(*)::int FROM task_observers tob WHERE tob.task_id = t.id')}), 0) AS observer_count,
            COALESCE((${optionalCountSql(tableAccess, 'task_bundle_tasks', 'SELECT COUNT(*)::int FROM task_bundle_tasks tbt WHERE tbt.task_id = t.id')}), 0) AS ai_bundle_count,
            b.id IS NOT NULL AS booking_found,
            LOWER(COALESCE(b.status, '')) AS booking_status,
            b.date::text AS booking_date,
            runtime.kyiv_today,
            runtime.captured_at
        FROM tasks t
        CROSS JOIN runtime
        LEFT JOIN bookings b ON b.id::text = NULLIF(BTRIM(COALESCE(t.source_id, '')), '')
        ORDER BY t.id ASC
    `;
}

function isStrictRuleEngine(row = {}) {
    return MACHINE_CREATED_BY.has(normalize(row.created_by_normalized))
        && MACHINE_SOURCE_TYPE_SET.has(normalize(row.source_type))
        && MACHINE_TASK_TYPE_SET.has(normalize(row.task_type_legacy));
}

function classifyProvenance(row = {}) {
    const createdBy = normalize(row.created_by_normalized);
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.task_type_legacy);
    const sourceEntityType = normalize(row.source_entity_type);
    const relatedEntityType = normalize(row.related_entity_type);
    const sourceModule = normalize(row.source_module);
    const joined = [sourceType, sourceEntityType, relatedEntityType, sourceModule, createdBy].join(' ');

    if (sourceType === 'ai_draft' || sourceType === 'ai_draft_bundle' || Number(row.ai_bundle_count || 0) > 0 || /(^|\s)ai[_-]?draft(\s|$)/.test(joined)) {
        return 'human_assisted_ai';
    }
    if (sourceType === 'attendance' || sourceEntityType === 'attendance' || relatedEntityType === 'attendance' || /(^|\s)attendance(\s|$)/.test(joined)) {
        return 'attendance';
    }
    if (sourceType === 'hermes' || sourceType === 'integration' || /hermes|integration/.test(joined)) {
        return 'integrations_hermes';
    }
    if (isStrictRuleEngine(row)) {
        return 'strict_rule_engine';
    }
    if (Number(row.created_by_user_id || 0) > 0) {
        return 'manual';
    }
    if (LEGACY_AUTOMATION_TASK_TYPES.has(taskType) || LEGACY_AUTOMATION_SOURCE_TYPES.has(sourceType) || LEGACY_AUTOMATION_CREATORS.has(createdBy)) {
        return 'legacy_explicit_automation';
    }
    if (sourceType === 'manual' || taskType === 'manual') {
        return 'manual';
    }
    return 'unknown';
}

function protectionReasons(row = {}, provenance = classifyProvenance(row)) {
    const reasons = [];
    const status = normalize(row.status);
    if (Number(row.created_by_user_id || 0) > 0) reasons.push('typed_creator');
    if (PRIVATE_OR_PERSONAL_SET.has(normalize(row.visibility)) || PRIVATE_OR_PERSONAL_SET.has(normalize(row.task_mode))) reasons.push('private_or_personal');
    if (status === 'in_progress' || normalize(row.workflow_state) === 'in_progress') reasons.push('in_progress');
    if (Number(row.focus_rank || 0) > 0) reasons.push('focus_rank');
    if (row.has_snooze) reasons.push(row.has_future_snooze ? 'future_snooze' : 'snooze_history');
    if (row.human_touched) reasons.push('human_touched');
    if (Number(row.subtask_count || 0) > 0) reasons.push('subtasks');
    if (Number(row.dependency_count || 0) > 0) reasons.push('dependencies');
    if (Number(row.observer_count || 0) > 0) reasons.push('observers');
    if (provenance === 'human_assisted_ai') reasons.push('human_assisted_ai');
    if (provenance === 'integrations_hermes') reasons.push('integration_or_hermes');
    if (provenance === 'attendance') reasons.push('attendance');
    if (provenance === 'manual') reasons.push('manual_or_human_created');
    if (provenance === 'unknown') reasons.push('unknown_provenance');
    return [...new Set(reasons)].sort();
}

function bookingCohort(row = {}) {
    if (!row.booking_found) return 'orphan';
    const status = normalize(row.booking_status);
    if (CANCELLED_BOOKING_STATUSES.has(status)) return 'cancelled';
    const bookingDate = String(row.booking_date || '').slice(0, 10);
    const today = String(row.kyiv_today || '').slice(0, 10);
    if (bookingDate && today && bookingDate >= today) return 'today_future';
    return 'past_active';
}

function pushId(bucket, id) {
    bucket.ids.push(Number(id));
    bucket.count += 1;
}

function emptyIdBucket() {
    return { count: 0, ids: [] };
}

function idSetChecksum(scope, ids = []) {
    return crypto.createHash('sha256').update(JSON.stringify({
        scope,
        ids: [...ids].map(Number).sort((left, right) => left - right)
    })).digest('hex');
}

function automationEvidenceChecksum(rows = []) {
    const normalizedEvidence = rows
        .filter(row => row.canonical_overdue && hasAutomationMarkerScope(row))
        .map(row => {
            const provenance = classifyProvenance(row);
            return {
                id: Number(row.id),
                provenance,
                protectionReasons: protectionReasons(row, provenance),
                status: normalize(row.status),
                taskType: normalize(row.task_type_legacy),
                sourceType: normalize(row.source_type),
                sourceEntityType: normalize(row.source_entity_type),
                relatedEntityType: normalize(row.related_entity_type),
                sourceModule: normalize(row.source_module),
                createdByUser: Number(row.created_by_user_id || 0) > 0,
                ownerPresent: Number(row.owner_user_id || 0) > 0,
                visibility: normalize(row.visibility),
                taskMode: normalize(row.task_mode),
                workflowState: normalize(row.workflow_state),
                focus: Number(row.focus_rank || 0) > 0,
                snoozed: Boolean(row.has_snooze),
                futureSnooze: Boolean(row.has_future_snooze),
                humanTouched: Boolean(row.human_touched),
                subtaskCount: Number(row.subtask_count || 0),
                dependencyCount: Number(row.dependency_count || 0),
                observerCount: Number(row.observer_count || 0),
                aiBundleCount: Number(row.ai_bundle_count || 0),
                bookingFound: Boolean(row.booking_found),
                bookingStatus: normalize(row.booking_status),
                bookingCohort: normalize(row.source_type) === 'booking' ? bookingCohort(row) : '',
                dueDate: String(row.due_date || '').slice(0, 10)
            };
        })
        .sort((left, right) => left.id - right.id);
    return crypto.createHash('sha256').update(JSON.stringify({
        scope: TASK_AUTOMATION_MARKER_SCOPE_VERSION,
        rows: normalizedEvidence
    })).digest('hex');
}

function emptyBookingBuckets() {
    return {
        cancelled: emptyIdBucket(),
        past_active: emptyIdBucket(),
        today_future: emptyIdBucket(),
        orphan: emptyIdBucket()
    };
}

function sortBucket(bucket) {
    bucket.ids = [...bucket.ids].map(Number).sort((left, right) => left - right);
    bucket.count = bucket.ids.length;
    return bucket;
}

function sortBuckets(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value.ids) && typeof value.count === 'number') return sortBucket(value);
    for (const item of Object.values(value)) sortBuckets(item);
    return value;
}

function countBy(rows, key) {
    return rows.reduce((acc, row) => {
        const value = row[key] === null || row[key] === undefined || row[key] === '' ? 'unknown' : String(row[key]);
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
}

function groupTaskStats(rows, key) {
    const grouped = {};
    for (const row of rows) {
        const value = row[key] === null || row[key] === undefined || row[key] === '' ? 'unknown' : String(row[key]);
        if (!grouped[value]) {
            grouped[value] = {
                total: 0,
                active: 0,
                archived: 0,
                canonicalOverdue: 0
            };
        }
        grouped[value].total += 1;
        if (row.active) grouped[value].active += 1;
        if (row.archived) grouped[value].archived += 1;
        if (row.canonical_overdue) grouped[value].canonicalOverdue += 1;
    }
    return Object.fromEntries(Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right)));
}

function buildManifest(rows = [], options = {}) {
    const capturedAt = rows[0]?.captured_at ? new Date(rows[0].captured_at).toISOString() : new Date().toISOString();
    const kyivToday = rows[0]?.kyiv_today ? String(rows[0].kyiv_today).slice(0, 10) : null;
    const manifest = {
        classifierVersion: CLASSIFIER_VERSION,
        capturedAt,
        kyivToday,
        safety: {
            dbTransaction: 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
            transactionReadOnlyVerified: options.transactionReadOnlyVerified === true,
            rollback: 'ROLLBACK',
            writesSupported: false,
            piiPolicy: 'Task titles, descriptions, user names, customer data, and secrets are not selected or emitted.',
            tableAccess: options.tableAccess || {}
        },
        totals: {
            total: rows.length,
            active: rows.filter(row => row.active).length,
            terminalOrArchived: rows.filter(row => !row.active).length,
            archived: rows.filter(row => row.archived).length,
            canonicalOverdue: rows.filter(row => row.canonical_overdue).length
        },
        byBusinessContext: groupTaskStats(rows, 'business_context'),
        byStatus: countBy(rows, 'status'),
        provenance: {},
        protectionReasons: {},
        cohorts: {
            canonicalOverdue: emptyIdBucket(),
            automationMarkerOverdue: emptyIdBucket(),
            broadAutomationOverdue: emptyIdBucket(),
            humanManualOverdue: emptyIdBucket(),
            unknownProtectedOverdue: emptyIdBucket(),
            protectedReviewOverdue: emptyIdBucket(),
            cleanupCandidates: {
                strictCancelledBookings: emptyIdBucket()
            },
            booking: {
                strictRuleEngineOverdue: emptyBookingBuckets(),
                legacyExplicitAutomationOverdue: emptyBookingBuckets(),
                broadAutomationOverdue: emptyBookingBuckets()
            },
            autoExpiredManualPrivate: emptyIdBucket()
        },
        checksum: null
    };

    for (const row of rows) {
        const id = Number(row.id);
        const provenance = classifyProvenance(row);
        const reasons = protectionReasons(row, provenance);
        const protectedReview = reasons.length > 0;
        const broadAutomation = provenance === 'strict_rule_engine' || provenance === 'legacy_explicit_automation';
        const automationMarker = hasAutomationMarkerScope(row);

        if (!manifest.provenance[provenance]) {
            manifest.provenance[provenance] = {
                total: 0,
                canonicalOverdue: 0,
                protectedReview: 0,
                unprotectedOverdue: 0
            };
        }
        manifest.provenance[provenance].total += 1;
        if (row.canonical_overdue) manifest.provenance[provenance].canonicalOverdue += 1;
        if (protectedReview) manifest.provenance[provenance].protectedReview += 1;
        if (row.canonical_overdue && !protectedReview) manifest.provenance[provenance].unprotectedOverdue += 1;

        for (const reason of reasons) {
            manifest.protectionReasons[reason] = (manifest.protectionReasons[reason] || 0) + 1;
        }

        if (row.canonical_overdue) {
            pushId(manifest.cohorts.canonicalOverdue, id);
            if (automationMarker) pushId(manifest.cohorts.automationMarkerOverdue, id);
            if (broadAutomation) pushId(manifest.cohorts.broadAutomationOverdue, id);
            if (!automationMarker && provenance === 'manual') pushId(manifest.cohorts.humanManualOverdue, id);
            if (!automationMarker && provenance !== 'manual') pushId(manifest.cohorts.unknownProtectedOverdue, id);
            if (protectedReview) pushId(manifest.cohorts.protectedReviewOverdue, id);
        }

        if (row.canonical_overdue && row.source_type === 'booking' && broadAutomation) {
            const cohort = bookingCohort(row);
            pushId(manifest.cohorts.booking.broadAutomationOverdue[cohort], id);
            if (provenance === 'strict_rule_engine') {
                pushId(manifest.cohorts.booking.strictRuleEngineOverdue[cohort], id);
            } else {
                pushId(manifest.cohorts.booking.legacyExplicitAutomationOverdue[cohort], id);
            }
        }

        if (
            row.canonical_overdue
            && provenance === 'strict_rule_engine'
            && row.source_type === 'booking'
            && bookingCohort(row) === 'cancelled'
            && !protectedReview
        ) {
            pushId(manifest.cohorts.cleanupCandidates.strictCancelledBookings, id);
        }

        if (
            row.archive_reason === 'auto_expired'
            && (
                provenance === 'manual'
                || PRIVATE_OR_PERSONAL_SET.has(normalize(row.visibility))
                || PRIVATE_OR_PERSONAL_SET.has(normalize(row.task_mode))
                || Number(row.created_by_user_id || 0) > 0
            )
        ) {
            pushId(manifest.cohorts.autoExpiredManualPrivate, id);
        }
    }

    sortBuckets(manifest.cohorts);
    manifest.cohorts.automationMarkerOverdue.scopeVersion = TASK_AUTOMATION_MARKER_SCOPE_VERSION;
    manifest.cohorts.automationMarkerOverdue.membershipChecksum = idSetChecksum(
        TASK_AUTOMATION_MARKER_SCOPE_VERSION,
        manifest.cohorts.automationMarkerOverdue.ids
    );
    manifest.cohorts.automationMarkerOverdue.evidenceChecksum = automationEvidenceChecksum(rows);
    manifest.provenance = Object.fromEntries(Object.entries(manifest.provenance).sort(([left], [right]) => left.localeCompare(right)));
    manifest.protectionReasons = Object.fromEntries(Object.entries(manifest.protectionReasons).sort(([left], [right]) => left.localeCompare(right)));
    manifest.checksum = checksumManifest(manifest);
    return manifest;
}

function checksumManifest(manifest) {
    const clone = JSON.parse(JSON.stringify(manifest));
    clone.checksum = null;
    clone.capturedAt = null;
    return crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex');
}

function summaryForStdout(manifest) {
    return {
        classifierVersion: manifest.classifierVersion,
        capturedAt: manifest.capturedAt,
        kyivToday: manifest.kyivToday,
        transactionReadOnlyVerified: manifest.safety.transactionReadOnlyVerified,
        totals: manifest.totals,
        automationMarkerOverdue: {
            count: manifest.cohorts.automationMarkerOverdue.count,
            scopeVersion: manifest.cohorts.automationMarkerOverdue.scopeVersion,
            membershipChecksum: manifest.cohorts.automationMarkerOverdue.membershipChecksum,
            evidenceChecksum: manifest.cohorts.automationMarkerOverdue.evidenceChecksum
        },
        broadAutomationOverdue: manifest.cohorts.broadAutomationOverdue.count,
        humanManualOverdue: manifest.cohorts.humanManualOverdue.count,
        unknownProtectedOverdue: manifest.cohorts.unknownProtectedOverdue.count,
        strictCancelledBookingCandidates: manifest.cohorts.cleanupCandidates.strictCancelledBookings.count,
        autoExpiredManualPrivate: manifest.cohorts.autoExpiredManualPrivate.count,
        bookingCohorts: {
            strictRuleEngineOverdue: Object.fromEntries(
                Object.entries(manifest.cohorts.booking.strictRuleEngineOverdue).map(([key, value]) => [key, value.count])
            ),
            broadAutomationOverdue: Object.fromEntries(
                Object.entries(manifest.cohorts.booking.broadAutomationOverdue).map(([key, value]) => [key, value.count])
            )
        },
        checksum: manifest.checksum
    };
}

async function loadTableAccess(client) {
    const rows = [];
    for (const tableName of INVENTORY_TABLES) {
        const qualifiedName = `public.${tableName}`;
        const result = await client.query(
            `SELECT
                $1::text AS table_name,
                to_regclass($2::text) IS NOT NULL AS exists,
                CASE
                    WHEN to_regclass($2::text) IS NULL THEN false
                    ELSE has_table_privilege($2::text, 'SELECT')
                END AS selectable`,
            [tableName, qualifiedName]
        );
        rows.push(result.rows[0]);
    }
    return Object.fromEntries(rows.map(row => [
        row.table_name,
        {
            exists: row.exists === true,
            selectable: row.selectable === true
        }
    ]));
}

async function fetchInventory(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const readOnly = await client.query('SHOW transaction_read_only');
        const verified = readOnly.rows[0]?.transaction_read_only === 'on';
        if (!verified) throw new Error('PostgreSQL transaction_read_only is not on');
        const tableAccess = await loadTableAccess(client);
        const result = await client.query(buildInventorySql({ tableAccess }));
        return {
            rows: result.rows,
            transactionReadOnlyVerified: true,
            tableAccess
        };
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
}

function writeManifest(filePath, manifest) {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return resolved;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const pool = new Pool(poolConfig());
    try {
        const inventory = await fetchInventory(pool);
        const manifest = buildManifest(inventory.rows, {
            transactionReadOnlyVerified: inventory.transactionReadOnlyVerified,
            tableAccess: inventory.tableAccess
        });
        if (options.output) {
            const resolved = writeManifest(options.output, manifest);
            console.error(`Full task cleanup manifest written: ${resolved}`);
        }
        console.log(JSON.stringify(options.printManifest ? manifest : summaryForStdout(manifest), null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`task cleanup inventory failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    BLOCKED_FLAGS,
    CLASSIFIER_VERSION,
    buildInventorySql,
    buildManifest,
    checksumManifest,
    classifyProvenance,
    canonicalDueDateSql,
    parseArgs,
    poolConfig,
    protectionReasons,
    summaryForStdout
};
