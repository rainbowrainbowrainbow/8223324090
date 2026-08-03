'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { buildTaskOwnerMatch, canMutateTask, normalizeUserId } = require('../services/taskPolicy');
const { updateTaskStatus } = require('../services/taskExecution');
const {
    appendTaskBusinessScopeSql,
    ensureTaskBusinessScope,
    ensureWritableTaskBusinessScope
} = require('../services/taskBusinessScope');
const {
    createTaxonomy,
    listTaxonomy,
    myDayError,
    replaceTaskClassification,
    updateTaxonomy
} = require('../services/myDayTaxonomy');
const { activeTimer, createManualEntry, deleteTimeEntry, listTimeEntries, startTimer, stopActiveTimerForUser, updateManualEntry } = require('../services/myDayTimeTracking');
const { buildMyDayContribution } = require('../services/myDayContribution');

router.use(authenticateToken);
router.param('taskId', (req, res, next, value) => {
    if (!/^[1-9][0-9]*$/.test(String(value || ''))) {
        return res.status(400).json({ success: false, code: 'MY_DAY_VALIDATION_ERROR', error: 'Некоректний ідентифікатор задачі.' });
    }
    return next();
});
router.param('id', (req, res, next, value) => {
    if (!/^[1-9][0-9]*$/.test(String(value || ''))) {
        return res.status(400).json({ success: false, code: 'MY_DAY_VALIDATION_ERROR', error: 'Некоректний ідентифікатор.' });
    }
    return next();
});

function sendMyDayError(res, error) {
    const status = error?.statusCode || 500;
    return res.status(status).json({
        success: false,
        code: error?.code || 'MY_DAY_INTERNAL_ERROR',
        error: error?.statusCode ? error.message : 'Не вдалося виконати дію My Day.'
    });
}

function currentUserId(req) {
    const userId = normalizeUserId(req.user);
    if (!userId) throw myDayError('Потрібна авторизація.', 401, 'MY_DAY_UNAUTHENTICATED');
    return userId;
}

function taxonomyRoutes(kind) {
    router.get('/' + kind, async (req, res) => {
        try {
            const records = await listTaxonomy(pool, currentUserId(req), kind, {
                includeArchived: req.query.includeArchived === '1'
            });
            res.json({ success: true, [kind]: records });
        } catch (error) {
            sendMyDayError(res, error);
        }
    });

    router.post('/' + kind, async (req, res) => {
        try {
            const record = await createTaxonomy(pool, currentUserId(req), kind, req.body || {});
            res.status(201).json({ success: true, [kind.slice(0, -1)]: record });
        } catch (error) {
            sendMyDayError(res, error);
        }
    });

    router.patch('/' + kind + '/:id', async (req, res) => {
        try {
            const record = await updateTaxonomy(pool, currentUserId(req), kind, req.params.id, req.body || {});
            res.json({ success: true, [kind.slice(0, -1)]: record });
        } catch (error) {
            sendMyDayError(res, error);
        }
    });
}

taxonomyRoutes('directions');
taxonomyRoutes('impacts');

router.get('/contribution', async (req, res) => {
    try {
        const businessScope = ensureTaskBusinessScope(req, res);
        if (!businessScope) return;
        const contribution = await buildMyDayContribution({
            pool,
            user: req.user,
            businessScope,
            query: req.query || {}
        });
        res.json(contribution);
    } catch (error) {
        sendMyDayError(res, error);
    }
});

async function loadMyCabinetTask(client, user, businessScope, taskId) {
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    params.push(Number(taskId));
    const result = await client.query(
        `SELECT t.*
         FROM tasks t
         WHERE ${ownerMatch}
           ${businessCondition}
           AND t.id = $${params.length}
         LIMIT 1
         FOR UPDATE`,
        params
    );
    return result.rows?.[0] || null;
}

router.put('/tasks/:taskId/classification', async (req, res) => {
    const businessScope = ensureWritableTaskBusinessScope(req, res);
    if (!businessScope) return;
    let client;
    try {
        client = await pool.connect();
        const userId = currentUserId(req);
        await client.query('BEGIN');
        const task = await loadMyCabinetTask(client, req.user, businessScope, req.params.taskId);
        if (!task) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
        if (!canMutateTask(req.user, task)) {
            throw myDayError('Немає прав для зміни маркування цієї задачі.', 403, 'MY_DAY_TASK_CLASSIFICATION_FORBIDDEN');
        }
        const classification = await replaceTaskClassification(client, {
            userId,
            taskId: req.params.taskId,
            directionId: req.body?.directionId,
            impactIds: req.body?.impactIds
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            taskId: Number(req.params.taskId),
            classification
        });
    } catch (error) {
        try { if (client) await client.query('ROLLBACK'); } catch {}
        sendMyDayError(res, error);
    } finally {
        client?.release();
    }
});

async function withMyDayTransaction(work) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
}

router.get('/timer', async (req, res) => {
    try { res.json({ success: true, timer: await activeTimer(pool, currentUserId(req)) }); }
    catch (error) { sendMyDayError(res, error); }
});

router.post('/timer/start', async (req, res) => {
    const businessScope = ensureWritableTaskBusinessScope(req, res);
    if (!businessScope) return;
    try {
        const timer = await withMyDayTransaction(async client => {
            const userId = currentUserId(req);
            const task = await loadMyCabinetTask(client, req.user, businessScope, req.body?.taskId);
            if (!task) throw myDayError('Р вЂ”Р В°Р Т‘Р В°РЎвЂЎРЎС“ Р Р…Р Вµ Р В·Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р С•.', 404, 'MY_DAY_TASK_NOT_FOUND');
            if (!canMutateTask(req.user, task)) throw myDayError('Р СњР ВµР СР В°РЎвЂќ Р С—РЎР‚Р В°Р Р† Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°РЎвЂљР С‘ РЎвЂљР В°Р в„–Р СР ВµРЎР‚ Р Т‘Р В»РЎРЏ РЎвЂ РЎвЂ“РЎвЂќРЎвЂ” Р В·Р В°Р Т‘Р В°РЎвЂЎРЎвЂ“.', 403, 'MY_DAY_TIMER_FORBIDDEN');
            if (['done', 'completed', 'cancelled', 'canceled', 'archived'].includes(String(task.status || '').toLowerCase())) throw myDayError('Р СњР Вµ Р СР С•Р В¶Р Р…Р В° Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°РЎвЂљР С‘ РЎвЂљР В°Р в„–Р СР ВµРЎР‚ Р Т‘Р В»РЎРЏ Р В·Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р ВµР Р…Р С•РЎвЂ” Р В·Р В°Р Т‘Р В°РЎвЂЎРЎвЂ“.', 409, 'MY_DAY_TIMER_TASK_CLOSED');
            if (String(task.status || 'todo').toLowerCase() === 'todo') await updateTaskStatus(task.id, 'in_progress', req.user, { pool: client, businessScope, sourceSurface: 'profile_my_cabinet', route: 'my_day_timer_start' });
            return startTimer(client, { userId, taskId: task.id });
        });
        res.json({ success: true, timer: timer.entry, unchanged: timer.unchanged, switchedFromTaskId: timer.switchedFromTaskId });
    } catch (error) { sendMyDayError(res, error); }
});

router.post('/timer/stop', async (req, res) => {
    try { res.json({ success: true, timer: await withMyDayTransaction(client => stopActiveTimerForUser(client, currentUserId(req))) }); }
    catch (error) { sendMyDayError(res, error); }
});

router.get('/time-entries', async (req, res) => {
    try { res.json({ success: true, entries: await listTimeEntries(pool, currentUserId(req), { from: req.query.from, to: req.query.to }) }); }
    catch (error) { sendMyDayError(res, error); }
});

router.post('/time-entries', async (req, res) => {
    const businessScope = ensureWritableTaskBusinessScope(req, res);
    if (!businessScope) return;
    try {
        const entry = await withMyDayTransaction(async client => {
            const task = await loadMyCabinetTask(client, req.user, businessScope, req.body?.taskId);
            if (!task) throw myDayError('Р вЂ”Р В°Р Т‘Р В°РЎвЂЎРЎС“ Р Р…Р Вµ Р В·Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р С•.', 404, 'MY_DAY_TASK_NOT_FOUND');
            return createManualEntry(client, { ...req.body, userId: currentUserId(req), taskId: task.id });
        });
        res.status(201).json({ success: true, entry });
    } catch (error) { sendMyDayError(res, error); }
});

router.patch('/time-entries/:id', async (req, res) => {
    try { res.json({ success: true, entry: await withMyDayTransaction(client => updateManualEntry(client, { ...req.body, userId: currentUserId(req), entryId: req.params.id })) }); }
    catch (error) { sendMyDayError(res, error); }
});

router.delete('/time-entries/:id', async (req, res) => {
    try { await withMyDayTransaction(client => deleteTimeEntry(client, currentUserId(req), req.params.id)); res.status(204).end(); }
    catch (error) { sendMyDayError(res, error); }
});
module.exports = router;
