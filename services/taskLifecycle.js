/**
 * services/taskLifecycle.js — Task health scoring + auto-archive
 * v40.5.0: Runs daily, calculates health_score, archives dead tasks
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { DEFAULT_TASK_BUSINESS_CONTEXT, activeTaskBusinessContext } = require('./taskBusinessScope');
const log = createLogger('TaskLifecycle');
let isTaskLifecycleRunning = false;

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
            SELECT id, title, date, status, priority, updated_at, created_at, last_activity_at, business_context
            FROM tasks
            WHERE status NOT IN ('done', 'cancelled', 'archived')
              AND archived_at IS NULL
        `);

        let archived = 0;
        let updated = 0;

        for (const task of tasks.rows) {
            const score = calculateHealthScore(task, now);
            const businessContext = activeTaskBusinessContext(task.business_context || DEFAULT_TASK_BUSINESS_CONTEXT);

            if (score === 0) {
                await query(`
                    UPDATE tasks SET
                        status = 'archived',
                        archived_at = NOW(),
                        archive_reason = 'auto_expired',
                        health_score = 0
                    WHERE id = $1
                      AND COALESCE(business_context, 'event_genix') = $2
                `, [task.id, businessContext]);
                archived++;
            } else {
                await query(
                    "UPDATE tasks SET health_score = $1 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3",
                    [score, task.id, businessContext]
                );
                updated++;
            }
        }

        log.info(`Lifecycle: ${tasks.rows.length} checked, ${updated} updated, ${archived} archived`);
        return { skipped: false, checked: tasks.rows.length, updated, archived };
    } catch (err) {
        log.error('Task lifecycle error', err);
        return { skipped: false, error: err.message };
    } finally {
        isTaskLifecycleRunning = false;
    }
}

module.exports = { runTaskLifecycle, calculateHealthScore };
