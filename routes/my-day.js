'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { buildTaskOwnerMatch, canMutateTask, normalizeUserId } = require('../services/taskPolicy');
const {
    appendTaskBusinessScopeSql,
    ensureWritableTaskBusinessScope
} = require('../services/taskBusinessScope');
const {
    createTaxonomy,
    listTaxonomy,
    myDayError,
    replaceTaskClassification,
    updateTaxonomy
} = require('../services/myDayTaxonomy');

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

module.exports = router;
