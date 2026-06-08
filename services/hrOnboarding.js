const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { createTask } = require('./kleshnya');
const { getAssignableTaskOwner } = require('./taskExecution');
const { normalizeUserId } = require('./taskPolicy');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { emitTaskAssignedToOwner } = require('./taskNotifications');

const log = createLogger('HR Onboarding');

const ONBOARDING_LEGACY_STATUSES = new Set(['in_progress', 'completed', 'blocked', 'ready']);
const TRAINING_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'ready', 'completed']);
const RESPONSIBLE_ONBOARDING_TEMPLATE_NAME = 'Відповідальний онбординг';
const RESPONSIBLE_ONBOARDING_TEMPLATE_KEY = 'responsible_onboarding_v1';
const ONBOARDING_TASK_SOURCE_TYPE = 'onboarding';
const ONBOARDING_DEFAULT_ITEMS = [
    { key: 'role_intro', title: 'Вступ у роль', description: 'Пояснити роль, очікування, зону відповідальності та перший робочий результат.' },
    { key: 'access_tools', title: 'Доступи та інструменти', description: 'Видати CRM-доступи, показати робочі інструменти, матеріали й канали комунікації.' },
    { key: 'rules_safety', title: 'Правила, безпека і регламенти', description: 'Провести інструктаж з правил компанії, безпеки, дисципліни та операційних регламентів.' },
    { key: 'communication', title: 'Стандарти комунікації', description: 'Пояснити стандарти спілкування з гостями, командою, керівником і клієнтами.' },
    { key: 'shadowing', title: 'Shadowing, демо і практика під наглядом', description: 'Провести демонстрацію, дати стажеру практику під контролем відповідального.' },
    { key: 'readiness', title: 'Підтвердження готовності', description: 'Перевірити навички, закрити питання і підтвердити готовність до самостійної роботи.' }
];
const ONBOARDING_TASK_SPECS = [
    {
        key: 'conduct_training',
        title: 'Провести onboarding і навчання',
        description: 'Провести вступ у роль, пояснити очікування та пройти базовий навчальний чек-лист.',
        priority: 'high'
    },
    {
        key: 'provide_tools',
        title: 'Видати доступи, інструменти і матеріали',
        description: 'Перевірити CRM-доступ, робочі матеріали, інструкції, правила та необхідні інструменти.',
        priority: 'normal'
    },
    {
        key: 'verify_practice',
        title: 'Перевірити практику під наглядом',
        description: 'Провести shadowing/demo, дати практику під контролем і зафіксувати слабкі місця.',
        priority: 'normal'
    },
    {
        key: 'confirm_readiness',
        title: 'Підтвердити готовність до самостійної роботи',
        description: 'Перевірити чек-лист, відкриті питання, готовність до зміни/ролі та фінально підтвердити статус.',
        priority: 'high'
    }
];

function cleanOnboardingText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeTrainingStatus(value, fallback = 'not_started') {
    const status = cleanOnboardingText(value, 32) || fallback;
    return TRAINING_STATUSES.has(status) ? status : fallback;
}

function normalizeOnboardingStatus(value, trainingStatus = null) {
    const status = cleanOnboardingText(value, 32);
    if (status && ONBOARDING_LEGACY_STATUSES.has(status)) return status;
    if (trainingStatus === 'completed') return 'completed';
    if (trainingStatus === 'blocked') return 'blocked';
    if (trainingStatus === 'ready') return 'ready';
    return 'in_progress';
}

function normalizeOnboardingTemplateItems(items = []) {
    const source = parseJsonArray(items);
    const fallback = source.length ? source : ONBOARDING_DEFAULT_ITEMS;
    return fallback.map((item, index) => {
        const raw = item && typeof item === 'object' ? item : { title: item };
        const key = cleanOnboardingText(raw.key || raw.id || `item_${index + 1}`, 80) || `item_${index + 1}`;
        const title = cleanOnboardingText(raw.title || raw.name || raw.label, 240) || `Чек-пункт ${index + 1}`;
        return {
            ...raw,
            id: Number(raw.id || index + 1),
            key,
            title,
            description: cleanOnboardingText(raw.description, 1000),
            done: raw.done === true,
            done_at: raw.done_at || null,
            done_by: raw.done_by || null
        };
    });
}

function completedOnboardingItemCount(items = []) {
    return parseJsonArray(items).filter(item => item && item.done === true).length;
}

function onboardingTaskSourceId(progressId, key) {
    return `${Number(progressId)}:${String(key || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32)}`;
}

function onboardingProgressMeta(row = {}) {
    const items = normalizeOnboardingTemplateItems(row.items || []);
    const total = Number(row.total_items || items.length || 0);
    const completed = Number(row.completed_items || completedOnboardingItemCount(items));
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const taskTotal = Number(row.generated_task_count || row.task_total || 0);
    const taskActive = Number(row.active_task_count || row.task_active || 0);
    const taskCompleted = Number(row.completed_task_count || row.task_completed || 0);
    const responsibleUserId = Number(row.responsible_user_id || 0) || null;
    const responsibleName = row.responsible_name || row.responsible_username || null;
    return {
        id: row.id ? Number(row.id) : null,
        staff_id: row.staff_id ? Number(row.staff_id) : null,
        template_id: row.template_id || null,
        template_name: row.template_name || null,
        checklist_template_key: row.checklist_template_key || RESPONSIBLE_ONBOARDING_TEMPLATE_KEY,
        status: normalizeOnboardingStatus(row.status, row.training_status),
        training_status: normalizeTrainingStatus(row.training_status, row.status === 'completed' ? 'completed' : 'not_started'),
        started_at: row.started_at || null,
        completed_at: row.completed_at || null,
        assigned_at: row.assigned_at || null,
        reassigned_at: row.reassigned_at || null,
        assigned_by_user_id: row.assigned_by_user_id || null,
        assigned_by_username: row.assigned_by_username || null,
        responsible_user_id: responsibleUserId,
        responsibleUserId,
        responsible_name: responsibleName,
        responsibleName,
        responsible_username: row.responsible_username || null,
        responsible: responsibleUserId ? {
            id: responsibleUserId,
            name: responsibleName,
            username: row.responsible_username || null,
            role: row.responsible_role || null
        } : null,
        completed_items: completed,
        total_items: total,
        percent,
        task_summary: {
            total: taskTotal,
            active: taskActive,
            completed: taskCompleted
        },
        generated_task_count: taskTotal,
        active_task_count: taskActive,
        completed_task_count: taskCompleted
    };
}

async function ensureResponsibleOnboardingTemplate(db = pool) {
    const existing = await db.query(
        `SELECT id, name, items
         FROM onboarding_templates
         WHERE name = $1
         ORDER BY id ASC
         LIMIT 1`,
        [RESPONSIBLE_ONBOARDING_TEMPLATE_NAME]
    );
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await db.query(
        `INSERT INTO onboarding_templates (name, department, items)
         VALUES ($1, NULL, $2::jsonb)
         RETURNING id, name, items`,
        [RESPONSIBLE_ONBOARDING_TEMPLATE_NAME, JSON.stringify(ONBOARDING_DEFAULT_ITEMS)]
    );
    return inserted.rows[0];
}

async function loadActiveOnboardingProgressRecord(staffId, db = pool, { lock = false } = {}) {
    const result = await db.query(
        `SELECT *
         FROM onboarding_progress
         WHERE staff_id = $1 AND status <> 'completed'
         ORDER BY started_at DESC, id DESC
         LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [staffId]
    );
    return result.rows[0] || null;
}

async function loadActiveOnboardingProgress(staffId, db = pool) {
    const result = await db.query(
        `SELECT op.*, ot.name AS template_name,
                u.name AS responsible_name, u.username AS responsible_username, u.role AS responsible_role,
                COUNT(t.id)::int AS generated_task_count,
                COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') NOT IN ('done','completed','archived','cancelled'))::int AS active_task_count,
                COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') IN ('done','completed'))::int AS completed_task_count
         FROM onboarding_progress op
         LEFT JOIN onboarding_templates ot ON ot.id = op.template_id
         LEFT JOIN users u ON u.id = op.responsible_user_id
         LEFT JOIN tasks t ON t.source_type = $2 AND t.source_id LIKE op.id::text || ':%'
         WHERE op.staff_id = $1 AND op.status <> 'completed'
         GROUP BY op.id, ot.name, u.name, u.username, u.role
         ORDER BY op.started_at DESC, op.id DESC
         LIMIT 1`,
        [staffId, ONBOARDING_TASK_SOURCE_TYPE]
    );
    return result.rows[0] || null;
}

async function attachOnboardingAssignments(staffRows = []) {
    if (!Array.isArray(staffRows) || !staffRows.length) return staffRows;
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isFinite);
    if (!staffIds.length) return staffRows;
    const result = await pool.query(
        `WITH active AS (
            SELECT DISTINCT ON (op.staff_id)
                   op.*, ot.name AS template_name,
                   u.name AS responsible_name, u.username AS responsible_username, u.role AS responsible_role
            FROM onboarding_progress op
            LEFT JOIN onboarding_templates ot ON ot.id = op.template_id
            LEFT JOIN users u ON u.id = op.responsible_user_id
            WHERE op.staff_id = ANY($1::int[]) AND op.status <> 'completed'
            ORDER BY op.staff_id, op.started_at DESC, op.id DESC
         )
         SELECT active.*,
                COUNT(t.id)::int AS generated_task_count,
                COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') NOT IN ('done','completed','archived','cancelled'))::int AS active_task_count,
                COUNT(t.id) FILTER (WHERE COALESCE(t.status, 'todo') IN ('done','completed'))::int AS completed_task_count
         FROM active
         LEFT JOIN tasks t ON t.source_type = $2 AND t.source_id LIKE active.id::text || ':%'
         GROUP BY active.id, active.staff_id, active.template_id, active.items, active.completed_items,
                  active.total_items, active.status, active.started_at, active.completed_at,
                  active.responsible_user_id, active.assigned_by_user_id, active.assigned_by_username,
                  active.assigned_at, active.reassigned_at, active.training_status,
                  active.assignment_history, active.checklist_template_key, active.last_task_sync_at,
                  active.template_name, active.responsible_name, active.responsible_username, active.responsible_role`,
        [staffIds, ONBOARDING_TASK_SOURCE_TYPE]
    );
    const byStaff = new Map(result.rows.map(row => [Number(row.staff_id), onboardingProgressMeta(row)]));
    staffRows.forEach(row => {
        row.onboarding_assignment = byStaff.get(Number(row.id)) || null;
        row.onboardingAssignment = row.onboarding_assignment;
    });
    return staffRows;
}

async function loadStaffForOnboarding(staffId, db = pool, { lock = false } = {}) {
    const result = await db.query(
        `SELECT id, name, department, position, role_type, is_active
         FROM staff
         WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        [staffId]
    );
    return result.rows[0] || null;
}

async function withOnboardingTransaction(work) {
    const client = await pool.connect();
    const afterCommit = [];
    try {
        await client.query('BEGIN');
        const result = await work(client, afterCommit);
        await client.query('COMMIT');
        for (const callback of afterCommit) {
            try {
                Promise.resolve(callback()).catch(err => log.warn(`Onboarding post-commit hook skipped: ${err.message}`));
            } catch (err) {
                log.warn(`Onboarding post-commit hook skipped: ${err.message}`);
            }
        }
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            log.error(`Onboarding transaction rollback failed: ${rollbackErr.message}`);
        }
        throw err;
    } finally {
        client.release();
    }
}

async function syncOnboardingTasks(progress, staff, responsible, actor, options = {}) {
    const db = options.pool || pool;
    const afterCommit = Array.isArray(options.afterCommit) ? options.afterCommit : null;
    const created = [];
    const updated = [];
    const reused = [];
    for (const spec of ONBOARDING_TASK_SPECS) {
        const sourceId = onboardingTaskSourceId(progress.id, spec.key);
        const title = `${spec.title}: ${staff.name}`;
        const description = [
            spec.description,
            '',
            `Працівник: ${staff.name}`,
            `Onboarding #${progress.id}`,
            `Відповідальний: ${responsible.label}`
        ].join('\n');
        const existing = await db.query(
            `SELECT *
             FROM tasks
             WHERE source_type = $1 AND source_id = $2
             ORDER BY CASE WHEN COALESCE(status, 'todo') NOT IN ('done','completed','archived','cancelled') THEN 0 ELSE 1 END, id ASC
             LIMIT 1`,
            [ONBOARDING_TASK_SOURCE_TYPE, sourceId]
        );
        const row = existing.rows[0];
        if (row && !['done', 'completed', 'archived', 'cancelled'].includes(row.status || 'todo')) {
            const ownerChanged = Number(row.owner_user_id || 0) !== Number(responsible.id)
                || String(row.assigned_to || '') !== String(responsible.label || '');
            const result = await db.query(
                `UPDATE tasks
                 SET title = $2,
                     description = $3,
                     priority = $4,
                     assigned_to = $5,
                     owner = $5,
                     owner_user_id = $6,
                     category = 'checklist',
                     task_kind = 'checklist',
                     visibility = 'team',
                     workflow_state = CASE WHEN workflow_state IN ('done','archived') THEN workflow_state ELSE COALESCE(NULLIF(workflow_state, ''), 'todo') END,
                     related_entity_type = 'onboarding_progress',
                     related_entity_id = $7,
                     source_module = 'hr_onboarding',
                     checklist_template_key = $8,
                     updated_at = NOW(),
                     version = COALESCE(version, 1) + 1
                 WHERE id = $1
                 RETURNING *`,
                [row.id, title, description, spec.priority, responsible.label, responsible.id, String(progress.id), RESPONSIBLE_ONBOARDING_TEMPLATE_KEY]
            );
            const updatedTask = result.rows[0];
            if (ownerChanged) {
                await logTaskActionEvent({
                    taskId: updatedTask.id,
                    actionType: TASK_ACTION_TYPES.OWNER_REASSIGNED,
                    actor,
                    sourceSurface: 'hr_onboarding',
                    oldValue: {
                        ownerUserId: row.owner_user_id || null,
                        assignedTo: row.assigned_to || null,
                        owner: row.owner || null
                    },
                    newValue: {
                        ownerUserId: updatedTask.owner_user_id || null,
                        assignedTo: updatedTask.assigned_to || null,
                        owner: updatedTask.owner || null
                    },
                    meta: {
                        route: 'hr_onboarding_task_sync',
                        sourceModule: 'hr_onboarding',
                        onboardingProgressId: progress.id,
                        staffId: staff.id,
                        taskKey: spec.key,
                        canonicalField: 'tasks.owner_user_id',
                        legacyDisplayFields: ['assigned_to', 'owner']
                    }
                }, { pool: db });
                if (afterCommit) {
                    afterCommit.push(() => emitTaskAssignedToOwner(updatedTask, actor, {
                        assignmentEvent: 'reassigned',
                        source: 'routes/hr.onboarding'
                    }));
                }
            }
            updated.push(updatedTask);
            continue;
        }
        if (row) {
            reused.push(row);
            continue;
        }
        const task = await createTask({
            title,
            description,
            priority: spec.priority,
            assigned_to: responsible.label,
            owner: responsible.label,
            owner_user_id: responsible.id,
            category: 'checklist',
            task_kind: 'checklist',
            task_mode: 'work',
            visibility: 'team',
            workflow_state: 'todo',
            source_type: ONBOARDING_TASK_SOURCE_TYPE,
            source_id: sourceId,
            related_entity_type: 'onboarding_progress',
            related_entity_id: String(progress.id),
            source_module: 'hr_onboarding',
            checklist_template_key: RESPONSIBLE_ONBOARDING_TEMPLATE_KEY,
            created_by: actor?.username || 'system',
            created_by_user_id: normalizeUserId(actor),
            control_meta: {
                systemGenerated: true,
                onboardingProgressId: progress.id,
                staffId: staff.id,
                taskKey: spec.key
            }
        }, { pool: db, afterCommit });
        if (task.duplicateSkipped) reused.push(task);
        else created.push(task);
    }
    await db.query('UPDATE onboarding_progress SET last_task_sync_at = NOW() WHERE id = $1', [progress.id]);
    return {
        created,
        updated,
        reused,
        created_count: created.length,
        updated_count: updated.length,
        reused_count: reused.length,
        total: created.length + updated.length + reused.length
    };
}

async function insertHrAuditLog(action, staffId, performedBy, details, ipAddress, db = pool) {
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [action, staffId, performedBy, details ? JSON.stringify(details) : null, ipAddress]
    );
}

async function assignOnboardingResponsible(staffId, responsibleUserId, actor, options = {}) {
    return withOnboardingTransaction(async (db, afterCommit) => {
    const staff = await loadStaffForOnboarding(staffId, db, { lock: true });
    if (!staff) {
        const err = new Error('Працівника не знайдено');
        err.statusCode = 404;
        throw err;
    }
    if (staff.is_active === false) {
        const err = new Error('Не можна запускати onboarding для неактивного працівника');
        err.statusCode = 400;
        throw err;
    }
    let responsible;
    try {
        responsible = await getAssignableTaskOwner(responsibleUserId, { pool: db, actor });
    } catch (err) {
        err.message = 'Відповідального не знайдено або його не можна призначити на задачі';
        throw err;
    }
    const template = options.templateId
        ? (await db.query('SELECT id, name, items FROM onboarding_templates WHERE id = $1', [options.templateId])).rows[0]
        : await ensureResponsibleOnboardingTemplate(db);
    if (!template) {
        const err = new Error('Шаблон onboarding не знайдено');
        err.statusCode = 404;
        throw err;
    }

    const current = await loadActiveOnboardingProgressRecord(staff.id, db, { lock: true });
    const actorId = normalizeUserId(actor);
    const actorUsername = actor?.username || null;
    let progress;
    let action = 'assigned';
    if (!current) {
        const items = normalizeOnboardingTemplateItems(template.items);
        const inserted = await db.query(
            `INSERT INTO onboarding_progress
                (staff_id, template_id, items, total_items, completed_items, status,
                 responsible_user_id, assigned_by_user_id, assigned_by_username, assigned_at,
                 training_status, assignment_history, checklist_template_key)
             VALUES ($1, $2, $3::jsonb, $4, 0, 'in_progress',
                     $5, $6, $7, NOW(), 'not_started', $8::jsonb, $9)
             RETURNING *`,
            [
                staff.id,
                template.id,
                JSON.stringify(items),
                items.length,
                responsible.id,
                actorId,
                actorUsername,
                JSON.stringify([{
                    at: new Date().toISOString(),
                    action: 'assigned',
                    oldResponsibleUserId: null,
                    newResponsibleUserId: responsible.id,
                    byUserId: actorId,
                    byUsername: actorUsername
                }]),
                RESPONSIBLE_ONBOARDING_TEMPLATE_KEY
            ]
        );
        progress = inserted.rows[0];
    } else {
        const previousResponsibleId = current.responsible_user_id ? Number(current.responsible_user_id) : null;
        action = previousResponsibleId && previousResponsibleId !== responsible.id ? 'reassigned' : 'confirmed';
        const history = parseJsonArray(current.assignment_history);
        history.push({
            at: new Date().toISOString(),
            action,
            oldResponsibleUserId: previousResponsibleId,
            newResponsibleUserId: responsible.id,
            byUserId: actorId,
            byUsername: actorUsername
        });
        const completed = Number(current.completed_items || completedOnboardingItemCount(current.items));
        const total = Number(current.total_items || normalizeOnboardingTemplateItems(current.items).length || 0);
        const nextTrainingStatus = current.status === 'completed'
            ? 'completed'
            : normalizeTrainingStatus(current.training_status, completed > 0 ? 'in_progress' : 'not_started');
        const nextStatus = normalizeOnboardingStatus(current.status, nextTrainingStatus);
        const updated = await db.query(
            `UPDATE onboarding_progress
             SET responsible_user_id = $2,
                 assigned_by_user_id = $3,
                 assigned_by_username = $4,
                 assigned_at = COALESCE(assigned_at, NOW()),
                 reassigned_at = CASE WHEN $5 THEN NOW() ELSE reassigned_at END,
                 training_status = $6,
                 status = $7,
                 assignment_history = $8::jsonb,
                 checklist_template_key = COALESCE(checklist_template_key, $9),
                 total_items = CASE WHEN total_items IS NULL OR total_items = 0 THEN $10 ELSE total_items END,
                 completed_items = $11
             WHERE id = $1
             RETURNING *`,
            [
                current.id,
                responsible.id,
                actorId,
                actorUsername,
                action === 'reassigned',
                nextTrainingStatus,
                nextStatus,
                JSON.stringify(history),
                RESPONSIBLE_ONBOARDING_TEMPLATE_KEY,
                total,
                completed
            ]
        );
        progress = updated.rows[0];
    }

    const taskSync = await syncOnboardingTasks(progress, staff, responsible, actor, { pool: db, afterCommit });
    await insertHrAuditLog(action === 'reassigned' ? 'onboarding_responsible_reassigned' : 'onboarding_responsible_assigned', staff.id, actorUsername, {
        onboarding_progress_id: progress.id,
        responsible_user_id: responsible.id,
        responsible_username: responsible.username,
        action,
        task_sync: {
            created: taskSync.created_count,
            updated: taskSync.updated_count,
            reused: taskSync.reused_count
        }
    }, options.ipAddress, db);

    const enriched = await loadActiveOnboardingProgress(staff.id, db);
    return {
        staff,
        responsible,
        progress: onboardingProgressMeta(enriched || progress),
        taskSync,
        action
    };
    });
}

module.exports = {
    ONBOARDING_TASK_SOURCE_TYPE,
    assignOnboardingResponsible,
    attachOnboardingAssignments,
    loadActiveOnboardingProgress,
    loadStaffForOnboarding,
    onboardingProgressMeta
};
