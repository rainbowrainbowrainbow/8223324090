const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { createTask } = require('./kleshnya');
const { getAssignableTaskOwner } = require('./taskExecution');
const { normalizeUserId } = require('./taskPolicy');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { emitTaskAssignedToOwner } = require('./taskNotifications');
const { normalizeProfessionKey } = require('./professions');

const log = createLogger('HR Onboarding');

const ONBOARDING_LEGACY_STATUSES = new Set(['in_progress', 'completed', 'blocked', 'ready']);
const TRAINING_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'ready', 'completed']);
const RESPONSIBLE_ONBOARDING_TEMPLATE_NAME = 'Відповідальний онбординг';
const RESPONSIBLE_ONBOARDING_TEMPLATE_KEY = 'responsible_onboarding_v1';
const PROFESSION_ONBOARDING_TEMPLATE_KEY = 'profession_onboarding_v1';
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

function normalizeOnboardingProfessionKey(value) {
    return normalizeProfessionKey(cleanOnboardingText(value, 64)) || null;
}

function professionChecklistItems(value = []) {
    return parseJsonArray(value).map((item, index) => {
        const raw = item && typeof item === 'object' ? item : { title: item };
        const key = cleanOnboardingText(raw.key || raw.id || `item_${index + 1}`, 128) || `item_${index + 1}`;
        const title = cleanOnboardingText(raw.title || raw.name || raw.label, 500);
        return title ? {
            key,
            title,
            description: cleanOnboardingText(raw.description, 1000)
        } : null;
    }).filter(Boolean);
}

function professionReadinessMeta(value = {}) {
    const items = Array.isArray(value.items) ? value.items : [];
    const total = Number(value.total ?? items.length ?? 0);
    const completed = Number(value.completed ?? items.filter(item => item?.completed_at).length ?? 0);
    return {
        completed,
        total,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
        items
    };
}

function professionTrainingStatus(row = {}, readiness = {}) {
    if (row.status === 'completed') return 'completed';
    if (row.status === 'blocked') return 'blocked';
    if (readiness.total > 0 && readiness.completed >= readiness.total) return 'ready';
    if (readiness.completed > 0) return 'in_progress';
    return 'not_started';
}

function onboardingProgressMeta(row = {}) {
    const professionKey = normalizeOnboardingProfessionKey(row.profession_key);
    const readiness = professionKey ? professionReadinessMeta(row.profession_readiness) : null;
    const items = professionKey ? readiness.items : normalizeOnboardingTemplateItems(row.items || []);
    const total = professionKey ? readiness.total : Number(row.total_items || items.length || 0);
    const completed = professionKey ? readiness.completed : Number(row.completed_items || completedOnboardingItemCount(items));
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const taskTotal = Number(row.generated_task_count || row.task_total || 0);
    const taskActive = Number(row.active_task_count || row.task_active || 0);
    const taskCompleted = Number(row.completed_task_count || row.task_completed || 0);
    const responsibleUserId = Number(row.responsible_user_id || 0) || null;
    const responsibleName = row.responsible_name || row.responsible_username || null;
    return {
        id: row.id ? Number(row.id) : null,
        staff_id: row.staff_id ? Number(row.staff_id) : null,
        staff_name: row.staff_name || null,
        department: row.department || null,
        template_id: row.template_id || null,
        template_name: row.template_name || null,
        profession_key: professionKey,
        professionKey,
        profession_title: row.profession_title || professionKey || null,
        professionTitle: row.profession_title || professionKey || null,
        scope: professionKey ? 'profession' : 'general',
        is_primary: row.is_primary === true,
        assignment_status: row.assignment_status || null,
        admission_status: row.admission_status || null,
        internship_status: row.internship_status || null,
        checklist_template_key: row.checklist_template_key || (professionKey ? PROFESSION_ONBOARDING_TEMPLATE_KEY : RESPONSIBLE_ONBOARDING_TEMPLATE_KEY),
        status: normalizeOnboardingStatus(row.status, row.training_status),
        training_status: professionKey
            ? professionTrainingStatus(row, readiness)
            : normalizeTrainingStatus(row.training_status, row.status === 'completed' ? 'completed' : 'not_started'),
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
        items,
        readiness: professionKey ? readiness : null,
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

async function loadProfessionOnboardingContext(staffId, professionKey, db = pool) {
    const key = normalizeOnboardingProfessionKey(professionKey);
    if (!key) return null;
    const result = await db.query(
        `SELECT hp.key AS profession_key,
                hp.title AS profession_title,
                hp.checklist,
                hp.is_active AS profession_is_active,
                sra.is_primary,
                sra.status AS assignment_status,
                sra.admission_status,
                sra.internship_status
         FROM hr_professions hp
         LEFT JOIN staff_role_assignments sra
           ON sra.staff_id = $1
          AND sra.profession_key = hp.key
         WHERE hp.key = $2
         LIMIT 1`,
        [staffId, key]
    );
    return result.rows[0] || null;
}

function professionOnboardingError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function validateProfessionOnboardingContext(context, professionKey) {
    if (!context) {
        throw professionOnboardingError(`Професію ${professionKey} не знайдено`, 404, 'PROFESSION_NOT_FOUND');
    }
    if (context.profession_is_active === false) {
        throw professionOnboardingError('Не можна запускати onboarding для неактивної професії', 409, 'PROFESSION_INACTIVE');
    }
    if (!context.assignment_status) {
        throw professionOnboardingError('Професія не призначена працівнику', 409, 'PROFESSION_NOT_ASSIGNED');
    }
    if (context.assignment_status !== 'active') {
        throw professionOnboardingError('Для onboarding потрібне активне призначення професії', 409, 'PROFESSION_ASSIGNMENT_INACTIVE');
    }
    const checklist = professionChecklistItems(context.checklist);
    if (!checklist.length) {
        throw professionOnboardingError('Для професії не налаштований onboarding checklist', 409, 'PROFESSION_CHECKLIST_EMPTY');
    }
    return { ...context, checklist };
}

async function ensureProfessionChecklistSnapshot(staffId, context, db = pool) {
    const items = Array.isArray(context?.checklist) ? context.checklist : professionChecklistItems(context?.checklist);
    for (const item of items) {
        await db.query(
            `INSERT INTO hr_staff_profession_checklist_progress
                (staff_id, profession_key, checklist_key, title, completed_at, completed_by, notes, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NOW())
             ON CONFLICT (staff_id, profession_key, checklist_key) DO NOTHING`,
            [staffId, context.profession_key, item.key, item.title]
        );
    }
    return items;
}

async function loadProfessionReadiness(staffId, professionKey, db = pool) {
    const key = normalizeOnboardingProfessionKey(professionKey);
    if (!key) return professionReadinessMeta();
    const result = await db.query(
        `SELECT checklist_key, title, completed_at, completed_by, notes
         FROM hr_staff_profession_checklist_progress
         WHERE staff_id = $1
           AND profession_key = $2
         ORDER BY created_at ASC, id ASC`,
        [staffId, key]
    );
    const items = result.rows.map((row, index) => ({
        id: index + 1,
        key: row.checklist_key,
        checklist_key: row.checklist_key,
        title: row.title,
        done: Boolean(row.completed_at),
        completed_at: row.completed_at || null,
        completed_by: row.completed_by || null,
        notes: row.notes || null
    }));
    return professionReadinessMeta({ items });
}

async function attachProfessionOnboardingContext(rows = [], db = pool) {
    const scopedRows = rows.filter(row => normalizeOnboardingProfessionKey(row.profession_key));
    if (!scopedRows.length) return rows;
    await Promise.all(scopedRows.map(async row => {
        const [context, readiness] = await Promise.all([
            loadProfessionOnboardingContext(row.staff_id, row.profession_key, db),
            loadProfessionReadiness(row.staff_id, row.profession_key, db)
        ]);
        row.profession_title = context?.profession_title || row.profession_key;
        row.is_primary = context?.is_primary === true;
        row.assignment_status = context?.assignment_status || null;
        row.admission_status = context?.admission_status || null;
        row.internship_status = context?.internship_status || null;
        row.profession_readiness = readiness;
    }));
    return rows;
}

async function loadActiveOnboardingProgressRecord(staffId, db = pool, { lock = false, professionKey = null } = {}) {
    const key = normalizeOnboardingProfessionKey(professionKey);
    const scopeSql = key ? 'profession_key = $2' : 'profession_key IS NULL';
    const params = key ? [staffId, key] : [staffId];
    const result = await db.query(
        `SELECT *
         FROM onboarding_progress
         WHERE staff_id = $1
           AND ${scopeSql}
           AND status <> 'completed'
         ORDER BY started_at DESC, id DESC
         LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        params
    );
    return result.rows[0] || null;
}

async function loadActiveOnboardingProgress(staffId, db = pool, { professionKey = null } = {}) {
    const key = normalizeOnboardingProfessionKey(professionKey);
    const scopeSql = key ? 'op.profession_key = $3' : 'op.profession_key IS NULL';
    const params = key
        ? [staffId, ONBOARDING_TASK_SOURCE_TYPE, key]
        : [staffId, ONBOARDING_TASK_SOURCE_TYPE];
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
         WHERE op.staff_id = $1
           AND ${scopeSql}
           AND op.status <> 'completed'
         GROUP BY op.id, ot.name, u.name, u.username, u.role
         ORDER BY op.started_at DESC, op.id DESC
         LIMIT 1`,
        params
    );
    await attachProfessionOnboardingContext(result.rows, db);
    return result.rows[0] || null;
}

async function loadOnboardingProcessesForStaff(staffId, db = pool) {
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
         WHERE op.staff_id = $1
         GROUP BY op.id, ot.name, u.name, u.username, u.role
         ORDER BY op.profession_key NULLS FIRST, op.started_at DESC, op.id DESC`,
        [staffId, ONBOARDING_TASK_SOURCE_TYPE]
    );
    await attachProfessionOnboardingContext(result.rows, db);
    const data = result.rows.map(onboardingProgressMeta);
    return {
        general: data.find(item => item.scope === 'general' && item.status !== 'completed') || null,
        professions: data.filter(item => item.scope === 'profession'),
        history: data.filter(item => item.scope === 'general' && item.status === 'completed')
    };
}

async function attachOnboardingAssignments(staffRows = []) {
    if (!Array.isArray(staffRows) || !staffRows.length) return staffRows;
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isFinite);
    if (!staffIds.length) return staffRows;
    const [result, professionSummaryResult] = await Promise.all([
        pool.query(
            `WITH active AS (
            SELECT DISTINCT ON (op.staff_id)
                   op.*, ot.name AS template_name,
                   u.name AS responsible_name, u.username AS responsible_username, u.role AS responsible_role
            FROM onboarding_progress op
            LEFT JOIN onboarding_templates ot ON ot.id = op.template_id
            LEFT JOIN users u ON u.id = op.responsible_user_id
            WHERE op.staff_id = ANY($1::int[])
              AND op.profession_key IS NULL
              AND op.status <> 'completed'
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
                  active.profession_key,
                  active.responsible_user_id, active.assigned_by_user_id, active.assigned_by_username,
                  active.assigned_at, active.reassigned_at, active.training_status,
                   active.assignment_history, active.checklist_template_key, active.last_task_sync_at,
                   active.template_name, active.responsible_name, active.responsible_username, active.responsible_role`,
            [staffIds, ONBOARDING_TASK_SOURCE_TYPE]
        ),
        pool.query(
            `SELECT op.staff_id,
                    COUNT(*) FILTER (WHERE op.status <> 'completed')::int AS active_count
             FROM onboarding_progress op
             WHERE op.staff_id = ANY($1::int[])
               AND op.profession_key IS NOT NULL
             GROUP BY op.staff_id`,
            [staffIds]
        )
    ]);
    const byStaff = new Map(result.rows.map(row => [Number(row.staff_id), onboardingProgressMeta(row)]));
    const professionSummaryByStaff = new Map(professionSummaryResult.rows.map(row => [
        Number(row.staff_id),
        { active_count: Number(row.active_count || 0) }
    ]));
    staffRows.forEach(row => {
        row.onboarding_assignment = byStaff.get(Number(row.id)) || null;
        row.onboardingAssignment = row.onboarding_assignment;
        row.profession_onboarding_summary = professionSummaryByStaff.get(Number(row.id)) || { active_count: 0 };
        row.professionOnboardingSummary = row.profession_onboarding_summary;
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
    const professionKey = normalizeOnboardingProfessionKey(progress.profession_key);
    const professionTitle = progress.profession_title || professionKey || null;
    const checklistTemplateKey = professionKey ? PROFESSION_ONBOARDING_TEMPLATE_KEY : RESPONSIBLE_ONBOARDING_TEMPLATE_KEY;
    const created = [];
    const updated = [];
    const reused = [];
    for (const spec of ONBOARDING_TASK_SPECS) {
        const sourceId = onboardingTaskSourceId(progress.id, spec.key);
        const title = professionTitle
            ? `${spec.title} (${professionTitle}): ${staff.name}`
            : `${spec.title}: ${staff.name}`;
        const description = [
            spec.description,
            '',
            `Працівник: ${staff.name}`,
            professionTitle ? `Професія: ${professionTitle} (${professionKey})` : 'Scope: загальний корпоративний onboarding',
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
                [row.id, title, description, spec.priority, responsible.label, responsible.id, String(progress.id), checklistTemplateKey]
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
                        professionKey,
                        professionTitle,
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
            checklist_template_key: checklistTemplateKey,
            created_by: actor?.username || 'system',
            created_by_user_id: normalizeUserId(actor),
            control_meta: {
                systemGenerated: true,
                onboardingProgressId: progress.id,
                staffId: staff.id,
                professionKey,
                professionTitle,
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

async function loadLatestProfessionOnboardingProgressRecord(staffId, professionKey, db = pool, { lock = false } = {}) {
    const key = normalizeOnboardingProfessionKey(professionKey);
    if (!key) return null;
    const result = await db.query(
        `SELECT *
         FROM onboarding_progress
         WHERE staff_id = $1
           AND profession_key = $2
         ORDER BY started_at DESC, id DESC
         LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
        [staffId, key]
    );
    return result.rows[0] || null;
}

async function assignOnboardingResponsible(staffId, responsibleUserId, actor, options = {}) {
    const work = async (db, afterCommit) => {
        const staff = await loadStaffForOnboarding(staffId, db, { lock: true });
        if (!staff) throw professionOnboardingError('Працівника не знайдено', 404, 'STAFF_NOT_FOUND');
        if (staff.is_active === false) {
            throw professionOnboardingError('Не можна запускати onboarding для неактивного працівника', 400, 'STAFF_INACTIVE');
        }

        const professionKey = normalizeOnboardingProfessionKey(options.professionKey);
        let professionContext = null;
        if (professionKey) {
            professionContext = validateProfessionOnboardingContext(
                await loadProfessionOnboardingContext(staff.id, professionKey, db),
                professionKey
            );
            await ensureProfessionChecklistSnapshot(staff.id, professionContext, db);
        }

        let responsible;
        try {
            responsible = await getAssignableTaskOwner(responsibleUserId, { pool: db, actor });
        } catch (err) {
            err.message = 'Відповідального не знайдено або його не можна призначити на задачі';
            throw err;
        }

        const template = professionKey
            ? null
            : (options.templateId
                ? (await db.query('SELECT id, name, items FROM onboarding_templates WHERE id = $1', [options.templateId])).rows[0]
                : await ensureResponsibleOnboardingTemplate(db));
        if (!professionKey && !template) {
            throw professionOnboardingError('Шаблон onboarding не знайдено', 404, 'ONBOARDING_TEMPLATE_NOT_FOUND');
        }

        const current = professionKey
            ? await loadLatestProfessionOnboardingProgressRecord(staff.id, professionKey, db, { lock: true })
            : await loadActiveOnboardingProgressRecord(staff.id, db, { lock: true });
        const actorId = normalizeUserId(actor);
        const actorUsername = actor?.username || null;
        const checklistTemplateKey = professionKey ? PROFESSION_ONBOARDING_TEMPLATE_KEY : RESPONSIBLE_ONBOARDING_TEMPLATE_KEY;
        let progress;
        let action = 'assigned';
        if (!current) {
            const items = professionKey ? [] : normalizeOnboardingTemplateItems(template.items);
            const inserted = await db.query(
                `INSERT INTO onboarding_progress
                    (staff_id, template_id, profession_key, items, total_items, completed_items, status,
                     responsible_user_id, assigned_by_user_id, assigned_by_username, assigned_at,
                     training_status, assignment_history, checklist_template_key)
                 VALUES ($1, $2, $3, $4::jsonb, $5, 0, 'in_progress',
                         $6, $7, $8, NOW(), 'not_started', $9::jsonb, $10)
                 RETURNING *`,
                [
                    staff.id,
                    template?.id || null,
                    professionKey,
                    JSON.stringify(items),
                    professionKey ? 0 : items.length,
                    responsible.id,
                    actorId,
                    actorUsername,
                    JSON.stringify([{
                        at: new Date().toISOString(),
                        action: 'assigned',
                        professionKey,
                        oldResponsibleUserId: null,
                        newResponsibleUserId: responsible.id,
                        byUserId: actorId,
                        byUsername: actorUsername
                    }]),
                    checklistTemplateKey
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
                professionKey,
                oldResponsibleUserId: previousResponsibleId,
                newResponsibleUserId: responsible.id,
                byUserId: actorId,
                byUsername: actorUsername
            });
            const readiness = professionKey ? await loadProfessionReadiness(staff.id, professionKey, db) : null;
            const completed = professionKey
                ? 0
                : Number(current.completed_items || completedOnboardingItemCount(current.items));
            const total = professionKey
                ? 0
                : Number(current.total_items || normalizeOnboardingTemplateItems(current.items).length || 0);
            const nextTrainingStatus = professionKey
                ? professionTrainingStatus(current, readiness)
                : (current.status === 'completed'
                    ? 'completed'
                    : normalizeTrainingStatus(current.training_status, completed > 0 ? 'in_progress' : 'not_started'));
            const nextStatus = current.status === 'completed'
                ? 'completed'
                : normalizeOnboardingStatus(current.status, nextTrainingStatus);
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
                     total_items = CASE WHEN profession_key IS NULL AND (total_items IS NULL OR total_items = 0) THEN $10 ELSE total_items END,
                     completed_items = CASE WHEN profession_key IS NULL THEN $11 ELSE completed_items END
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
                    checklistTemplateKey,
                    total,
                    completed
                ]
            );
            progress = updated.rows[0];
        }

        progress.profession_title = professionContext?.profession_title || null;
        const taskSync = await syncOnboardingTasks(progress, staff, responsible, actor, { pool: db, afterCommit });
        const auditAction = professionKey
            ? (action === 'assigned'
                ? 'profession_onboarding_started'
                : action === 'reassigned'
                    ? 'profession_onboarding_responsible_reassigned'
                    : 'profession_onboarding_confirmed')
            : (action === 'reassigned' ? 'onboarding_responsible_reassigned' : 'onboarding_responsible_assigned');
        await insertHrAuditLog(auditAction, staff.id, actorUsername, {
            onboarding_progress_id: progress.id,
            profession_key: professionKey,
            profession_title: professionContext?.profession_title || null,
            responsible_user_id: responsible.id,
            responsible_username: responsible.username,
            action,
            task_sync: {
                created: taskSync.created_count,
                updated: taskSync.updated_count,
                reused: taskSync.reused_count
            }
        }, options.ipAddress, db);

        let enriched = await loadActiveOnboardingProgress(staff.id, db, { professionKey });
        if (!enriched && professionKey) {
            progress.profession_readiness = await loadProfessionReadiness(staff.id, professionKey, db);
            progress.profession_title = professionContext?.profession_title || professionKey;
            progress.is_primary = professionContext?.is_primary === true;
            progress.assignment_status = professionContext?.assignment_status || null;
            progress.admission_status = professionContext?.admission_status || null;
            progress.internship_status = professionContext?.internship_status || null;
            enriched = progress;
        }
        return {
            staff,
            responsible,
            progress: onboardingProgressMeta(enriched || progress),
            taskSync,
            action
        };
    };
    if (options.db) {
        const afterCommit = Array.isArray(options.afterCommit) ? options.afterCommit : [];
        return work(options.db, afterCommit);
    }
    return withOnboardingTransaction(work);
}

async function syncProfessionOnboardingProgress(staffId, professionKey, actor, options = {}) {
    const db = options.db || pool;
    const key = normalizeOnboardingProfessionKey(professionKey);
    if (!key) return null;
    const current = await loadLatestProfessionOnboardingProgressRecord(staffId, key, db, { lock: options.lock === true });
    if (!current) return null;
    const readiness = await loadProfessionReadiness(staffId, key, db);
    const completed = readiness.total > 0 && readiness.completed >= readiness.total;
    const previousStatus = current.status;
    const nextStatus = completed ? 'completed' : (previousStatus === 'blocked' ? 'blocked' : 'in_progress');
    const nextTrainingStatus = completed
        ? 'completed'
        : (previousStatus === 'blocked' ? 'blocked' : (readiness.completed > 0 ? 'in_progress' : 'not_started'));
    const result = await db.query(
        `UPDATE onboarding_progress
         SET status = $2::text,
             training_status = $3::text,
             completed_at = CASE WHEN $2::text = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END
         WHERE id = $1
         RETURNING *`,
        [current.id, nextStatus, nextTrainingStatus]
    );
    const progress = result.rows[0];
    const context = await loadProfessionOnboardingContext(staffId, key, db);
    progress.profession_readiness = readiness;
    progress.profession_title = context?.profession_title || key;
    progress.is_primary = context?.is_primary === true;
    progress.assignment_status = context?.assignment_status || null;
    progress.admission_status = context?.admission_status || null;
    progress.internship_status = context?.internship_status || null;

    if (previousStatus !== nextStatus && nextStatus === 'completed') {
        await insertHrAuditLog('profession_onboarding_completed', staffId, actor?.username || null, {
            onboarding_progress_id: progress.id,
            profession_key: key,
            completed_items: readiness.completed,
            total_items: readiness.total
        }, options.ipAddress, db);
    } else if (previousStatus === 'completed' && nextStatus !== 'completed') {
        await insertHrAuditLog('profession_onboarding_reopened', staffId, actor?.username || null, {
            onboarding_progress_id: progress.id,
            profession_key: key,
            completed_items: readiness.completed,
            total_items: readiness.total
        }, options.ipAddress, db);
    }
    return onboardingProgressMeta(progress);
}

module.exports = {
    ONBOARDING_TASK_SOURCE_TYPE,
    assignOnboardingResponsible,
    attachOnboardingAssignments,
    attachProfessionOnboardingContext,
    loadActiveOnboardingProgress,
    loadOnboardingProcessesForStaff,
    loadProfessionReadiness,
    loadStaffForOnboarding,
    onboardingProgressMeta,
    syncProfessionOnboardingProgress
};
