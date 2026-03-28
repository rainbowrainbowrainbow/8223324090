/**
 * services/taskLifecycle.js — Task health scoring + auto-archive
 * v40.5.0: Runs daily, calculates health_score, archives dead tasks
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const log = createLogger('TaskLifecycle');

function calculateHealthScore(task) {
    const now = new Date();
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

async function runTaskLifecycle() {
    try {
        const tasks = await pool.query(`
            SELECT id, title, date, status, priority, updated_at, created_at, last_activity_at
            FROM tasks
            WHERE status NOT IN ('done', 'cancelled', 'archived')
              AND archived_at IS NULL
        `);

        let archived = 0;
        let updated = 0;

        for (const task of tasks.rows) {
            const score = calculateHealthScore(task);

            if (score === 0) {
                await pool.query(`
                    UPDATE tasks SET
                        status = 'archived',
                        archived_at = NOW(),
                        archive_reason = 'auto_expired',
                        health_score = 0
                    WHERE id = $1
                `, [task.id]);
                archived++;
            } else {
                await pool.query(
                    'UPDATE tasks SET health_score = $1 WHERE id = $2',
                    [score, task.id]
                );
                updated++;
            }
        }

        log.info(`Lifecycle: ${tasks.rows.length} checked, ${updated} updated, ${archived} archived`);
        return { checked: tasks.rows.length, updated, archived };
    } catch (err) {
        log.error('Task lifecycle error', err);
        return { error: err.message };
    }
}

module.exports = { runTaskLifecycle, calculateHealthScore };
