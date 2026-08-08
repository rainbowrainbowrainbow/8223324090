'use strict';

const crypto = require('node:crypto');
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { pool } = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { buildTaskOwnerMatch, canMutateTask, normalizeUserId } = require('../services/taskPolicy');
const { updateTaskStatus } = require('../services/taskExecution');
const {
    appendTaskBusinessScopeSql,
    ensureTaskBusinessScope,
    ensureWritableTaskBusinessScope
} = require('../services/taskBusinessScope');
const {
    createTaxonomy,
    classificationFingerprint,
    classificationImpactIds,
    listTaxonomy,
    myDayError,
    replaceTaskClassification,
    readTaskClassification,
    updateTaxonomy
} = require('../services/myDayTaxonomy');
const {
    classifyMyDayTask,
    taskFingerprint
} = require('../services/myDayClassificationAi');
const { activeTimer, createManualEntry, deleteTimeEntry, listTimeEntries, startTimer, stopActiveTimerForUser, updateManualEntry } = require('../services/myDayTimeTracking');
const { buildMyDayContribution } = require('../services/myDayContribution');
const { applyMyDayStarterKit } = require('../services/myDayStarterKit');

router.use(authenticateToken);

const CLASSIFICATION_UNDO_TOKEN_TTL_MS = 10 * 60 * 1000;

const myDayAiClassificationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number.parseInt(process.env.MY_DAY_CLASSIFICATION_RATE_LIMIT_MAX || '10', 10) || 10,
    keyGenerator: req => String(req.user?.id || ipKeyGenerator(req.ip) || 'anon'),
    message: {
        success: false,
        code: 'MY_DAY_AI_RATE_LIMITED',
        error: 'Забагато AI-розміток. Зачекайте хвилину і спробуйте ще раз.'
    },
    standardHeaders: false,
    legacyHeaders: false,
    validate: { ipv6SubnetOrKeyGenerator: false }
});
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

function signUndoPayload(encodedPayload) {
    return crypto.createHmac('sha256', JWT_SECRET)
        .update(encodedPayload)
        .digest('base64url');
}

function createClassificationUndoToken({ userId, taskId, taskFingerprintValue, beforeClassification, appliedClassification, now = Date.now() } = {}) {
    const payload = {
        v: 1,
        userId: Number(userId),
        taskId: Number(taskId),
        before: {
            impactIds: classificationImpactIds(beforeClassification)
        },
        applied: {
            impactIds: classificationImpactIds(appliedClassification)
        },
        beforeFingerprint: classificationFingerprint(beforeClassification, taskFingerprintValue),
        appliedFingerprint: classificationFingerprint(appliedClassification, taskFingerprintValue),
        expiresAt: now + CLASSIFICATION_UNDO_TOKEN_TTL_MS
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return encodedPayload + '.' + signUndoPayload(encodedPayload);
}

function verifyClassificationUndoToken(token, now = Date.now()) {
    const [encodedPayload, signature, extra] = String(token || '').split('.');
    if (!encodedPayload || !signature || extra !== undefined) {
        throw myDayError('Некоректний token скасування AI-розмітки.', 400, 'MY_DAY_CLASSIFICATION_UNDO_INVALID');
    }
    const expected = signUndoPayload(encodedPayload);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw myDayError('Некоректний token скасування AI-розмітки.', 400, 'MY_DAY_CLASSIFICATION_UNDO_INVALID');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw myDayError('Некоректний token скасування AI-розмітки.', 400, 'MY_DAY_CLASSIFICATION_UNDO_INVALID');
    }
    if (payload?.v !== 1 || !Number.isInteger(Number(payload.userId)) || !Number.isInteger(Number(payload.taskId))) {
        throw myDayError('Некоректний token скасування AI-розмітки.', 400, 'MY_DAY_CLASSIFICATION_UNDO_INVALID');
    }
    if (!Number.isFinite(Number(payload.expiresAt)) || Number(payload.expiresAt) < now) {
        throw myDayError('Token скасування AI-розмітки застарів.', 409, 'MY_DAY_CLASSIFICATION_UNDO_EXPIRED');
    }
    return payload;
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

async function loadMyCabinetTaskSnapshot(queryable, user, businessScope, taskId) {
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
    params.push(Number(taskId));
    const result = await queryable.query(
        `SELECT t.id, t.title, t.description, t.status, t.priority, t.deadline, t.date,
                t.scheduled_start_at, t.owner_user_id, t.assigned_to, t.updated_at
         FROM tasks t
         WHERE ${ownerMatch}
           ${businessCondition}
           AND t.id = $${params.length}
         LIMIT 1`,
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
            impactIds: req.body?.impactIds,
            tags: req.body?.tags
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

router.post('/tasks/:taskId/classification/auto', myDayAiClassificationLimiter, async (req, res) => {
    const businessScope = ensureWritableTaskBusinessScope(req, res);
    if (!businessScope) return;
    let client;
    try {
        const userId = currentUserId(req);
        const task = await loadMyCabinetTaskSnapshot(pool, req.user, businessScope, req.params.taskId);
        if (!task) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
        if (!canMutateTask(req.user, task)) {
            throw myDayError('Немає прав для AI-розмітки цієї задачі.', 403, 'MY_DAY_TASK_CLASSIFICATION_FORBIDDEN');
        }
        const beforeTaskFingerprint = taskFingerprint(task);
        const [impacts, previousClassification] = await Promise.all([
            listTaxonomy(pool, userId, 'impacts'),
            readTaskClassification(pool, userId, req.params.taskId)
        ]);
        const beforeClassificationFingerprint = classificationFingerprint(previousClassification, beforeTaskFingerprint);

        const aiResult = await classifyMyDayTask({ task, impacts });
        if (!aiResult.ok) {
            return res.status(aiResult.statusCode || 503).json({
                success: false,
                code: aiResult.code || 'MY_DAY_AI_PROVIDER_ERROR',
                error: aiResult.code === 'MY_DAY_AI_PROVIDER_UNAVAILABLE'
                    ? 'AI-провайдер недоступний або не налаштований.'
                    : (aiResult.code === 'MY_DAY_AI_LOW_CONFIDENCE'
                        ? 'AI не впевнений у розмітці. Нічого не змінено.'
                        : (aiResult.code === 'MY_DAY_AI_NO_MATCH'
                            ? 'AI не знайшов відповідного впливу. Уточніть назву задачі або додайте потрібний вплив.'
                            : 'AI не зміг безпечно розмітити задачу. Нічого не змінено.')),
                reason: aiResult.reason,
                confidence: aiResult.confidence,
                aiReason: aiResult.aiReason,
                provider: aiResult.provider,
                model: aiResult.model
            });
        }

        client = await pool.connect();
        await client.query('BEGIN');
        const lockedTask = await loadMyCabinetTask(client, req.user, businessScope, req.params.taskId);
        if (!lockedTask) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
        if (!canMutateTask(req.user, lockedTask)) {
            throw myDayError('Немає прав для AI-розмітки цієї задачі.', 403, 'MY_DAY_TASK_CLASSIFICATION_FORBIDDEN');
        }
        const lockedTaskFingerprint = taskFingerprint(lockedTask);
        if (lockedTaskFingerprint !== beforeTaskFingerprint) {
            throw myDayError('Задача змінилася під час AI-розмітки. Оновіть сторінку і повторіть дію.', 409, 'MY_DAY_TASK_CHANGED_DURING_AI_CLASSIFICATION');
        }
        const currentClassification = await readTaskClassification(client, userId, req.params.taskId);
        if (classificationFingerprint(currentClassification, lockedTaskFingerprint) !== beforeClassificationFingerprint) {
            throw myDayError('Впливи задачі змінилися під час AI-розмітки. Оновіть сторінку і повторіть дію.', 409, 'MY_DAY_CLASSIFICATION_CHANGED_DURING_AI_CLASSIFICATION');
        }
        const classification = await replaceTaskClassification(client, {
            userId,
            taskId: req.params.taskId,
            impactIds: aiResult.classification.impactIds
        });
        const undoToken = createClassificationUndoToken({
            userId,
            taskId: req.params.taskId,
            taskFingerprintValue: lockedTaskFingerprint,
            beforeClassification: previousClassification,
            appliedClassification: classification
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            taskId: Number(req.params.taskId),
            classification,
            undoToken,
            ai: {
                confidence: aiResult.confidence,
                reason: aiResult.reason,
                provider: aiResult.provider,
                model: aiResult.model
            }
        });
    } catch (error) {
        try { if (client) await client.query('ROLLBACK'); } catch {}
        sendMyDayError(res, error);
    } finally {
        client?.release();
    }
});

router.post('/tasks/:taskId/classification/undo', async (req, res) => {
    const businessScope = ensureWritableTaskBusinessScope(req, res);
    if (!businessScope) return;
    let client;
    try {
        const userId = currentUserId(req);
        const token = verifyClassificationUndoToken(req.body?.undoToken);
        const taskId = Number(req.params.taskId);
        if (Number(token.userId) !== userId || Number(token.taskId) !== taskId) {
            throw myDayError('Token скасування не належить цій задачі.', 403, 'MY_DAY_CLASSIFICATION_UNDO_FORBIDDEN');
        }
        client = await pool.connect();
        await client.query('BEGIN');
        const task = await loadMyCabinetTask(client, req.user, businessScope, taskId);
        if (!task) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
        if (!canMutateTask(req.user, task)) {
            throw myDayError('Немає прав для скасування AI-розмітки цієї задачі.', 403, 'MY_DAY_TASK_CLASSIFICATION_FORBIDDEN');
        }
        const currentClassification = await readTaskClassification(client, userId, taskId);
        if (classificationFingerprint(currentClassification, taskFingerprint(task)) !== token.appliedFingerprint) {
            throw myDayError('Розмітка вже змінилася. Скасування AI не застосовано.', 409, 'MY_DAY_CLASSIFICATION_UNDO_CONFLICT');
        }
        const beforeImpactIds = Array.isArray(token.before?.impactIds) ? token.before.impactIds : [];
        const classification = await replaceTaskClassification(client, {
            userId,
            taskId,
            impactIds: beforeImpactIds,
            allowArchivedImpactIds: beforeImpactIds
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            taskId,
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


router.post('/starter-kit', async (req, res) => {
    try {
        const starterKit = await withMyDayTransaction(client => applyMyDayStarterKit(client, currentUserId(req)));
        res.status(201).json({ success: true, starterKit });
    } catch (error) {
        sendMyDayError(res, error);
    }
});
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
            if (!task) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
            if (!canMutateTask(req.user, task)) throw myDayError('Немає прав запускати таймер для цієї задачі.', 403, 'MY_DAY_TIMER_FORBIDDEN');
            if (['done', 'completed', 'cancelled', 'canceled', 'archived'].includes(String(task.status || '').toLowerCase())) throw myDayError('Не можна запускати таймер для завершеної задачі.', 409, 'MY_DAY_TIMER_TASK_CLOSED');
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
            if (!task) throw myDayError('Задачу не знайдено.', 404, 'MY_DAY_TASK_NOT_FOUND');
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
