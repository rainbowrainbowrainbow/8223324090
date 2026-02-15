/**
 * services/kleshnya.js — Клешня: центральний процесор Tasker (v10.0)
 *
 * Клешня:
 *  - створює задачі (від подій, тригерів, вручну)
 *  - контролює виконання (дедлайни, залежності)
 *  - ескалює прострочені задачі (4 рівні)
 *  - нараховує бали за виконання
 *  - надсилає нагадування через Telegram
 *  - веде журнал змін (task_logs)
 *
 * Типи задач:
 *  - HUMAN: 100% відповідальність людини
 *  - BOT: 100% системне виконання
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, getConfiguredThreadId, telegramRequest } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Kleshnya');

// --- Escalation messages (4 levels) ---
const ESCALATION_MESSAGES = [
    // Level 0 — soft reminder
    (task) => `📋 Нагадую: задача "<b>${esc(task.title)}</b>" очікує виконання.${task.deadline ? `\n⏰ Дедлайн: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 1 — firmer
    (task) => `⚠️ Задача "<b>${esc(task.title)}</b>" все ще не виконана.\nБудь ласка, оновіть статус.${task.deadline ? `\n⏰ Дедлайн: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 2 — urgent
    (task) => `🔴 Задача "<b>${esc(task.title)}</b>" прострочена!\nПотрібна увага.${task.deadline ? `\n⏰ Дедлайн був: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 3 — director escalation
    (task) => `🚨 <b>Ескалація:</b> задача "<b>${esc(task.title)}</b>" не виконана.\n👤 Відповідальний: ${task.owner || task.assigned_to || '—'}\n⏰ Дедлайн: ${task.deadline ? formatDeadline(task.deadline) : '—'}\nПотрібне рішення.`
];

// --- Points rules ---
const POINTS = {
    ON_TIME:          { monthly: 5,  permanent: 2,  reason: 'Виконано вчасно' },
    EARLY:            { monthly: 7,  permanent: 3,  reason: 'Виконано із запасом часу' },
    LATE_MINOR:       { monthly: -2, permanent: 0,  reason: 'Прострочено < 1 год' },
    LATE_MAJOR:       { monthly: -5, permanent: -1, reason: 'Прострочено > 1 год' },
    NO_STATUS_UPDATE: { monthly: -3, permanent: 0,  reason: 'Не оновлено статус' },
    HIGH_PRIORITY:    { monthly: 10, permanent: 5,  reason: 'High priority вчасно' }
};

// --- Helpers ---
function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDeadline(deadline) {
    const d = new Date(deadline);
    return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// --- Core functions ---

/**
 * Create a task through Kleshnya (with logging + notification)
 */
async function createTask(data) {
    const {
        title, description, date, priority = 'normal', assigned_to, owner,
        task_type = 'human', deadline, time_window_start, time_window_end,
        dependency_ids = [], control_policy, source_type = 'manual', source_id,
        category = 'admin', template_id, afisha_id, created_by = 'kleshnya'
    } = data;

    if (!title || !title.trim()) throw new Error('title required');

    const policy = control_policy || { reminder_minutes: [60, 30, 10], escalation_after_minutes: 120 };

    const result = await pool.query(
        `INSERT INTO tasks (title, description, date, priority, assigned_to, owner, created_by,
         task_type, deadline, time_window_start, time_window_end, dependency_ids,
         control_policy, source_type, source_id, category, template_id, afisha_id, type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [title.trim(), description || null, date || null, priority, assigned_to || null, owner || null,
         created_by, task_type, deadline || null, time_window_start || null, time_window_end || null,
         dependency_ids, JSON.stringify(policy), source_type, source_id || null,
         category, template_id || null, afisha_id || null, source_type === 'recurring' ? 'recurring' : 'manual']
    );

    const task = result.rows[0];

    // Log creation
    await logTaskAction(task.id, 'created', null, title, created_by);

    // Notify assigned person
    if (assigned_to && task_type === 'human') {
        await notifyTaskAssigned(task);
    }

    log.info(`Task created: #${task.id} "${title}" [${task_type}] assigned=${assigned_to || '—'} owner=${owner || '—'}`);
    return task;
}

/**
 * Update task status (with logging, points, notification)
 */
async function updateTaskStatus(taskId, newStatus, actor = 'system') {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) throw new Error('Task not found');

    const task = taskResult.rows[0];
    const oldStatus = task.status;

    if (oldStatus === newStatus) return task;

    const completedAt = newStatus === 'done' ? 'NOW()' : 'NULL';
    await pool.query(
        `UPDATE tasks SET status=$1, updated_at=NOW(), completed_at=${completedAt}, escalation_level=0 WHERE id=$2`,
        [newStatus, taskId]
    );

    // Log status change
    await logTaskAction(taskId, 'status_changed', oldStatus, newStatus, actor);

    // Award points on completion
    if (newStatus === 'done' && task.task_type === 'human') {
        const assignee = task.assigned_to || task.owner;
        if (assignee) {
            await evaluateAndAwardPoints(task, assignee);
        }
    }

    // Notify about status change
    await notifyTaskStatusChanged(task, oldStatus, newStatus, actor);

    log.info(`Task #${taskId} status: ${oldStatus} → ${newStatus} by ${actor}`);

    const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    return updated.rows[0];
}

/**
 * Check task dependencies — are all blocking tasks done?
 */
async function checkDependencies(taskId) {
    const taskResult = await pool.query('SELECT dependency_ids FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return false;

    const deps = taskResult.rows[0].dependency_ids;
    if (!deps || deps.length === 0) return true; // no dependencies — unblocked

    const result = await pool.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'done') as done FROM tasks WHERE id = ANY($1)`,
        [deps]
    );

    return parseInt(result.rows[0].total) === parseInt(result.rows[0].done);
}

/**
 * Escalate a task to the next level
 */
async function escalateTask(taskId) {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return;

    const task = taskResult.rows[0];
    const newLevel = Math.min((task.escalation_level || 0) + 1, 3);

    await pool.query(
        'UPDATE tasks SET escalation_level = $1, last_reminded_at = NOW(), updated_at = NOW() WHERE id = $2',
        [newLevel, taskId]
    );

    await logTaskAction(taskId, 'escalated', String(task.escalation_level), String(newLevel), 'kleshnya');

    // Send escalation message
    const msgFn = ESCALATION_MESSAGES[newLevel] || ESCALATION_MESSAGES[0];
    const text = msgFn(task);

    // Level 3 — send to director
    if (newLevel >= 3) {
        await sendToDirector(text);
    }

    // Send to group with @mention
    await sendTaskNotification(text, task);

    // Deduct points for overdue
    if (newLevel >= 2 && task.assigned_to) {
        const penalty = newLevel >= 2 ? POINTS.LATE_MAJOR : POINTS.LATE_MINOR;
        await awardPoints(task.assigned_to, penalty.monthly, 'monthly', penalty.reason, taskId);
        if (penalty.permanent !== 0) {
            await awardPoints(task.assigned_to, penalty.permanent, 'permanent', penalty.reason, taskId);
        }
    }

    log.info(`Task #${taskId} escalated to level ${newLevel}`);
}

/**
 * Send a reminder for a task
 */
async function sendReminder(taskId) {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return;

    const task = taskResult.rows[0];
    const level = task.escalation_level || 0;
    const msgFn = ESCALATION_MESSAGES[level] || ESCALATION_MESSAGES[0];
    const text = msgFn(task);

    await pool.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [taskId]);
    await logTaskAction(taskId, 'reminded', null, `level ${level}`, 'kleshnya');
    await sendTaskNotification(text, task);

    log.info(`Reminder sent for task #${taskId} (level ${level})`);
}

/**
 * Evaluate task completion and award points
 */
async function evaluateAndAwardPoints(task, username) {
    if (!task.deadline) {
        // No deadline — standard points
        await awardPoints(username, POINTS.ON_TIME.monthly, 'monthly', POINTS.ON_TIME.reason, task.id);
        await awardPoints(username, POINTS.ON_TIME.permanent, 'permanent', POINTS.ON_TIME.reason, task.id);

        if (task.priority === 'high') {
            await awardPoints(username, POINTS.HIGH_PRIORITY.monthly, 'monthly', POINTS.HIGH_PRIORITY.reason, task.id);
            await awardPoints(username, POINTS.HIGH_PRIORITY.permanent, 'permanent', POINTS.HIGH_PRIORITY.reason, task.id);
        }
        return;
    }

    const now = new Date();
    const deadline = new Date(task.deadline);
    const diffMs = deadline - now;
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes > 60) {
        // Completed with more than 1h to spare — early bonus
        await awardPoints(username, POINTS.EARLY.monthly, 'monthly', POINTS.EARLY.reason, task.id);
        await awardPoints(username, POINTS.EARLY.permanent, 'permanent', POINTS.EARLY.reason, task.id);
    } else if (diffMinutes >= 0) {
        // On time
        await awardPoints(username, POINTS.ON_TIME.monthly, 'monthly', POINTS.ON_TIME.reason, task.id);
        await awardPoints(username, POINTS.ON_TIME.permanent, 'permanent', POINTS.ON_TIME.reason, task.id);
    } else if (diffMinutes > -60) {
        // Late by less than 1 hour
        await awardPoints(username, POINTS.LATE_MINOR.monthly, 'monthly', POINTS.LATE_MINOR.reason, task.id);
    } else {
        // Late by more than 1 hour
        await awardPoints(username, POINTS.LATE_MAJOR.monthly, 'monthly', POINTS.LATE_MAJOR.reason, task.id);
        await awardPoints(username, POINTS.LATE_MAJOR.permanent, 'permanent', POINTS.LATE_MAJOR.reason, task.id);
    }

    // High priority bonus (only if on time)
    if (task.priority === 'high' && diffMinutes >= 0) {
        await awardPoints(username, POINTS.HIGH_PRIORITY.monthly, 'monthly', POINTS.HIGH_PRIORITY.reason, task.id);
        await awardPoints(username, POINTS.HIGH_PRIORITY.permanent, 'permanent', POINTS.HIGH_PRIORITY.reason, task.id);
    }
}

/**
 * Award points to a user
 */
async function awardPoints(username, points, type, reason, taskId = null) {
    if (points === 0) return;

    const month = getCurrentMonth();

    // Upsert user_points
    if (type === 'monthly') {
        await pool.query(
            `INSERT INTO user_points (username, monthly_points, month, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (username, month) DO UPDATE SET monthly_points = user_points.monthly_points + $2, updated_at = NOW()`,
            [username, points, month]
        );
    } else {
        await pool.query(
            `INSERT INTO user_points (username, permanent_points, month, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (username, month) DO UPDATE SET permanent_points = user_points.permanent_points + $2, updated_at = NOW()`,
            [username, points, month]
        );
    }

    // Record transaction
    await pool.query(
        'INSERT INTO point_transactions (username, points, type, reason, task_id) VALUES ($1,$2,$3,$4,$5)',
        [username, points, type, reason, taskId]
    );

    log.info(`Points: ${username} ${points > 0 ? '+' : ''}${points} ${type} — ${reason}`);
}

/**
 * Log a task action
 */
async function logTaskAction(taskId, action, oldValue, newValue, actor = 'system') {
    try {
        await pool.query(
            'INSERT INTO task_logs (task_id, action, old_value, new_value, actor) VALUES ($1,$2,$3,$4,$5)',
            [taskId, action, oldValue || null, newValue || null, actor]
        );
    } catch (err) {
        log.error(`Task log error: ${err.message}`);
    }
}

// --- Telegram notification helpers ---

/**
 * Send task notification to configured chat (with @mention if possible)
 */
async function sendTaskNotification(text, task) {
    const chatId = await getConfiguredChatId();
    if (!chatId) return;

    // Try personal notification first
    const personalSent = await sendPersonalNotification(text, task);

    // Always send to group as well (with @mention if no personal chat)
    let groupText = text;
    if (!personalSent && task.assigned_to) {
        const tgUsername = await getTelegramUsername(task.assigned_to);
        if (tgUsername) {
            groupText += `\n\n👤 @${tgUsername}`;
        }
    }

    await sendTelegramMessage(chatId, groupText);
}

/**
 * Try to send personal notification to user's Telegram
 */
async function sendPersonalNotification(text, task) {
    const assignee = task.assigned_to;
    if (!assignee) return false;

    try {
        const result = await pool.query(
            'SELECT telegram_chat_id FROM users WHERE username = $1 AND telegram_chat_id IS NOT NULL',
            [assignee]
        );
        if (result.rows.length > 0 && result.rows[0].telegram_chat_id) {
            await sendTelegramMessage(String(result.rows[0].telegram_chat_id), text);
            return true;
        }
    } catch (err) {
        log.error(`Personal notification error: ${err.message}`);
    }
    return false;
}

/**
 * Get telegram_username for @mention from users or staff table
 */
async function getTelegramUsername(username) {
    try {
        // Check users table first
        const userResult = await pool.query(
            'SELECT telegram_username FROM users WHERE username = $1 AND telegram_username IS NOT NULL',
            [username]
        );
        if (userResult.rows.length > 0 && userResult.rows[0].telegram_username) {
            return userResult.rows[0].telegram_username;
        }

        // Fallback: check staff by name match
        const staffResult = await pool.query(
            'SELECT telegram_username FROM staff WHERE telegram_username IS NOT NULL AND (name ILIKE $1 OR name ILIKE $2) LIMIT 1',
            [username, `%${username}%`]
        );
        if (staffResult.rows.length > 0) {
            return staffResult.rows[0].telegram_username;
        }
    } catch (err) {
        log.error(`getTelegramUsername error: ${err.message}`);
    }
    return null;
}

/**
 * Notify about new task assignment
 */
async function notifyTaskAssigned(task) {
    const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🔵' : '';
    let text = `📌 <b>Нова задача</b>${priorityIcon ? ' ' + priorityIcon : ''}\n\n`;
    text += `📋 ${esc(task.title)}\n`;
    if (task.description) text += `📝 ${esc(task.description)}\n`;
    if (task.date) text += `📅 ${task.date}\n`;
    if (task.deadline) text += `⏰ Дедлайн: ${formatDeadline(task.deadline)}\n`;
    text += `👤 Виконавець: ${task.assigned_to}\n`;
    if (task.owner && task.owner !== task.assigned_to) text += `👔 Відповідальний: ${task.owner}\n`;
    text += `\n🦀 Клешня`;

    await sendTaskNotification(text, task);
}

/**
 * Notify about task status change
 */
async function notifyTaskStatusChanged(task, oldStatus, newStatus, actor) {
    const statusIcons = { todo: '⬜', in_progress: '🔄', done: '✅' };
    const statusNames = { todo: 'Очікує', in_progress: 'В роботі', done: 'Завершено' };

    let text = `⚡ <b>Статус задачі змінено</b>\n\n`;
    text += `📋 ${esc(task.title)}\n`;
    text += `${statusIcons[oldStatus] || '?'} ${statusNames[oldStatus] || oldStatus} → ${statusIcons[newStatus] || '?'} ${statusNames[newStatus] || newStatus}\n`;
    text += `👤 Змінив: ${actor}\n`;
    text += `\n🦀 Клешня`;

    // Only send to group (not personal for status changes)
    const chatId = await getConfiguredChatId();
    if (chatId) {
        await sendTelegramMessage(chatId, text);
    }
}

/**
 * Send escalation to director
 */
async function sendToDirector(text) {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            await sendTelegramMessage(result.rows[0].value, text);
        }
    } catch (err) {
        log.error(`Send to director error: ${err.message}`);
    }
}

/**
 * Register user's Telegram chat_id (called from /start command)
 */
async function registerTelegramChatId(username, chatId) {
    try {
        await pool.query(
            'UPDATE users SET telegram_chat_id = $1 WHERE username = $2',
            [chatId, username]
        );
        log.info(`Telegram chat_id registered: ${username} → ${chatId}`);
        return true;
    } catch (err) {
        log.error(`registerTelegramChatId error: ${err.message}`);
        return false;
    }
}

/**
 * Get tasks that need reminders (called by scheduler)
 * Returns tasks where deadline is approaching or passed
 */
async function getTasksNeedingReminders() {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks
            WHERE status != 'done'
              AND task_type = 'human'
              AND deadline IS NOT NULL
              AND (
                last_reminded_at IS NULL
                OR last_reminded_at < NOW() - INTERVAL '30 minutes'
              )
            ORDER BY deadline ASC
        `);
        return result.rows;
    } catch (err) {
        log.error(`getTasksNeedingReminders error: ${err.message}`);
        return [];
    }
}

/**
 * Get overdue tasks (deadline passed, not done)
 */
async function getOverdueTasks() {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks
            WHERE status != 'done'
              AND deadline IS NOT NULL
              AND deadline < NOW()
            ORDER BY deadline ASC
        `);
        return result.rows;
    } catch (err) {
        log.error(`getOverdueTasks error: ${err.message}`);
        return [];
    }
}

/**
 * Process task reminders — called by scheduler every minute
 */
async function processReminders() {
    const tasks = await getTasksNeedingReminders();
    const now = new Date();

    for (const task of tasks) {
        const deadline = new Date(task.deadline);
        const diffMinutes = (deadline - now) / (1000 * 60);
        const policy = task.control_policy || { reminder_minutes: [60, 30, 10], escalation_after_minutes: 120 };

        if (diffMinutes < 0) {
            // Overdue — escalate
            const overdueMinutes = Math.abs(diffMinutes);
            const escalateAfter = policy.escalation_after_minutes || 120;

            if (overdueMinutes > escalateAfter * (task.escalation_level + 1)) {
                await escalateTask(task.id);
            } else if (!task.last_reminded_at || (now - new Date(task.last_reminded_at)) > 30 * 60 * 1000) {
                await sendReminder(task.id);
            }
        } else {
            // Approaching deadline — check reminder_minutes
            const reminderMinutes = policy.reminder_minutes || [60, 30, 10];
            for (const rm of reminderMinutes) {
                if (diffMinutes <= rm && diffMinutes > rm - 1) {
                    await sendReminder(task.id);
                    break;
                }
            }
        }
    }
}

/**
 * Get user points summary
 */
async function getUserPoints(username) {
    const month = getCurrentMonth();
    try {
        const result = await pool.query(
            'SELECT * FROM user_points WHERE username = $1 AND month = $2',
            [username, month]
        );
        if (result.rows.length === 0) {
            return { username, permanent_points: 0, monthly_points: 0, month };
        }
        return result.rows[0];
    } catch (err) {
        log.error(`getUserPoints error: ${err.message}`);
        return { username, permanent_points: 0, monthly_points: 0, month };
    }
}

/**
 * Get all users' points for leaderboard
 */
async function getAllPoints() {
    const month = getCurrentMonth();
    try {
        const result = await pool.query(
            `SELECT username,
                    COALESCE(SUM(permanent_points), 0) as permanent_total,
                    COALESCE(MAX(CASE WHEN month = $1 THEN monthly_points ELSE 0 END), 0) as monthly_current
             FROM user_points
             GROUP BY username
             ORDER BY permanent_total DESC`,
            [month]
        );
        return result.rows;
    } catch (err) {
        log.error(`getAllPoints error: ${err.message}`);
        return [];
    }
}

/**
 * Reset monthly points (called on 1st of each month)
 */
async function resetMonthlyPoints() {
    const month = getCurrentMonth();
    log.info(`Monthly points reset for ${month}`);
    // Monthly points are per-month rows, so no reset needed — new month = new row
    // But we can log it
    await logTaskAction(0, 'monthly_reset', null, month, 'kleshnya');
}

module.exports = {
    createTask, updateTaskStatus, checkDependencies,
    escalateTask, sendReminder, awardPoints, evaluateAndAwardPoints,
    logTaskAction, processReminders,
    getUserPoints, getAllPoints, resetMonthlyPoints,
    registerTelegramChatId, getOverdueTasks,
    POINTS, ESCALATION_MESSAGES
};
