/**
 * services/taskLifecycle.js — Task health scoring
 * Runs daily, calculates health_score for explicitly machine-owned tasks.
 * Archive candidates are report-only until cleanup is approved separately.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { DEFAULT_TASK_BUSINESS_CONTEXT, activeTaskBusinessContext } = require('./taskBusinessScope');
const log = createLogger('TaskLifecycle');
let isTaskLifecycleRunning = false;

const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'archived']);
const PROTECTED_SOURCE_TYPES = new Set(['ai_draft', 'ai_draft_bundle', 'hermes', 'integration']);
const PRIVATE_VISIBILITIES = new Set(['private', 'me_only']);
const MACHINE_CREATED_BY = new Set(['rule_engine']);
const MACHINE_SOURCE_TYPES = new Set(['booking', 'manual']);
const MACHINE_TASK_TYPES = new Set(['auto', 'auto_complete']);

function normalized(value) {
    return String(value || '').trim().toLowerCase();
}

function isTerminalStatus(value) {
    return TERMINAL_STATUSES.has(normalized(value));
}

function isPrivateTask(task = {}) {
    return PRIVATE_VISIBILITIES.has(normalized(task.visibility)) || PRIVATE_VISIBILITIES.has(normalized(task.task_mode));
}

function hasExplicitMachineProvenance(task = {}) {
    const createdBy = normalized(task.created_by);
    const sourceType = normalized(task.source_type);
    const taskType = normalized(task.type);

    if (!MACHINE_CREATED_BY.has(createdBy)) return false;
    if (!MACHINE_SOURCE_TYPES.has(sourceType)) return false;
    if (!MACHINE_TASK_TYPES.has(taskType)) return false;
    return true;
}

function taskLifecycleProtectionReason(task = {}) {
    if (task.archived_at) return 'already_archived';
    if (isTerminalStatus(task.status)) return 'terminal_status';
    if (Number(task.created_by_user_id || 0) > 0) return 'typed_creator';
    if (isPrivateTask(task)) return 'private_task';
    if (PROTECTED_SOURCE_TYPES.has(normalized(task.source_type))) return 'protected_source';
    if (/hermes|integration/.test(normalized(task.created_by))) return 'protected_creator';
    if (task.human_touched) return 'human_touched';
    if (!hasExplicitMachineProvenance(task)) return 'unknown_or_human_provenance';
    return null;
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
            SELECT t.id, t.title, t.date, t.status, t.priority, t.updated_at, t.created_at,
                   t.last_activity_at, t.business_context, t.health_score, t.source_type,
                   t.type, t.created_by, t.created_by_user_id, t.task_type, t.task_mode,
                   t.visibility, t.archived_at,
                   EXISTS (
                       SELECT 1
                       FROM task_logs tl
                       WHERE tl.task_id = t.id
                         AND LOWER(COALESCE(tl.actor, '')) NOT IN ('', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle')
                       LIMIT 1
                   ) AS human_touched
            FROM tasks t
            WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'cancelled', 'archived')
              AND t.archived_at IS NULL
        `);

        let archived = 0;
        let updated = 0;
        let skipped = 0;
        let archiveCandidates = 0;

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

            const result = await query(
                "UPDATE tasks SET health_score = $1 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3 AND health_score IS DISTINCT FROM $1",
                [score, task.id, businessContext]
            );
            updated += Number(result.rowCount || 0);
        }

        log.info(`Lifecycle: ${tasks.rows.length} checked, ${updated} updated, ${archiveCandidates} archive candidates, ${skipped} protected/skipped, ${archived} archived`);
        return { skipped: false, checked: tasks.rows.length, updated, archived, archiveCandidates, protected: skipped };
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
    taskLifecycleProtectionReason
};
