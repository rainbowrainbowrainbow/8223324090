/**
 * services/taskLifecycle.js — Task health scoring
 * Runs daily, calculates health_score for explicitly machine-owned tasks.
 * Archive candidates are report-only until cleanup is approved separately.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { DEFAULT_TASK_BUSINESS_CONTEXT, activeTaskBusinessContext } = require('./taskBusinessScope');
const {
    MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING,
    MACHINE_LIFECYCLE_MARKER_VERSION,
    hasStrictMachineProvenance,
    isAiAssisted,
    isIntegration,
    isPrivateOrPersonal,
    isTerminalStatus,
    taskHumanTouchSql,
    taskWorkloadDateSql
} = require('./taskAutomationPolicy');
const { TASK_ACTION_TYPES } = require('./taskActionConstants');
const log = createLogger('TaskLifecycle');
let isTaskLifecycleRunning = false;

const CANCELLED_BOOKING_AUTO_ARCHIVE_REASON = 'auto_archive_cancelled_booking_machine_v1';
const CANCELLED_BOOKING_AUTO_ARCHIVE_BATCH_LIMIT = 50;
const CANCELLED_BOOKING_AUTO_ARCHIVE_LOCK_KEY = 'task_lifecycle_cancelled_booking_auto_archive_v1';

function kyivDateString(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
}

function hasExplicitMachineProvenance(task = {}) {
    return hasStrictMachineProvenance(task);
}

function taskLifecycleProtectionReason(task = {}) {
    if (task.archived_at) return 'already_archived';
    if (isTerminalStatus(task.status)) return 'terminal_status';
    if (Number(task.created_by_user_id || 0) > 0) return 'typed_creator';
    if (isPrivateOrPersonal(task)) return 'private_task';
    if (isAiAssisted(task)) return 'protected_ai_assisted';
    if (isIntegration(task)) return 'protected_integration';
    if (task.human_touched) return 'human_touched';
    if (!hasExplicitMachineProvenance(task)) return 'unknown_or_human_provenance';
    return null;
}

function healthScoreMatches(existingScore, calculatedScore) {
    if (existingScore === null || existingScore === undefined || existingScore === '') return false;
    const current = Number(existingScore);
    const next = Number(calculatedScore);
    return Number.isFinite(current) && Number.isFinite(next) && current === next;
}

function machineLifecycleMarkerSql(taskAlias = 't') {
    return `(
        COALESCE(${taskAlias}.control_meta, '{}'::jsonb)->'machineLifecycle'->>'markerVersion' = '${MACHINE_LIFECYCLE_MARKER_VERSION}'
        AND COALESCE(${taskAlias}.control_meta, '{}'::jsonb)->'machineLifecycle'->>'autoArchivePolicy' = '${MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING}'
        AND COALESCE(${taskAlias}.control_meta, '{}'::jsonb)->'machineLifecycle'->>'serviceOwned' = 'true'
    )`;
}

function cancelledBookingAutoArchivePredicateSql(taskAlias = 't', bookingAlias = 'b', todayPlaceholder = '$1') {
    return `(
        ${machineLifecycleMarkerSql(taskAlias)}
        AND ${taskAlias}.archived_at IS NULL
        AND LOWER(COALESCE(${taskAlias}.status, 'todo')) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'archived')
        AND LOWER(COALESCE(${taskAlias}.status, 'todo')) <> 'in_progress'
        AND LOWER(COALESCE(${taskAlias}.workflow_state, 'todo')) <> 'in_progress'
        AND COALESCE(${taskAlias}.created_by_user_id, 0) = 0
        AND LOWER(COALESCE(${taskAlias}.created_by, '')) = 'rule_engine'
        AND LOWER(COALESCE(${taskAlias}.source_type, '')) = 'booking'
        AND LOWER(COALESCE(${taskAlias}.type, '')) IN ('auto', 'auto_complete')
        AND ${taskAlias}.source_id IS NOT NULL
        AND ${bookingAlias}.id::text = ${taskAlias}.source_id::text
        AND LOWER(COALESCE(${bookingAlias}.status, '')) IN ('cancelled', 'canceled')
        AND ${taskWorkloadDateSql(taskAlias)} IS NOT NULL
        AND ${taskWorkloadDateSql(taskAlias)} <= (${todayPlaceholder}::date - INTERVAL '7 days')::date
        AND ${taskAlias}.snoozed_until IS NULL
        AND COALESCE(${taskAlias}.focus_rank, 0) = 0
        AND LOWER(COALESCE(${taskAlias}.visibility, 'team')) NOT IN ('private', 'me_only', 'personal')
        AND LOWER(COALESCE(${taskAlias}.task_mode, 'work')) NOT IN ('private', 'me_only', 'personal')
        AND LOWER(COALESCE(${taskAlias}.source_module, '')) NOT IN ('hermes', 'integration', 'attendance')
        AND LOWER(COALESCE(${taskAlias}.source_type, '')) NOT IN ('ai_draft', 'ai_draft_bundle', 'hermes', 'integration', 'attendance', 'attendance_daily_review', 'recurring')
        AND LOWER(COALESCE(${taskAlias}.type, '')) NOT IN ('ai_draft', 'ai_draft_bundle', 'recurring')
        AND NOT ${taskHumanTouchSql(taskAlias)}
        AND NOT EXISTS (SELECT 1 FROM task_subtasks ts WHERE ts.task_id = ${taskAlias}.id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM task_dependencies td WHERE td.task_id = ${taskAlias}.id OR td.depends_on_task_id = ${taskAlias}.id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM task_observers tob WHERE tob.task_id = ${taskAlias}.id LIMIT 1)
    )`;
}

function selectCancelledBookingAutoArchiveCandidatesSql() {
    return `
        SELECT t.id, t.status AS prior_status
        FROM tasks t
        JOIN bookings b ON t.source_id IS NOT NULL AND b.id::text = t.source_id::text
        WHERE ${cancelledBookingAutoArchivePredicateSql('t', 'b', '$1')}
        ORDER BY t.id
        LIMIT $2
    `;
}

function selectCancelledBookingAutoArchiveShadowSql() {
    return `
        SELECT
            COUNT(*) FILTER (WHERE ${machineLifecycleMarkerSql('t')})::int AS marker_total,
            COUNT(*) FILTER (WHERE ${cancelledBookingAutoArchivePredicateSql('t', 'b', '$1')})::int AS candidates
        FROM tasks t
        JOIN bookings b ON t.source_id IS NOT NULL AND b.id::text = t.source_id::text
        WHERE ${machineLifecycleMarkerSql('t')}
          AND LOWER(COALESCE(t.source_type, '')) = 'booking'
          AND LOWER(COALESCE(b.status, '')) IN ('cancelled', 'canceled')
    `;
}

function archiveCancelledBookingAutoArchiveBatchSql() {
    return `
        WITH exact_candidates AS (
            SELECT t.id, t.status AS prior_status
            FROM tasks t
            JOIN bookings b ON t.source_id IS NOT NULL AND b.id::text = t.source_id::text
            WHERE t.id = ANY($1::int[])
              AND ${cancelledBookingAutoArchivePredicateSql('t', 'b', '$2')}
            ORDER BY t.id
            FOR UPDATE OF t SKIP LOCKED
        ),
        updated AS (
            UPDATE tasks t
            SET status = 'archived',
                archived_at = NOW(),
                archive_reason = $3
            FROM exact_candidates c
            WHERE t.id = c.id
              AND t.id = ANY($1::int[])
            RETURNING t.id, c.prior_status
        ),
        history AS (
            INSERT INTO task_action_history (
                task_id, action_type, actor_user_id, actor_name_snapshot, source_surface,
                old_value_json, new_value_json, meta_json, summary
            )
            SELECT
                u.id,
                $4,
                NULL,
                'task_lifecycle',
                'task_lifecycle_auto_archive',
                jsonb_build_object('status', u.prior_status),
                jsonb_build_object('status', 'archived'),
                jsonb_build_object(
                    'reason', $3,
                    'policy', $5,
                    'markerVersion', $6
                ),
                'Task automatically archived by cancelled booking machine lifecycle policy'
            FROM updated u
            RETURNING task_id
        )
        SELECT
            (SELECT COUNT(*) FROM exact_candidates)::int AS exact_count,
            (SELECT COUNT(*) FROM updated)::int AS archived,
            (SELECT COUNT(*) FROM history)::int AS history_count
    `;
}

async function tryAcquireCancelledBookingAutoArchiveLock(query) {
    const result = await query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [CANCELLED_BOOKING_AUTO_ARCHIVE_LOCK_KEY]);
    return result.rows?.[0]?.acquired === true;
}

async function runCancelledBookingAutoArchive(deps = {}) {
    const poolClient = deps.client || null;
    const ownsClient = !poolClient && !deps.query;
    const client = poolClient || (deps.query ? { query: deps.query } : await pool.connect());
    const query = client.query.bind(client);
    const now = deps.now || new Date();
    const today = deps.today || kyivDateString(now);
    const batchLimit = Math.max(1, Math.min(Number(deps.batchLimit) || CANCELLED_BOOKING_AUTO_ARCHIVE_BATCH_LIMIT, CANCELLED_BOOKING_AUTO_ARCHIVE_BATCH_LIMIT));
    const dryRun = deps.dryRun === true;

    try {
        if (dryRun) {
            const shadow = await query(selectCancelledBookingAutoArchiveShadowSql(), [today]);
            const markerTotal = Number(shadow.rows?.[0]?.marker_total || 0);
            const candidateCount = Number(shadow.rows?.[0]?.candidates || 0);
            const protectedCount = Math.max(0, markerTotal - candidateCount);
            const candidates = await query(selectCancelledBookingAutoArchiveCandidatesSql(), [today, batchLimit]);
            const candidateIds = (candidates.rows || []).map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);
            return {
                candidates: candidateCount,
                batchCandidates: candidateIds.length,
                archived: 0,
                protected: protectedCount,
                skipped: candidateIds.length,
                drift: 0,
                lockSkipped: false,
                dryRun: true
            };
        }

        await query('BEGIN');
        const lockAcquired = await tryAcquireCancelledBookingAutoArchiveLock(query);
        if (!lockAcquired) {
            await query('ROLLBACK');
            return {
                candidates: 0,
                batchCandidates: 0,
                archived: 0,
                protected: 0,
                skipped: 0,
                drift: 0,
                lockSkipped: true,
                dryRun: false
            };
        }

        const shadow = await query(selectCancelledBookingAutoArchiveShadowSql(), [today]);
        const markerTotal = Number(shadow.rows?.[0]?.marker_total || 0);
        const candidateCount = Number(shadow.rows?.[0]?.candidates || 0);
        const protectedCount = Math.max(0, markerTotal - candidateCount);
        const candidates = await query(selectCancelledBookingAutoArchiveCandidatesSql(), [today, batchLimit]);
        const candidateIds = (candidates.rows || []).map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0);

        if (!candidateIds.length) {
            await query('COMMIT');
            return {
                candidates: candidateCount,
                batchCandidates: 0,
                archived: 0,
                protected: protectedCount,
                skipped: 0,
                drift: 0,
                lockSkipped: false,
                dryRun: false
            };
        }

        const result = await query(
            archiveCancelledBookingAutoArchiveBatchSql(),
            [
                candidateIds,
                today,
                CANCELLED_BOOKING_AUTO_ARCHIVE_REASON,
                TASK_ACTION_TYPES.STATUS_CHANGED,
                MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING,
                MACHINE_LIFECYCLE_MARKER_VERSION
            ]
        );
        await query('COMMIT');

        const archived = Number(result.rows?.[0]?.archived || 0);
        const historyCount = Number(result.rows?.[0]?.history_count || 0);
        const exactCount = Number(result.rows?.[0]?.exact_count || 0);

        return {
            candidates: candidateCount,
            batchCandidates: candidateIds.length,
            archived,
            protected: protectedCount,
            skipped: Math.max(0, candidateIds.length - exactCount),
            drift: Math.max(0, candidateIds.length - archived),
            history: historyCount,
            lockSkipped: false,
            dryRun: false
        };
    } catch (err) {
        if (!dryRun) {
            try { await query('ROLLBACK'); } catch (rollbackErr) { log.error('Cancelled booking auto-archive rollback failed', rollbackErr); }
        }
        throw err;
    } finally {
        if (ownsClient && typeof client.release === 'function') client.release();
    }
}

function calculateHealthScore(task, now = new Date()) {
    let score = 100;

    // Overdue tasks lose 5 points per day
    if (task.date) {
        const taskDate = new Date(task.date + 'T23:59:59');
        if (taskDate < now && task.status !== 'done') {
            const overdueDays = Math.floor((now - taskDate) / 86400000);
            score -= overdueDays * 5;
        }
    }

    // Inactive tasks lose 2 points per day after 7 days
    const lastActivity = task.last_activity_at || task.updated_at || task.created_at;
    if (lastActivity) {
        const inactiveDays = Math.floor((now - new Date(lastActivity)) / 86400000);
        if (inactiveDays > 7) {
            score -= (inactiveDays - 7) * 2;
        }
    }

    // High priority tasks don't drop below 20
    if (task.priority === 'high' || task.priority === 'critical') {
        score = Math.max(score, 20);
    }

    return Math.max(0, Math.min(100, score));
}

async function runTaskLifecycle(deps = {}) {
    if (isTaskLifecycleRunning) {
        return { skipped: true, checked: 0, updated: 0, archived: 0 };
    }

    isTaskLifecycleRunning = true;
    try {
        const query = deps.query || pool.query.bind(pool);
        const now = deps.now || new Date();
        const tasks = await query(`
            SELECT t.id, t.date, t.status, t.priority, t.updated_at, t.created_at,
                   t.last_activity_at, t.business_context, t.health_score, t.source_type,
                   t.type, t.created_by, t.created_by_user_id, t.task_type, t.task_mode,
                   t.visibility, t.archived_at,
                   ${taskHumanTouchSql('t')} AS human_touched
            FROM tasks t
            WHERE LOWER(COALESCE(t.status, 'todo')) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'archived')
              AND t.archived_at IS NULL
        `);

        let archived = 0;
        let updated = 0;
        let skipped = 0;
        let archiveCandidates = 0;
        const autoArchive = await runCancelledBookingAutoArchive({
            query: deps.query ? query : undefined,
            now,
            batchLimit: deps.autoArchiveBatchLimit,
            dryRun: deps.autoArchiveDryRun === true
        });
        archived += Number(autoArchive.archived || 0);

        for (const task of tasks.rows) {
            const protectionReason = taskLifecycleProtectionReason(task);
            if (protectionReason) {
                skipped++;
                continue;
            }

            const score = calculateHealthScore(task, now);
            const businessContext = activeTaskBusinessContext(task.business_context || DEFAULT_TASK_BUSINESS_CONTEXT);

            if (score === 0) {
                archiveCandidates++;
            }

            if (healthScoreMatches(task.health_score, score)) {
                continue;
            }

            const result = await query(
                `UPDATE tasks
                 SET health_score = $1
                 WHERE id = $2
                   AND COALESCE(business_context, 'event_genix') = $3
                   AND archived_at IS NULL
                   AND LOWER(COALESCE(status, 'todo')) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'archived')
                   AND health_score IS DISTINCT FROM $1`,
                [score, task.id, businessContext]
            );
            updated += Number(result.rowCount || 0);
        }

        log.info(`Lifecycle: ${tasks.rows.length} checked, ${updated} updated, ${archiveCandidates} archive candidates, ${skipped} protected/skipped, ${archived} archived`);
        log.info(`Cancelled booking auto-archive: ${autoArchive.candidates} candidates, ${autoArchive.archived} archived, ${autoArchive.protected} protected, ${autoArchive.drift} drift/skipped`);
        return { skipped: false, checked: tasks.rows.length, updated, archived, archiveCandidates, protected: skipped, autoArchive };
    } catch (err) {
        log.error('Task lifecycle error', err);
        return { skipped: false, error: err.message };
    } finally {
        isTaskLifecycleRunning = false;
    }
}

module.exports = {
    runTaskLifecycle,
    calculateHealthScore,
    hasExplicitMachineProvenance,
    taskLifecycleProtectionReason,
    healthScoreMatches,
    runCancelledBookingAutoArchive,
    cancelledBookingAutoArchivePredicateSql,
    machineLifecycleMarkerSql,
    CANCELLED_BOOKING_AUTO_ARCHIVE_REASON,
    CANCELLED_BOOKING_AUTO_ARCHIVE_LOCK_KEY
};
