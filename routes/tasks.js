/**
 * routes/tasks.js — Tasks CRUD + Kleshnya integration (v10.0)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth');

// v39.8: Security — require authentication for all task endpoints
router.use(authenticateToken);
// v40: Validate :id param is numeric
router.param('id', (req, res, next, val) => { if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' }); next(); });
const { createLogger } = require('../utils/logger');
const { getPermissions } = require('../config/roles');
const { buildTaskVisibilityScope, canMutateTask } = require('../services/taskPolicy');
const {
    completeTask,
    getAssignableTaskOwner,
    listTaskOwnerCandidates,
    reassignTaskOwner,
    resolveDeadline,
    rescheduleTask
} = require('../services/taskExecution');
const { listTaskActionHistory } = require('../services/taskActionHistory');
const { deriveTaskIntelligence } = require('../services/taskIntelligence');

const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { formatTaskNotification } = require('../services/templates');
const log = createLogger('Tasks');
let _triggerAlertBroadcast;
try { _triggerAlertBroadcast = require('./dashboard').triggerAlertBroadcast; } catch {}
function _alertPush() { if (_triggerAlertBroadcast) _triggerAlertBroadcast(); }

// Lazy require to avoid circular dependency
function getKleshnya() {
    return require('../services/kleshnya');
}

// v19.10: Send task notification to Telegram (fire-and-forget)
async function notifyTaskAssignment(task, username) {
    try {
        const chatId = await getConfiguredChatId();
        if (!chatId) return { sent: false, reason: 'no_chat_id' };
        const text = formatTaskNotification('task_assigned', task, { username });
        if (!text) return { sent: false, reason: 'empty_template' };
        const result = await sendTelegramMessage(chatId, text);
        return { sent: !!result?.ok, result };
    } catch (err) {
        log.error(`Task notification failed: ${err.message}`);
        return { sent: false, reason: 'error', error: err.message };
    }
}

function taskAssigneeChanged(oldTask = {}, newTask = {}) {
    const oldOwner = Number(oldTask.owner_user_id || 0);
    const newOwner = Number(newTask.owner_user_id || 0);
    const oldLabel = String(oldTask.assigned_to || '');
    const newLabel = String(newTask.assigned_to || '');
    return oldOwner !== newOwner || oldLabel !== newLabel;
}

const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'normal', 'high'];
const VALID_CATEGORIES = ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement', 'operational', 'maintenance'];
const VALID_TASK_TYPES = ['human', 'bot'];

async function resolveTypedTaskOwner(input = {}, actor = null) {
    const ownerUserId = input.owner_user_id ?? input.ownerUserId;
    const assigned = input.assigned_to ?? input.assignedTo;
    const candidate = ownerUserId ?? (/^\d+$/.test(String(assigned || '')) ? assigned : null);
    if (!candidate) return null;
    const owner = await getAssignableTaskOwner(candidate, { actor });
    return {
        ownerUserId: owner.id,
        assignedToSnapshot: owner.label,
        owner
    };
}

function normalizeTaskPayload(row) {
    const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
    const ownerState = row.owner_user_id ? 'typed' : (row.assigned_to || row.owner ? 'legacy_unknown_owner' : 'unassigned');
    return {
        ...row,
        ownerLabel,
        ownerState,
        ownerUserId: row.owner_user_id || null,
        intelligence: deriveTaskIntelligence({
            ...row,
            owner_label: ownerLabel,
            ownerState
        })
    };
}

function sourceSurface(body = {}, fallback = 'task_detail') {
    const raw = String(body.sourceSurface || body.source_surface || fallback).trim();
    if (raw === 'manager_queue_task_execution_v2') return raw;
    if (raw === 'task_detail') return raw;
    if (raw === 'task_page') return raw;
    return fallback;
}

function sendTaskActionError(res, err) {
    const status = err.statusCode || 500;
    if (status >= 500) log.error('Task action error', err);
    return res.status(status).json({
        success: false,
        error: err.message || 'Task action failed',
        code: err.code || 'TASK_ACTION_FAILED'
    });
}

// GET /api/tasks — list with optional filters + pagination (v19.10)
router.get('/', async (req, res) => {
    try {
        const { status, date, assigned_to, owner, owner_user_id, afisha_id, type, task_type, category, date_from, date_to, page, limit: lim } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status && VALID_STATUSES.includes(status)) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            conditions.push(`date = $${idx++}`);
            params.push(date);
        }
        if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
            conditions.push(`date >= $${idx++}`);
            params.push(date_from);
        }
        if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
            conditions.push(`date <= $${idx++}`);
            params.push(date_to);
        }
        if (assigned_to) {
            if (/^\d+$/.test(String(assigned_to))) {
                conditions.push(`t.owner_user_id = $${idx++}`);
                params.push(parseInt(assigned_to, 10));
            } else {
                conditions.push(`(t.owner_user_id IS NULL AND t.assigned_to = $${idx++})`);
                params.push(assigned_to);
            }
        }
        if (owner) {
            conditions.push(`(t.owner_user_id IS NULL AND t.owner = $${idx++})`);
            params.push(owner);
        }
        if (owner_user_id && /^\d+$/.test(String(owner_user_id))) {
            conditions.push(`t.owner_user_id = $${idx++}`);
            params.push(parseInt(owner_user_id, 10));
        }
        if (afisha_id && /^\d+$/.test(afisha_id)) {
            conditions.push(`afisha_id = $${idx++}`);
            params.push(parseInt(afisha_id));
        }
        if (type && ['recurring', 'afisha', 'manual', 'template', 'auto_complete', 'auto'].includes(type)) {
            conditions.push(`type = $${idx++}`);
            params.push(type);
        }
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            conditions.push(`task_type = $${idx++}`);
            params.push(task_type);
        }
        if (category && VALID_CATEGORIES.includes(category)) {
            conditions.push(`category = $${idx++}`);
            params.push(category);
        }

        // Role/object visibility: typed owner_user_id first, legacy string fallback for unmapped tasks.
        if (req.user) {
            const visibility = buildTaskVisibilityScope(req.user, params, 't');
            if (visibility) conditions.push(visibility.replace(/^AND\s+/i, ''));
            idx = params.length + 1;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Pagination (optional — backwards compatible: omit page/limit to get all)
        const limit = Math.min(parseInt(lim) || 500, 500);
        const offset = ((parseInt(page) || 1) - 1) * limit;
        params.push(limit, offset);

        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             ${where}
             ORDER BY
                CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 END,
                t.created_at DESC
            LIMIT $${idx++} OFFSET $${idx++}`,
            params
        );
        res.json(result.rows.map(normalizeTaskPayload));
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v20.9.16: GET /api/tasks/permissions — current user's task permissions
router.get('/permissions', (req, res) => {
    const perms = getPermissions(req.user?.role);
    res.json({ success: true, permissions: perms, role: req.user?.role });
});

// GET /api/tasks/owners — active assignable users for typed task ownership
router.get('/owners', async (req, res) => {
    try {
        const perms = getPermissions(req.user?.role);
        if (!perms.canCreateTasks && !perms.canAssignAnyone && !['all', 'department'].includes(perms.taskVisibility)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const users = await listTaskOwnerCandidates({ actor: req.user });
        res.json({
            success: true,
            users,
            meta: {
                canonicalField: 'tasks.owner_user_id',
                legacyDisplayFields: ['assigned_to', 'owner']
            }
        });
    } catch (err) {
        log.error('Task owners lookup error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/:id — single task
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (id === 'logs') return res.status(400).json({ error: 'Use /api/tasks/:id/logs' });
        const params = [id];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             WHERE t.id = $1 ${visibility}
             LIMIT 1`,
            params
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json(normalizeTaskPayload(result.rows[0]));
    } catch (err) {
        log.error('Get by id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/:id/history — durable task execution action history
router.get('/:id/history', async (req, res) => {
    try {
        const visibleParams = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 50));
        const history = await listTaskActionHistory(req.params.id, { limit });
        res.json({
            success: true,
            history,
            meta: {
                source: 'task_action_history',
                newestFirst: true,
                bounded: limit
            }
        });
    } catch (err) {
        log.error('Get task action history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/complete', async (req, res) => {
    try {
        const result = await completeTask(req.params.id, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_complete'
        });
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.status'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.post('/:id/reassign', async (req, res) => {
    try {
        const ownerUserId = req.body?.ownerUserId ?? req.body?.owner_user_id;
        const result = await reassignTaskOwner(req.params.id, ownerUserId, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_reassign'
        });
        notifyTaskAssignment(result.task, req.user?.username || 'system').catch(() => {});
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            owner: result.owner,
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.owner_user_id'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.post('/:id/reschedule', async (req, res) => {
    try {
        const deadline = resolveDeadline(req.body || {});
        const result = await rescheduleTask(req.params.id, deadline, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_reschedule'
        });
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.deadline'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

// v10.0: GET /api/tasks/:id/logs — task change history
router.get('/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        const visibleParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const result = await pool.query(
            'SELECT * FROM task_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 100',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get task logs error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks — create (via Kleshnya) — admin/user only
router.post('/', requireRole('admin', 'user'), async (req, res) => {
    try {
        const b = req.body;
        // Support both snake_case and camelCase (for external integrations like OpenClaw)
        const title = b.title;
        const description = b.description;
        const date = b.date;
        const priority = b.priority;
        const typedOwner = await resolveTypedTaskOwner(b, req.user);
        const assigned_to = typedOwner?.assignedToSnapshot || b.assigned_to || b.assignedTo;
        const owner_user_id = typedOwner?.ownerUserId || null;
        const owner = b.owner;
        const type = b.type;
        const template_id = b.template_id || b.templateId;
        const afisha_id = b.afisha_id || b.afishaId;
        const category = b.category;
        const task_type = b.task_type || b.taskType;
        const deadline = b.deadline;
        const time_window_start = b.time_window_start || b.timeWindowStart;
        const time_window_end = b.time_window_end || b.timeWindowEnd;
        const dependency_ids = b.dependency_ids || b.dependencyIds;
        const control_policy = b.control_policy || b.controlPolicy;
        const source_type = b.source_type || b.sourceType;
        const source_id = b.source_id || b.sourceId;

        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

        // v33.3: Duplicate protection for manual tasks (same title + same date)
        const srcType = source_type || 'manual';
        const force = b.force === true || b.force === 'true';
        if (srcType === 'manual' && !force && date) {
            const dupCheck = await pool.query(
                `SELECT id, status FROM tasks WHERE title = $1 AND date = $2 AND source_type = 'manual'
                 AND status NOT IN ('done','archived','cancelled') ORDER BY id DESC LIMIT 1`,
                [title.trim(), date]
            );
            if (dupCheck.rows.length > 0) {
                const dup = dupCheck.rows[0];
                return res.status(409).json({
                    error: 'duplicate',
                    message: `Задача "${title}" вже існує`,
                    existingId: dup.id,
                    existingStatus: dup.status,
                    hint: 'Передай force=true щоб все одно створити'
                });
            }
        }

        const username = req.user?.username || 'system';
        const kleshnya = getKleshnya();

        const task = await kleshnya.createTask({
            title, description, date,
            priority: VALID_PRIORITIES.includes(priority) ? priority : 'normal',
            assigned_to: assigned_to || null,
            owner_user_id,
            owner: owner || null,
            task_type: VALID_TASK_TYPES.includes(task_type) ? task_type : 'human',
            deadline: deadline || null,
            time_window_start: time_window_start || null,
            time_window_end: time_window_end || null,
            dependency_ids: dependency_ids || [],
            control_policy: control_policy || undefined,
            source_type: source_type || 'manual',
            source_id: source_id || null,
            category: VALID_CATEGORIES.includes(category) ? category : 'admin',
            template_id: template_id || null,
            afisha_id: afisha_id || null,
            created_by: username
        });

        res.json({ success: true, task });
        _alertPush();
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/tasks/:id — full update — admin/user only
// v19.10: Optimistic locking via version column
router.put('/:id', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { id } = req.params;
        const b = req.body;
        // v40: Support partial updates — merge with existing task
        const existingParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, existingParams, 't');
        const existing = await pool.query(`SELECT t.* FROM tasks t WHERE t.id = $1 ${visibility} LIMIT 1`, existingParams);
        if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
        const old = existing.rows[0];
        if (!canMutateTask(req.user, old)) return res.status(403).json({ error: 'Недостатньо прав для зміни задачі' });

        const title = b.title || old.title;
        const description = b.description !== undefined ? b.description : old.description;
        const date = b.date !== undefined ? b.date : old.date;
        const status = b.status || old.status;
        const priority = b.priority || old.priority;
        const typedOwner = await resolveTypedTaskOwner(b, req.user);
        const assigned_to = typedOwner?.assignedToSnapshot || b.assigned_to || b.assignedTo || old.assigned_to;
        const owner_user_id = typedOwner ? typedOwner.ownerUserId : old.owner_user_id;
        const owner = b.owner !== undefined ? b.owner : old.owner;
        const category = b.category || old.category;
        const task_type = b.task_type || b.taskType || old.task_type;
        const deadline = b.deadline !== undefined ? b.deadline : old.deadline;
        const time_window_start = b.time_window_start || b.timeWindowStart || old.time_window_start;
        const time_window_end = b.time_window_end || b.timeWindowEnd || old.time_window_end;
        const clientVersion = b.version !== undefined ? parseInt(b.version) : null;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

        const taskStatus = VALID_STATUSES.includes(status) ? status : 'todo';
        const taskPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const taskCategory = VALID_CATEGORIES.includes(category) ? category : undefined;
        const setClauses = ['title=$1', 'description=$2', 'date=$3', 'status=$4', 'priority=$5',
            'assigned_to=$6', 'owner=$7', 'owner_user_id=$8', `updated_at=NOW()`, `completed_at=CASE WHEN $9='done' THEN NOW() ELSE NULL END`,
            'version=COALESCE(version,1)+1'];
        const values = [title.trim(), description || null, date || null, taskStatus, taskPriority,
                        assigned_to || null, owner || null, owner_user_id || null, taskStatus];
        let paramIdx = 10;

        if (taskCategory) {
            setClauses.push(`category=$${paramIdx++}`);
            values.push(taskCategory);
        }
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            setClauses.push(`task_type=$${paramIdx++}`);
            values.push(task_type);
        }
        if (deadline !== undefined) {
            setClauses.push(`deadline=$${paramIdx++}`);
            values.push(deadline || null);
        }
        if (time_window_start !== undefined) {
            setClauses.push(`time_window_start=$${paramIdx++}`);
            values.push(time_window_start || null);
        }
        if (time_window_end !== undefined) {
            setClauses.push(`time_window_end=$${paramIdx++}`);
            values.push(time_window_end || null);
        }

        values.push(id);
        let whereClause = `WHERE id=$${paramIdx}`;

        // Optimistic locking: check version if client provides it
        if (clientVersion !== null) {
            values.push(clientVersion);
            whereClause += ` AND COALESCE(version,1)=$${++paramIdx}`;
        }

        const result = await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')} ${whereClause} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ error: 'Task not found' });
            }
            return res.status(409).json({
                error: 'Задачу було змінено іншим користувачем',
                conflict: true,
                currentData: existing.rows[0]
            });
        }

        // Log update via Kleshnya
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'updated', null, title, actor);

        // v22.2.0: Gamification — award coins + XP on task completion
        if (status === 'done' && actor !== 'system') {
            try {
                const { onTaskComplete } = require('../services/gamification');
                onTaskComplete(actor, result.rows[0]).catch(() => {});
            } catch (e) { /* gamification not ready */ }
        }

        const updatedTask = result.rows[0];

        // v19.10/v0.48.12: Notify only when assignment actually changes.
        if (taskAssigneeChanged(old, updatedTask) && (updatedTask.owner_user_id || updatedTask.assigned_to)) {
            notifyTaskAssignment(updatedTask, actor).catch(() => {});
        }

        res.json({ success: true, task: updatedTask });
        _alertPush();
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/tasks/:id/status — quick status change (via Kleshnya) — admin/user only
router.patch('/:id/status', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const visibleParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const visible = await pool.query(`SELECT t.* FROM tasks t WHERE t.id = $1 ${visibility} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        if (!canMutateTask(req.user, visible.rows[0])) return res.status(403).json({ error: 'Недостатньо прав для зміни задачі' });

        const actor = req.user?.username || 'system';
        const kleshnya = getKleshnya();
        const task = await kleshnya.updateTaskStatus(parseInt(id), status, actor);

        // v22.2.0: Gamification — award coins + XP on task completion
        if (status === 'done' && actor !== 'system') {
            try {
                const { onTaskComplete } = require('../services/gamification');
                onTaskComplete(actor, task).catch(() => {});
            } catch (e) { /* gamification not ready */ }
        }

        res.json({ success: true, task });
    } catch (err) {
        if (err.message === 'Task not found') {
            return res.status(404).json({ error: 'Task not found' });
        }
        if (err.message.startsWith('Conflict:')) {
            return res.status(409).json({ error: 'Internal server error' });
        }
        log.error('Status change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks/:id/review — review/score a completed task (manager+)
router.post('/:id/review', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const { score, comment } = req.body;
        const reviewScore = parseInt(score);
        if (!Number.isInteger(reviewScore) || reviewScore < 1 || reviewScore > 10) {
            return res.status(400).json({ error: 'score повинен бути від 1 до 10' });
        }
        const visibleParams = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });

        const result = await pool.query(
            `UPDATE tasks SET review_score = $1, review_comment = $2,
             reviewed_by = $3, reviewed_at = NOW()
             WHERE id = $4 AND status = 'done' RETURNING *`,
            [reviewScore, comment || null, req.user.id || req.user.userId, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Задачу не знайдено або вона не завершена' });
        }

        // Award coins based on score
        const task = result.rows[0];
        const coinsReward = reviewScore * 5;
        try {
            const assignedTo = task.assigned_to;
            if (assignedTo) {
                const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [assignedTo]);
                if (userResult.rows.length > 0) {
                    const gamification = require('../services/gamification');
                    await gamification.awardCoins(userResult.rows[0].username, coinsReward, `Оцінка задачі: ${reviewScore}/10`, 'task_review');
                }
            }
        } catch (e) { /* gamification not ready */ }

        log.info(`Task ${req.params.id} reviewed: ${reviewScore}/10 by ${req.user.username}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Review task error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/tasks/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        // Log deletion
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'deleted', null, null, actor);

        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v33.3: POST /api/tasks/bulk — bulk actions on multiple tasks
router.post('/bulk', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { ids, action, assignTo, priority } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
        if (!action) return res.status(400).json({ error: 'action required' });

        const intIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
        if (intIds.length === 0) return res.status(400).json({ error: 'No valid ids' });

        const params = [intIds];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        let result;
        if (action === 'archive') {
            result = await pool.query(
                `UPDATE tasks t SET status = 'archived', updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} AND COALESCE(t.status, 'todo') NOT IN ('archived')`,
                params
            );
        } else if (action === 'done') {
            result = await pool.query(
                `UPDATE tasks t SET status = 'done', completed_at = NOW(), updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} AND COALESCE(t.status, 'todo') NOT IN ('done','archived')`,
                params
            );
        } else if (action === 'assign' && assignTo) {
            let typedOwner;
            try {
                typedOwner = await resolveTypedTaskOwner({ ownerUserId: assignTo }, req.user);
            } catch (ownerErr) {
                return res.status(ownerErr.statusCode || 400).json({
                    success: false,
                    error: ownerErr.message || 'Task owner is not assignable',
                    code: ownerErr.code || 'TASK_OWNER_NOT_ASSIGNABLE'
                });
            }
            result = await pool.query(
                `UPDATE tasks t SET owner_user_id = $${params.length + 1}, assigned_to = $${params.length + 2}, updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility}
                 RETURNING t.*`,
                [...params, typedOwner.ownerUserId, typedOwner.assignedToSnapshot]
            );
            for (const task of result.rows || []) {
                notifyTaskAssignment(task, req.user?.username || 'system').catch(() => {});
            }
        } else if (action === 'priority' && priority) {
            if (!VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
            result = await pool.query(
                `UPDATE tasks t SET priority = $${params.length + 1}, updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility}`,
                [...params, priority]
            );
        } else {
            return res.status(400).json({ error: `Unknown action: ${action}` });
        }
        res.json({ success: true, affected: result.rowCount });
    } catch (err) {
        log.error('Bulk action error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
