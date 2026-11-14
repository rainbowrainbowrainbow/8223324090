'use strict';

const crypto = require('node:crypto');
const { audit, failure, transaction } = require('./telegramCrmIdentity');
const { buildTaskPersonalQuery, taskViewerRoles } = require('./taskPersonalScope');
const { canUseTaskRouteCapability } = require('./taskPolicy');
const { getAssignableTaskOwner, listTaskOwnerCandidates } = require('./taskExecution');
const { taskKpiWorkloadDateSql } = require('./taskPerformancePolicy');
const { pushTaskBusinessScopeCondition } = require('./taskBusinessScope');

function dateOnly(value, field) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) {
        throw failure(400, 'TELEGRAM_TASK_DATE_INVALID', `Некоректне поле ${field}.`);
    }
    return value;
}

function normalizeDraft(input = {}) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 500) throw failure(400, 'TELEGRAM_TASK_TITLE_REQUIRED', 'Вкажіть назву задачі до 500 символів.');
    if (input.description != null && (typeof input.description !== 'string' || input.description.length > 10000)) {
        throw failure(400, 'TELEGRAM_TASK_DESCRIPTION_INVALID', 'Опис задачі має бути текстом до 10000 символів.');
    }
    const ownerUserId = Number(input.ownerUserId);
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw failure(400, 'TELEGRAM_TASK_OWNER_REQUIRED', 'Оберіть виконавця задачі.');
    const businessContext = input.businessContext;
    if (typeof businessContext !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(businessContext)) {
        throw failure(400, 'TELEGRAM_TASK_BUSINESS_REQUIRED', 'Оберіть бізнес для задачі.');
    }
    let deadline = null;
    if (input.deadline != null && input.deadline !== '') {
        if (typeof input.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.deadline)
            || !Number.isFinite(Date.parse(input.deadline))) {
            throw failure(400, 'TELEGRAM_TASK_DEADLINE_INVALID', 'Строк із часом повинен містити часовий пояс.');
        }
        dateOnly(input.deadline.slice(0,10), 'deadline');
        deadline = new Date(input.deadline).toISOString();
    }
    const priority = input.priority || 'normal';
    if (!['low','normal','high','urgent'].includes(priority)) throw failure(400, 'TELEGRAM_TASK_PRIORITY_INVALID', 'Некоректний пріоритет.');
    return { title, description: input.description?.trim() || null, ownerUserId, businessContext,
        date: dateOnly(input.date, 'date'), deadline, priority };
}

async function defaultActorContext(userRow, client, businessContext) {
    const { buildAuthUserPayload } = require('../middleware/auth');
    const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
    const { resolveBusinessScope, requireBusinessScope } = require('./businessContext');
    const { requireRequestBusinessModule } = require('./businessModuleRegistry');
    const payload = buildAuthUserPayload(userRow);
    const actor = applyMembershipAccess(payload, await loadMembershipAccess(client, payload, businessContext || null));
    const request = { user: actor, method: 'GET', originalUrl: '/api/tasks', query: businessContext ? { businessContext } : {}, headers: {} };
    const scope = resolveBusinessScope(request);
    // Reuse the same guards as the web Tasks API, with an error adapter instead of HTTP output.
    const reject = { status(code) { this.code = code; return this; }, json(body) { throw failure(this.code, body.code || 'TELEGRAM_BUSINESS_FORBIDDEN', body.error); } };
    requireBusinessScope(request, reject, scope);
    requireRequestBusinessModule(request, reject, scope);
    if (businessContext && businessContext !== scope.activeContext) throw failure(403, 'TELEGRAM_BUSINESS_FORBIDDEN', 'Бізнес недоступний для цього акаунта.');
    return { actor, scope };
}

function createTelegramCrmTasks(options) {
    const { pool, identity } = options;
    const actorContext = options.actorContext || defaultActorContext;
    const createTask = options.createTask || ((...args) => require('./kleshnya').createTask(...args));
    const assignableOwner = options.assignableOwner || getAssignableTaskOwner;
    const ownerCandidates = options.ownerCandidates || listTaskOwnerCandidates;

    async function context(client, senderId, businessContext, lock = false, expectedVersion = null, eventAt = null) {
        const resolved = await identity.resolve(senderId, client, { lock, expectedVersion, eventAt });
        const scoped = await actorContext(resolved.user, client, businessContext);
        return { ...resolved, ...scoped };
    }

    function assertCreate(actor, scope) {
        if (!canUseTaskRouteCapability(actor, 'create')) throw failure(403, 'TASK_CREATE_FORBIDDEN', 'Ваші права CRM не дозволяють створювати задачі.');
        if (scope.readOnly || scope.canWrite === false || scope.selectedContexts?.length !== 1) {
            throw failure(403, 'TELEGRAM_BUSINESS_READ_ONLY', 'Для створення оберіть один доступний бізнес.');
        }
    }

    async function owner(client, ownerUserId, actor, scope) {
        const pilot = (await client.query('SELECT user_id FROM telegram_crm_bindings WHERE user_id=$1 AND pilot_enabled=true', [ownerUserId])).rows[0];
        if (!pilot) throw failure(403, 'TELEGRAM_OWNER_OUTSIDE_PILOT', 'Поки можна призначати задачі тільки учасникам пілоту.');
        return assignableOwner(ownerUserId, { pool: client, actor, businessScope: scope });
    }

    function taskReceipt(row, actor, scope) {
        return { id: row.id, title: row.title, description: row.description || null,
            status: row.status || 'todo', ownerUserId: row.owner_user_id,
            ownerLabel: row.owner_name || row.assigned_to || row.owner || null,
            viewerRoles: taskViewerRoles(actor, row), date: row.date || null, deadline: row.deadline || null,
            workDate: row.work_date || null, scheduledStartAt: row.scheduled_start_at || null,
            businessContext: scope.activeContext, url: `/tasks?open=${row.id}` };
    }

    async function assertReceiptVisible(client, actor, scope, taskId) {
        const params = [];
        const personal = buildTaskPersonalQuery(actor, params);
        const business = pushTaskBusinessScopeCondition(params, scope, 't');
        params.push(taskId);
        const visible = await client.query(`SELECT 1 FROM tasks t WHERE t.id=$${params.length} AND ${personal.match} AND ${business}`, params);
        if (!visible.rowCount) throw failure(403, 'TELEGRAM_RECEIPT_FORBIDDEN', 'Задача цієї операції більше недоступна. Повторно її не створюємо.');
    }

    async function me(senderId, businessContext, eventAt = null) {
        const { actor, binding, scope } = await context(pool, senderId, businessContext, false, null, eventAt);
        return { user: { id: actor.id, name: actor.name || actor.username }, bindingVersion: String(binding.version),
            businessContext: scope.activeContext, businessContexts: actor.businessContexts || actor.business_contexts || [],
            canCreateTasks: canUseTaskRouteCapability(actor, 'create') };
    }

    async function list(senderId, query = {}) {
        const { actor, scope } = await context(pool, senderId, query.businessContext, false, null, query.eventAt ?? null);
        const params = [];
        const personal = buildTaskPersonalQuery(actor, params);
        const where = [personal.match, pushTaskBusinessScopeCondition(params, scope, 't')];
        const status = query.status || 'active';
        if (!['active','completed','all'].includes(status)) throw failure(400, 'TELEGRAM_TASK_STATUS_INVALID', 'Оберіть активні або завершені задачі.');
        if (status === 'active') where.push("COALESCE(t.status,'todo') NOT IN ('done','cancelled','archived')");
        if (status === 'completed') where.push("t.status='done'");
        const from = dateOnly(query.dateFrom, 'dateFrom'), to = dateOnly(query.dateTo, 'dateTo');
        if (from && to && from > to) throw failure(400, 'TELEGRAM_TASK_DATE_INVALID', 'Початок періоду пізніше завершення.');
        const due = taskKpiWorkloadDateSql('t');
        // Match the date-focused My Day view: deferred work is not actionable yet.
        if (query.view === 'day') where.push('(t.snoozed_until IS NULL OR t.snoozed_until <= NOW())');
        if (from) { params.push(from); where.push(`${due} >= $${params.length}::date`); }
        if (to) { params.push(to); where.push(`${due} <= $${params.length}::date`); }
        const limit = Number(query.limit || 10), offset = Number(query.offset || 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0 || offset > 5000) {
            throw failure(400, 'TELEGRAM_TASK_PAGE_INVALID', 'Некоректна сторінка задач.');
        }
        params.push(limit + 1, offset);
        const rows = (await pool.query(`SELECT t.id,t.title,t.description,t.status,t.owner_user_id,t.assigned_to,t.owner,t.date,t.deadline,
            t.scheduled_start_at,(${due})::text AS work_date,
            t.created_by_user_id,t.created_by,${personal.roles} AS viewer_roles
            FROM tasks t WHERE ${where.join(' AND ')}
            ORDER BY ${due} ASC NULLS LAST,t.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params)).rows;
        return { tasks: rows.slice(0,limit).map(row => taskReceipt(row, actor, scope)), businessContext: scope.activeContext,
            pagination: { limit, offset, hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null } };
    }

    async function owners(senderId, businessContext, eventAt = null) {
        const { actor, scope } = await context(pool, senderId, businessContext, false, null, eventAt);
        assertCreate(actor, scope);
        const candidates = await ownerCandidates({ pool, actor, businessScope: scope });
        const pilotIds = new Set((await pool.query('SELECT user_id FROM telegram_crm_bindings WHERE pilot_enabled=true')).rows.map(row => Number(row.user_id)));
        return { owners: candidates.filter(candidate => pilotIds.has(Number(candidate.id))), businessContext: scope.activeContext };
    }

    async function preview(senderId, input) {
        const payload = normalizeDraft(input);
        const sourceUpdateId = String(input.sourceUpdateId || '');
        if (!/^[0-9]{1,20}$/.test(sourceUpdateId)) throw failure(400, 'TELEGRAM_UPDATE_INVALID', 'Відсутній номер повідомлення Telegram.');
        return transaction(pool, async client => {
            const { actor, binding, scope } = await context(client, senderId, payload.businessContext, true, input.bindingVersion ?? null, input.eventAt ?? null);
            const config = await identity.configuration(client);
            if (config.mode !== 'write') throw failure(403, 'TELEGRAM_CRM_READ_ONLY', 'Поки увімкнено лише перегляд задач.');
            assertCreate(actor, scope);
            const assignee = await owner(client, payload.ownerUserId, actor, scope);
            const prior = (await client.query(
                'SELECT *,expires_at>NOW() AS fresh FROM telegram_crm_task_operations WHERE user_id=$1 AND binding_version=$2 AND source_update_id=$3',
                [actor.id, binding.version, sourceUpdateId]
            )).rows[0];
            if (prior) {
                if (JSON.stringify(normalizeDraft(prior.payload)) !== JSON.stringify(payload)) throw failure(409, 'TELEGRAM_OPERATION_CONFLICT', 'Це повідомлення вже має іншу чернетку. Надішліть нове повідомлення.');
                if (prior.state !== 'draft' || !prior.fresh) throw failure(409, 'TELEGRAM_OPERATION_FINISHED', 'Операція вже завершена або застаріла. Перевірте її результат.');
                return { operationId: prior.id, draft: { ...payload, ownerLabel: assignee.label }, expiresAt: prior.expires_at, timezone: 'Europe/Kyiv' };
            }
            const id = crypto.randomUUID();
            const stored = (await client.query(`INSERT INTO telegram_crm_task_operations
                (id,user_id,binding_version,source_update_id,business_context,payload,expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '20 minutes') RETURNING expires_at`,
            [id, actor.id, binding.version, sourceUpdateId, payload.businessContext, JSON.stringify(payload)])).rows[0];
            await audit(client, actor.id, 'task_previewed', binding.version, id);
            return { operationId: id, draft: { ...payload, ownerLabel: assignee.label }, expiresAt: stored.expires_at, timezone: 'Europe/Kyiv' };
        });
    }

    async function operation(senderId, id) {
        const { user, binding } = await identity.resolve(senderId);
        const row = (await pool.query('SELECT state,receipt,expires_at,business_context,task_id FROM telegram_crm_task_operations WHERE id=$1 AND user_id=$2 AND binding_version=$3', [id,user.id,binding.version])).rows[0];
        if (!row) throw failure(404, 'TELEGRAM_OPERATION_NOT_FOUND', 'Операцію не знайдено для цього акаунта.');
        const { actor, scope } = await actorContext(user, pool, row.business_context);
        if (row.state === 'committed') await assertReceiptVisible(pool, actor, scope, row.task_id);
        return { operationId: id, state: row.state, receipt: row.receipt, expiresAt: row.expires_at };
    }

    async function cancel(senderId, id) {
        return transaction(pool, async client => {
            const { user, binding } = await identity.resolve(senderId, client, { lock: true });
            const row = (await client.query("UPDATE telegram_crm_task_operations SET state='cancelled' WHERE id=$1 AND user_id=$2 AND binding_version=$3 AND state IN ('draft','cancelled') RETURNING id", [id,user.id,binding.version])).rows[0];
            if (!row) throw failure(409, 'TELEGRAM_OPERATION_NOT_CANCELLABLE', 'Чернетку не знайдено або задачу вже створено.');
            await audit(client, user.id, 'task_cancelled', binding.version, id);
            return { operationId: id, state: 'cancelled' };
        });
    }

    async function commit(senderId, id, confirmed) {
        if (confirmed !== true) throw failure(400, 'TELEGRAM_CONFIRMATION_REQUIRED', 'Підтвердьте показану чернетку кнопкою «Створити».');
        const callbacks = [];
        const result = await transaction(pool, async client => {
            const { user, binding } = await identity.resolve(senderId, client, { lock: true });
            const row = (await client.query('SELECT *,expires_at>NOW() AS fresh FROM telegram_crm_task_operations WHERE id=$1 AND user_id=$2 FOR UPDATE', [id,user.id])).rows[0];
            if (!row || String(row.binding_version) !== String(binding.version)) throw failure(404, 'TELEGRAM_OPERATION_NOT_FOUND', 'Операцію не знайдено для цього підключення.');
            // Re-check current business access even for a successful retry/receipt.
            const { actor, scope } = await actorContext(user, client, row.business_context);
            if (row.state === 'committed') {
                await assertReceiptVisible(client, actor, scope, row.task_id);
                return { operationId: id, state: 'committed', receipt: row.receipt, replay: true };
            }
            if (row.state !== 'draft' || !row.fresh) throw failure(410, 'TELEGRAM_DRAFT_EXPIRED', 'Чернетка застаріла або скасована. Створіть нову.');
            const config = await identity.configuration(client);
            if (config.mode !== 'write') throw failure(403, 'TELEGRAM_CRM_READ_ONLY', 'Створення задач тимчасово вимкнене.');
            assertCreate(actor, scope);
            const payload = normalizeDraft(row.payload);
            const assignee = await owner(client, payload.ownerUserId, actor, scope);
            const task = await createTask({ ...payload, owner_user_id: assignee.id, owner: assignee.label, assigned_to: assignee.label,
                created_by: actor.username, created_by_user_id: actor.id, task_type: 'human', task_mode: 'work', task_kind: 'action',
                visibility: 'team', workflow_state: 'todo', category: 'admin', source_type: 'manual', source_module: 'telegram_crm',
                control_meta: { integration: 'second-brain-crm', operationId: id }, duplicateMode: 'reject'
            }, { pool: client, afterCommit: callbacks, skipNotifications: options.skipNotifications === true });
            const receipt = { task: taskReceipt(task, actor, scope), integration: 'second-brain-crm', actorUserId: actor.id };
            await client.query("UPDATE telegram_crm_task_operations SET state='committed',task_id=$2,receipt=$3,committed_at=NOW() WHERE id=$1", [id, task.id, JSON.stringify(receipt)]);
            await audit(client, actor.id, 'task_created', binding.version, id);
            return { operationId: id, state: 'committed', receipt, replay: false };
        });
        for (const callback of callbacks) {
            try { await callback(); } catch { options.onNotificationError?.({ operationId: id }); }
        }
        return result;
    }

    return { cancel, commit, list, me, operation, owners, preview };
}

module.exports = { createTelegramCrmTasks, dateOnly, defaultActorContext, normalizeDraft };
