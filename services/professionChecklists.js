'use strict';

const { createHash, randomUUID } = require('node:crypto');

const CHECKLIST_ITEM_TITLE_MAX_LENGTH = 500;
const CHECKLIST_NOTES_MAX_LENGTH = 1000;
const CHECKLIST_PROGRESS_ACTOR_MAX_LENGTH = 80;
const CHECKLIST_ITEM_KEY_MAX_LENGTH = 128;
const CHECKLIST_ITEM_KEY_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,127}$/;
const CHECKLIST_DASHBOARD_STATUSES = Object.freeze([
    'without_template',
    'not_started',
    'in_progress',
    'completed',
    'archived',
    'orphaned'
]);
const CHECKLIST_DASHBOARD_STATUS_SET = new Set(CHECKLIST_DASHBOARD_STATUSES);
const ASSIGNMENT_STATUS_SET = new Set(['active', 'inactive', 'suspended']);

class ProfessionChecklistError extends Error {
    constructor(message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'ProfessionChecklistError';
        this.code = options.code || 'PROFESSION_CHECKLIST_ERROR';
        this.statusCode = Number(options.statusCode) || 400;
        this.status = this.statusCode;
        if (options.details !== undefined) this.details = options.details;
    }
}

function professionChecklistError(message, statusCode = 400, code = 'PROFESSION_CHECKLIST_ERROR', details) {
    return new ProfessionChecklistError(message, { statusCode, code, details });
}

function isProfessionChecklistError(error) {
    return error instanceof ProfessionChecklistError
        || (Boolean(error?.code) && String(error.code).startsWith('PROFESSION_CHECKLIST_'));
}

function assertQueryClient(db, label = 'db') {
    if (!db || typeof db.query !== 'function') {
        throw professionChecklistError(
            `${label} must expose query(text, params)`,
            500,
            'PROFESSION_CHECKLIST_DB_CLIENT_REQUIRED'
        );
    }
    return db;
}

function safeRows(result) {
    return Array.isArray(result?.rows) ? result.rows : [];
}

function normalizePositiveInteger(value, fieldName = 'id') {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw professionChecklistError(
            `Потрібне коректне значення ${fieldName}`,
            400,
            'PROFESSION_CHECKLIST_INVALID_ID',
            { field: fieldName }
        );
    }
    return number;
}

function normalizeProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function normalizeProfessionIdentity(value = {}) {
    if (typeof value === 'number') {
        return { id: normalizePositiveInteger(value, 'professionId'), key: '' };
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^[1-9]\d*$/.test(trimmed)) {
            return { id: normalizePositiveInteger(trimmed, 'professionId'), key: '' };
        }
        const key = normalizeProfessionKey(trimmed);
        if (!key) {
            throw professionChecklistError(
                'Потрібна коректна професія',
                400,
                'PROFESSION_CHECKLIST_INVALID_PROFESSION'
            );
        }
        return { id: null, key };
    }

    const rawId = value?.id ?? value?.professionId ?? value?.profession_id;
    if (rawId !== undefined && rawId !== null && rawId !== '') {
        return { id: normalizePositiveInteger(rawId, 'professionId'), key: '' };
    }
    const key = normalizeProfessionKey(value?.key ?? value?.professionKey ?? value?.profession_key);
    if (!key) {
        throw professionChecklistError(
            'Потрібна коректна професія',
            400,
            'PROFESSION_CHECKLIST_INVALID_PROFESSION'
        );
    }
    return { id: null, key };
}

function normalizeChecklistItemKey(value, options = {}) {
    const key = String(value || '').trim().toLowerCase();
    if (!key || key.length > CHECKLIST_ITEM_KEY_MAX_LENGTH || !CHECKLIST_ITEM_KEY_PATTERN.test(key)) {
        if (options.allowEmpty === true && !key) return '';
        throw professionChecklistError(
            'Некоректний ключ пункту чекліста',
            400,
            'PROFESSION_CHECKLIST_INVALID_ITEM_KEY'
        );
    }
    return key;
}

function normalizeChecklistItemTitle(value) {
    const title = String(value ?? '').replace(/\u0000/g, '').trim();
    if (!title) {
        throw professionChecklistError(
            'Назва пункту чекліста є обов’язковою',
            400,
            'PROFESSION_CHECKLIST_TITLE_REQUIRED'
        );
    }
    if (title.length > CHECKLIST_ITEM_TITLE_MAX_LENGTH) {
        throw professionChecklistError(
            `Назва пункту не може перевищувати ${CHECKLIST_ITEM_TITLE_MAX_LENGTH} символів`,
            400,
            'PROFESSION_CHECKLIST_TITLE_TOO_LONG'
        );
    }
    return title;
}

function normalizeChecklistNotes(value) {
    if (value === null || value === undefined || value === '') return null;
    const notes = String(value).replace(/\u0000/g, '').trim();
    if (!notes) return null;
    if (notes.length > CHECKLIST_NOTES_MAX_LENGTH) {
        throw professionChecklistError(
            `Нотатка не може перевищувати ${CHECKLIST_NOTES_MAX_LENGTH} символів`,
            400,
            'PROFESSION_CHECKLIST_NOTES_TOO_LONG'
        );
    }
    return notes;
}

function normalizeChecklistActor(value, maxLength = 100) {
    const actor = typeof value === 'object' && value !== null
        ? value.username ?? value.name ?? value.login
        : value;
    const normalized = String(actor || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
    return normalized || null;
}

function normalizeChecklistCompleted(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    throw professionChecklistError(
        'Поле completed повинно бути boolean',
        400,
        'PROFESSION_CHECKLIST_INVALID_COMPLETED'
    );
}

function normalizeChecklistReorderKeys(value) {
    const source = Array.isArray(value)
        ? value
        : value?.itemKeys ?? value?.item_keys ?? value?.keys;
    if (!Array.isArray(source)) {
        throw professionChecklistError(
            'Для зміни порядку потрібен масив itemKeys',
            400,
            'PROFESSION_CHECKLIST_REORDER_REQUIRED'
        );
    }
    const keys = source.map(item => normalizeChecklistItemKey(
        typeof item === 'object' && item !== null ? item.itemKey ?? item.item_key ?? item.key : item
    ));
    if (new Set(keys).size !== keys.length) {
        throw professionChecklistError(
            'Порядок містить дублікати ключів',
            400,
            'PROFESSION_CHECKLIST_REORDER_DUPLICATE'
        );
    }
    return keys;
}

function normalizeChecklistInsertPosition(value, length) {
    if (value === undefined || value === null || value === '') return length;
    const position = Number(value);
    if (!Number.isInteger(position) || position < 0 || position > length) {
        throw professionChecklistError(
            'Некоректна позиція нового пункту',
            400,
            'PROFESSION_CHECKLIST_INVALID_POSITION',
            { minimum: 0, maximum: length }
        );
    }
    return position;
}

function generateChecklistItemKey(entropy) {
    const rawEntropy = typeof entropy === 'function'
        ? entropy()
        : entropy ?? randomUUID();
    const digest = createHash('sha256')
        .update(String(rawEntropy))
        .digest('hex')
        .slice(0, 32);
    return `chk_${digest}`;
}

function normalizeProfessionRow(row = {}) {
    const isActive = row.is_active ?? row.isActive ?? row.profession_is_active;
    return {
        id: Number(row.id ?? row.profession_id),
        key: normalizeProfessionKey(row.key ?? row.profession_key),
        title: row.title ?? row.profession_title ?? '',
        department: row.department || '',
        isActive: isActive !== false,
        is_active: isActive !== false
    };
}

function normalizeChecklistItemRow(row = {}) {
    const id = row.id ?? row.item_id ?? row.checklist_item_id;
    const professionId = row.profession_id ?? row.professionId;
    const itemKey = normalizeChecklistItemKey(
        row.item_key ?? row.itemKey ?? row.checklist_key,
        { allowEmpty: true }
    );
    const isActive = row.is_active ?? row.isActive ?? row.item_is_active;
    return {
        id: id === null || id === undefined ? null : Number(id),
        professionId: professionId === null || professionId === undefined ? null : Number(professionId),
        profession_id: professionId === null || professionId === undefined ? null : Number(professionId),
        itemKey,
        item_key: itemKey,
        checklistKey: itemKey,
        checklist_key: itemKey,
        title: row.title ?? row.item_title ?? '',
        sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
        sort_order: Number(row.sort_order ?? row.sortOrder ?? 0),
        isActive: isActive !== false,
        is_active: isActive !== false,
        legacyPosition: row.legacy_position === null || row.legacy_position === undefined
            ? null
            : Number(row.legacy_position),
        legacy_position: row.legacy_position === null || row.legacy_position === undefined
            ? null
            : Number(row.legacy_position),
        createdBy: row.created_by || null,
        updatedBy: row.updated_by || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function normalizeChecklistProgressRow(row = {}) {
    const id = row.progress_id ?? row.id;
    if (id === null || id === undefined) return null;
    const itemId = row.progress_checklist_item_id ?? row.checklist_item_id;
    const checklistKey = String(
        row.progress_checklist_key ?? row.checklist_key ?? row.item_key ?? ''
    ).trim();
    return {
        id: Number(id),
        staffId: Number(row.staff_id ?? row.staffId),
        staff_id: Number(row.staff_id ?? row.staffId),
        professionKey: normalizeProfessionKey(row.profession_key ?? row.professionKey),
        profession_key: normalizeProfessionKey(row.profession_key ?? row.professionKey),
        checklistItemId: itemId === null || itemId === undefined ? null : Number(itemId),
        checklist_item_id: itemId === null || itemId === undefined ? null : Number(itemId),
        checklistKey,
        checklist_key: checklistKey,
        legacyChecklistKey: row.legacy_checklist_key || null,
        legacy_checklist_key: row.legacy_checklist_key || null,
        title: row.progress_title ?? row.title ?? '',
        completed: Boolean(row.completed_at),
        completedAt: row.completed_at || null,
        completed_at: row.completed_at || null,
        completedBy: row.completed_by || null,
        completed_by: row.completed_by || null,
        notes: row.notes || null,
        createdAt: row.progress_created_at ?? row.created_at ?? null,
        updatedAt: row.progress_updated_at ?? row.updated_at ?? null,
        orphanReason: row.issue_reason || row.orphan_reason || null,
        candidateItemKeys: Array.isArray(row.candidate_item_keys) ? row.candidate_item_keys : []
    };
}

function classifyChecklistProgress(totalItems, completedItems) {
    const total = Math.max(0, Number(totalItems) || 0);
    const completed = Math.max(0, Math.min(total, Number(completedItems) || 0));
    let status = 'not_started';
    if (total === 0) status = 'without_template';
    else if (completed >= total) status = 'completed';
    else if (completed > 0) status = 'in_progress';
    return {
        status,
        total,
        completed,
        remaining: Math.max(0, total - completed),
        percent: total > 0 ? Math.round((completed / total) * 100) : 0
    };
}

function parseList(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    return String(value).split(',');
}

function normalizePositiveIntegerList(value, fieldName) {
    const seen = new Set();
    const result = [];
    for (const item of parseList(value)) {
        const normalized = normalizePositiveInteger(item, fieldName);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function normalizeStringList(value, normalizer, limit = 100) {
    const seen = new Set();
    const result = [];
    for (const item of parseList(value)) {
        const normalized = normalizer(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeOptionalBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    return fallback;
}

function normalizeDashboardInteger(value, options = {}) {
    const fallback = Number(options.fallback) || 0;
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        const field = options.field || 'pagination';
        throw professionChecklistError(
            `${field} має бути цілим числом`,
            400,
            'PROFESSION_CHECKLIST_INVALID_PAGINATION',
            { field, value }
        );
    }
    return Math.max(Number(options.min) || 0, Math.min(Number(options.max) || Number.MAX_SAFE_INTEGER, parsed));
}

function normalizeDashboardFilters(filters = {}) {
    const statuses = normalizeStringList(
        filters.statuses ?? filters.status,
        value => String(value || '').trim().toLowerCase()
    );
    const invalidStatuses = statuses.filter(status => !CHECKLIST_DASHBOARD_STATUS_SET.has(status));
    if (invalidStatuses.length) {
        throw professionChecklistError(
            `Невідомий статус dashboard: ${invalidStatuses.join(', ')}`,
            400,
            'PROFESSION_CHECKLIST_INVALID_DASHBOARD_STATUS',
            { invalidStatuses }
        );
    }

    const assignmentStatuses = normalizeStringList(
        filters.assignmentStatuses ?? filters.assignment_statuses ?? filters.assignmentStatus,
        value => String(value || '').trim().toLowerCase()
    );
    const invalidAssignmentStatuses = assignmentStatuses.filter(status => !ASSIGNMENT_STATUS_SET.has(status));
    if (invalidAssignmentStatuses.length) {
        throw professionChecklistError(
            `Невідомий статус призначення: ${invalidAssignmentStatuses.join(', ')}`,
            400,
            'PROFESSION_CHECKLIST_INVALID_ASSIGNMENT_STATUS',
            { invalidAssignmentStatuses }
        );
    }

    const search = String(filters.search || '').replace(/\u0000/g, '').trim().slice(0, 120);
    const limit = normalizeDashboardInteger(filters.limit, {
        field: 'limit',
        fallback: 200,
        min: 1,
        max: 500
    });
    const offset = normalizeDashboardInteger(filters.offset, {
        field: 'offset',
        fallback: 0,
        min: 0
    });
    return {
        professionKeys: normalizeStringList(
            filters.professionKeys ?? filters.profession_keys ?? filters.professionKey ?? filters.profession,
            normalizeProfessionKey
        ),
        departments: normalizeStringList(
            filters.departments ?? filters.department,
            value => String(value || '').replace(/\u0000/g, '').trim().slice(0, 80)
        ),
        staffIds: normalizePositiveIntegerList(
            filters.staffIds ?? filters.staff_ids ?? filters.staffId ?? filters.staff,
            'staffId'
        ),
        statuses,
        assignmentStatuses,
        includeInactiveProfessions: normalizeOptionalBoolean(
            filters.includeInactiveProfessions ?? filters.include_inactive_professions,
            false
        ),
        includeInactiveStaff: normalizeOptionalBoolean(
            filters.includeInactiveStaff ?? filters.include_inactive_staff,
            true
        ),
        search,
        searchPattern: search ? `%${search}%` : null,
        limit,
        offset
    };
}

function normalizeProgressAssignments(value) {
    if (!Array.isArray(value)) {
        throw professionChecklistError(
            'Потрібен масив staff/profession assignments',
            400,
            'PROFESSION_CHECKLIST_ASSIGNMENTS_REQUIRED'
        );
    }
    const seen = new Set();
    const result = [];
    for (const assignment of value) {
        const staffId = normalizePositiveInteger(
            assignment?.staffId ?? assignment?.staff_id,
            'staffId'
        );
        const professionKey = normalizeProfessionKey(
            assignment?.professionKey ?? assignment?.profession_key
        );
        if (!professionKey) {
            throw professionChecklistError(
                'У кожному assignment потрібен professionKey',
                400,
                'PROFESSION_CHECKLIST_INVALID_ASSIGNMENT'
            );
        }
        const identity = `${staffId}:${professionKey}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        result.push({ staffId, professionKey, staff_id: staffId, profession_key: professionKey });
    }
    return result;
}

function buildTemplate(profession, items = []) {
    const activeItems = items.filter(item => item.isActive !== false);
    const archivedItems = items.filter(item => item.isActive === false);
    return {
        profession,
        items,
        activeItems,
        archivedItems,
        checklist: activeItems.map(item => item.title),
        counts: {
            total: items.length,
            active: activeItems.length,
            archived: archivedItems.length
        },
        source: 'hr_profession_checklist_items'
    };
}

async function resolveProfession(db, identity, options = {}) {
    assertQueryClient(db);
    const normalized = normalizeProfessionIdentity(identity);
    const lock = options.forUpdate === true ? ' FOR UPDATE' : '';
    const result = normalized.id
        ? await db.query(
            `SELECT id, key, title, department, is_active
             FROM hr_professions
             WHERE id = $1${lock}`,
            [normalized.id]
        )
        : await db.query(
            `SELECT id, key, title, department, is_active
             FROM hr_professions
             WHERE key = $1${lock}`,
            [normalized.key]
        );
    const row = safeRows(result)[0];
    if (!row) {
        throw professionChecklistError(
            'Професію не знайдено',
            404,
            'PROFESSION_CHECKLIST_PROFESSION_NOT_FOUND',
            normalized
        );
    }
    return normalizeProfessionRow(row);
}

async function loadProfessionChecklistTemplates(db, options = {}) {
    assertQueryClient(db);
    const professionIds = normalizePositiveIntegerList(options.professionIds, 'professionId');
    const professionKeys = normalizeStringList(options.professionKeys, normalizeProfessionKey);
    const includeInactiveProfessions = options.includeInactiveProfessions !== false;
    const includeArchivedItems = options.includeArchivedItems === true || options.includeArchived === true;
    const professionResult = await db.query(
        `SELECT id, key, title, department, is_active
         FROM hr_professions
         WHERE ($1::integer[] IS NULL OR id = ANY($1::integer[]))
           AND ($2::text[] IS NULL OR key = ANY($2::text[]))
           AND ($3::boolean OR is_active = true)
         ORDER BY is_active DESC, sort_order, title, id`,
        [professionIds.length ? professionIds : null, professionKeys.length ? professionKeys : null, includeInactiveProfessions]
    );
    const professions = safeRows(professionResult).map(normalizeProfessionRow);
    if (!professions.length) return [];

    const itemResult = await db.query(
        `SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                created_by, updated_by, created_at, updated_at
         FROM hr_profession_checklist_items
         WHERE profession_id = ANY($1::integer[])
           AND ($2::boolean OR is_active = true)
         ORDER BY profession_id, is_active DESC, sort_order, id`,
        [professions.map(profession => profession.id), includeArchivedItems]
    );
    const itemsByProfessionId = new Map();
    for (const row of safeRows(itemResult)) {
        const item = normalizeChecklistItemRow(row);
        if (!itemsByProfessionId.has(item.professionId)) itemsByProfessionId.set(item.professionId, []);
        itemsByProfessionId.get(item.professionId).push(item);
    }
    return professions.map(profession => buildTemplate(
        profession,
        itemsByProfessionId.get(profession.id) || []
    ));
}

async function loadProfessionChecklistTemplate(db, identity, options = {}) {
    const normalized = normalizeProfessionIdentity(identity);
    const templates = await loadProfessionChecklistTemplates(db, {
        professionIds: normalized.id ? [normalized.id] : [],
        professionKeys: normalized.key ? [normalized.key] : [],
        includeInactiveProfessions: options.includeInactiveProfessions !== false,
        includeArchivedItems: options.includeArchivedItems === true || options.includeArchived === true
    });
    if (!templates[0] && options.required !== false) {
        throw professionChecklistError(
            'Професію не знайдено',
            404,
            'PROFESSION_CHECKLIST_PROFESSION_NOT_FOUND',
            normalized
        );
    }
    return templates[0] || null;
}

async function loadProfessionChecklistItems(db, identity, options = {}) {
    const template = await loadProfessionChecklistTemplate(db, identity, options);
    return template?.items || [];
}

async function lockProfessionItems(client, professionId, options = {}) {
    const result = await client.query(
        `SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                created_by, updated_by, created_at, updated_at
         FROM hr_profession_checklist_items
         WHERE profession_id = $1
           AND ($2::boolean OR is_active = true)
         ORDER BY is_active DESC, sort_order, id
         FOR UPDATE`,
        [professionId, options.includeArchived === true]
    );
    return safeRows(result).map(normalizeChecklistItemRow);
}

async function loadLockedChecklistItem(client, professionId, itemKey) {
    const key = normalizeChecklistItemKey(itemKey);
    const result = await client.query(
        `SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                created_by, updated_by, created_at, updated_at
         FROM hr_profession_checklist_items
         WHERE profession_id = $1
           AND item_key = $2
         FOR UPDATE`,
        [professionId, key]
    );
    const row = safeRows(result)[0];
    if (!row) {
        throw professionChecklistError(
            'Пункт чекліста не знайдено',
            404,
            'PROFESSION_CHECKLIST_ITEM_NOT_FOUND',
            { professionId, itemKey: key }
        );
    }
    return normalizeChecklistItemRow(row);
}

async function applyChecklistItemOrder(client, professionId, itemKeys, actor) {
    if (!itemKeys.length) return [];
    const sortOrders = itemKeys.map((unused, index) => (index + 1) * 10);
    const result = await client.query(
        `UPDATE hr_profession_checklist_items item
         SET sort_order = ordering.sort_order,
             updated_by = $4,
             updated_at = NOW()
         FROM unnest($2::text[], $3::integer[]) AS ordering(item_key, sort_order)
         WHERE item.profession_id = $1
           AND item.item_key = ordering.item_key
           AND item.is_active = true
         RETURNING item.id, item.profession_id, item.item_key, item.title, item.sort_order,
                   item.is_active, item.legacy_position, item.created_by, item.updated_by,
                   item.created_at, item.updated_at`,
        [professionId, itemKeys, sortOrders, actor]
    );
    if (Number(result.rowCount) !== itemKeys.length) {
        throw professionChecklistError(
            'Не вдалося застосувати повний порядок пунктів',
            409,
            'PROFESSION_CHECKLIST_REORDER_CONFLICT'
        );
    }
    const byKey = new Map(safeRows(result).map(row => {
        const item = normalizeChecklistItemRow(row);
        return [item.itemKey, item];
    }));
    return itemKeys.map(key => byKey.get(key)).filter(Boolean);
}

async function syncProfessionChecklistCompatibilityMirror(client, identity) {
    assertQueryClient(client, 'transaction client');
    const profession = typeof identity === 'object' && Number.isInteger(Number(identity.id))
        ? { ...identity, id: Number(identity.id) }
        : await resolveProfession(client, identity, { forUpdate: true });
    const result = await client.query(
        `UPDATE hr_professions profession
         SET checklist = COALESCE((
                 SELECT jsonb_agg(item.title ORDER BY item.sort_order, item.id)
                 FROM hr_profession_checklist_items item
                 WHERE item.profession_id = profession.id
                   AND item.is_active = true
             ), '[]'::jsonb),
             updated_at = NOW()
         WHERE profession.id = $1
         RETURNING profession.checklist, profession.updated_at`,
        [profession.id]
    );
    const row = safeRows(result)[0];
    if (!row) {
        throw professionChecklistError(
            'Професію не знайдено під час синхронізації compatibility mirror',
            404,
            'PROFESSION_CHECKLIST_PROFESSION_NOT_FOUND'
        );
    }
    return {
        checklist: Array.isArray(row.checklist) ? row.checklist : [],
        updatedAt: row.updated_at || null
    };
}

async function syncProfessionChecklistTrainingSeed(client, identity) {
    assertQueryClient(client, 'transaction client');
    const profession = typeof identity === 'object' && Number.isInteger(Number(identity.id))
        ? normalizeProfessionRow(identity)
        : await resolveProfession(client, identity, { forUpdate: true });
    const countsResult = await client.query(
        `SELECT COUNT(*)::integer AS total_count,
                COUNT(*) FILTER (WHERE is_active = true)::integer AS active_count
         FROM hr_profession_checklist_items
         WHERE profession_id = $1`,
        [profession.id]
    );
    const counts = safeRows(countsResult)[0] || {};
    const totalCount = Number(counts.total_count) || 0;
    const activeCount = Number(counts.active_count) || 0;
    const courseTitle = `Базове навчання: ${profession.title}`.slice(0, 255);
    const courseDescription = `Керований чекліст готовності для професії «${profession.title}».`;
    const estimatedHours = activeCount > 0 ? Math.max(1, activeCount * 0.5) : 0;
    const courseIsActive = profession.isActive !== false && activeCount > 0;

    let courseResult;
    if (totalCount > 0) {
        courseResult = await client.query(
            `INSERT INTO training_courses
                (title, description, icon, target_roles, lectures_count, estimated_hours,
                 profession_key, source, is_active)
             VALUES ($1, $2, $3, ARRAY[$4]::text[], $5, $6, $4, 'hr_profession_seed', $7)
             ON CONFLICT (profession_key)
                 WHERE source = 'hr_profession_seed' AND profession_key IS NOT NULL
             DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                icon = EXCLUDED.icon,
                target_roles = EXCLUDED.target_roles,
                lectures_count = EXCLUDED.lectures_count,
                estimated_hours = EXCLUDED.estimated_hours,
                is_active = EXCLUDED.is_active
             RETURNING id, title, profession_key, lectures_count, estimated_hours, is_active`,
            [courseTitle, courseDescription, '📚', profession.key, activeCount, estimatedHours, courseIsActive]
        );
    } else {
        courseResult = await client.query(
            `UPDATE training_courses
             SET title = $2,
                 description = $3,
                 target_roles = ARRAY[$1]::text[],
                 lectures_count = 0,
                 estimated_hours = 0,
                 is_active = false
             WHERE source = 'hr_profession_seed'
               AND profession_key = $1
             RETURNING id, title, profession_key, lectures_count, estimated_hours, is_active`,
            [profession.key, courseTitle, courseDescription]
        );
    }

    const course = safeRows(courseResult)[0] || null;
    if (!course) {
        return {
            course: null,
            totalItems: totalCount,
            activeItems: activeCount,
            syncedLectures: 0,
            unpublishedLegacyLectures: 0
        };
    }

    const lectureResult = await client.query(
        `INSERT INTO training_course_lectures
            (course_id, title, description, sort_order, duration_minutes, is_published,
             profession_key, checklist_key, checklist_item, checklist_item_id)
         SELECT $1,
                LEFT(item.title, 255),
                'Практичний пункт керованого чекліста професії.',
                item.sort_order,
                30,
                item.is_active AND $3::boolean,
                $2,
                item.item_key,
                item.title,
                item.id
         FROM hr_profession_checklist_items item
         WHERE item.profession_id = $4
         ON CONFLICT (checklist_item_id)
             WHERE checklist_item_id IS NOT NULL
         DO UPDATE SET
            course_id = EXCLUDED.course_id,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            sort_order = EXCLUDED.sort_order,
            duration_minutes = EXCLUDED.duration_minutes,
            is_published = EXCLUDED.is_published,
            profession_key = EXCLUDED.profession_key,
            checklist_key = EXCLUDED.checklist_key,
            checklist_item = EXCLUDED.checklist_item
         RETURNING id`,
        [course.id, profession.key, profession.isActive !== false, profession.id]
    );
    const legacyResult = await client.query(
        `UPDATE training_course_lectures lecture
         SET is_published = false
         WHERE lecture.course_id = $1
           AND (
               lecture.checklist_item_id IS NULL
               OR NOT EXISTS (
                   SELECT 1
                   FROM hr_profession_checklist_items item
                   WHERE item.id = lecture.checklist_item_id
                     AND item.profession_id = $2
               )
           )`,
        [course.id, profession.id]
    );
    return {
        course: {
            id: Number(course.id),
            title: course.title,
            professionKey: course.profession_key,
            lecturesCount: Number(course.lectures_count) || 0,
            estimatedHours: Number(course.estimated_hours) || 0,
            isActive: course.is_active !== false
        },
        totalItems: totalCount,
        activeItems: activeCount,
        syncedLectures: Number(lectureResult.rowCount) || 0,
        unpublishedLegacyLectures: Number(legacyResult.rowCount) || 0
    };
}

async function syncProfessionChecklistDerivatives(client, profession) {
    const compatibilityMirror = await syncProfessionChecklistCompatibilityMirror(client, profession);
    const trainingSeed = await syncProfessionChecklistTrainingSeed(client, profession);
    return { compatibilityMirror, trainingSeed };
}

async function createProfessionChecklistItem(client, identity, payload = {}, options = {}) {
    assertQueryClient(client, 'transaction client');
    const profession = await resolveProfession(client, identity, { forUpdate: true });
    if (profession.isActive === false && options.allowInactiveProfession !== true) {
        throw professionChecklistError(
            'Не можна додавати пункт до архівної професії',
            409,
            'PROFESSION_CHECKLIST_PROFESSION_ARCHIVED'
        );
    }
    const title = normalizeChecklistItemTitle(payload.title);
    const actor = normalizeChecklistActor(options.actor ?? payload.actor);
    const activeItems = await lockProfessionItems(client, profession.id);
    let position = normalizeChecklistInsertPosition(payload.position ?? payload.index, activeItems.length);
    const beforeItemKey = normalizeChecklistItemKey(
        payload.beforeItemKey ?? payload.before_item_key,
        { allowEmpty: true }
    );
    const afterItemKey = normalizeChecklistItemKey(
        payload.afterItemKey ?? payload.after_item_key,
        { allowEmpty: true }
    );
    if (beforeItemKey && afterItemKey) {
        throw professionChecklistError(
            'Не можна одночасно задавати beforeItemKey та afterItemKey',
            400,
            'PROFESSION_CHECKLIST_INVALID_POSITION'
        );
    }
    if (beforeItemKey || afterItemKey) {
        const referenceIndex = activeItems.findIndex(item => item.itemKey === (beforeItemKey || afterItemKey));
        if (referenceIndex < 0) {
            throw professionChecklistError(
                'Опорний пункт для вставки не знайдено серед активних пунктів',
                409,
                'PROFESSION_CHECKLIST_POSITION_REFERENCE_NOT_FOUND'
            );
        }
        position = beforeItemKey ? referenceIndex : referenceIndex + 1;
    }

    const generatedKey = options.keyGenerator
        ? options.keyGenerator()
        : generateChecklistItemKey(options.entropy);
    const itemKey = normalizeChecklistItemKey(generatedKey);
    const maxSortOrder = activeItems.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    const insertedResult = await client.query(
        `INSERT INTO hr_profession_checklist_items
            (profession_id, item_key, title, sort_order, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, true, $5, $5)
         RETURNING id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                   created_by, updated_by, created_at, updated_at`,
        [profession.id, itemKey, title, maxSortOrder + 10, actor]
    );
    let item = normalizeChecklistItemRow(safeRows(insertedResult)[0]);
    const orderedKeys = activeItems.map(existing => existing.itemKey);
    orderedKeys.splice(position, 0, item.itemKey);
    if (position < activeItems.length) {
        const reordered = await applyChecklistItemOrder(client, profession.id, orderedKeys, actor);
        item = reordered.find(existing => existing.itemKey === item.itemKey) || item;
    }
    const derivatives = await syncProfessionChecklistDerivatives(client, profession);
    return {
        profession,
        item,
        position,
        derivatives,
        audit: { action: 'create', before: null, after: item }
    };
}

async function renameProfessionChecklistItem(client, identity, itemKey, payload = {}, options = {}) {
    assertQueryClient(client, 'transaction client');
    const profession = await resolveProfession(client, identity, { forUpdate: true });
    const current = await loadLockedChecklistItem(client, profession.id, itemKey);
    if (current.isActive === false && options.allowArchived !== true) {
        throw professionChecklistError(
            'Архівний пункт не можна перейменувати',
            409,
            'PROFESSION_CHECKLIST_ITEM_ARCHIVED'
        );
    }
    const title = normalizeChecklistItemTitle(payload.title ?? payload);
    const actor = normalizeChecklistActor(options.actor ?? payload.actor);
    let item = current;
    const changed = current.title !== title;
    if (changed) {
        const result = await client.query(
            `UPDATE hr_profession_checklist_items
             SET title = $3,
                 updated_by = $4,
                 updated_at = NOW()
             WHERE profession_id = $1
               AND item_key = $2
             RETURNING id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                       created_by, updated_by, created_at, updated_at`,
            [profession.id, current.itemKey, title, actor]
        );
        item = normalizeChecklistItemRow(safeRows(result)[0]);
    }
    const derivatives = await syncProfessionChecklistDerivatives(client, profession);
    return {
        profession,
        item,
        changed,
        derivatives,
        audit: { action: 'rename', before: current, after: item }
    };
}

async function reorderProfessionChecklistItems(client, identity, payload, options = {}) {
    assertQueryClient(client, 'transaction client');
    const profession = await resolveProfession(client, identity, { forUpdate: true });
    const requestedKeys = normalizeChecklistReorderKeys(payload);
    const actor = normalizeChecklistActor(options.actor ?? payload?.actor);
    const currentItems = await lockProfessionItems(client, profession.id);
    const currentKeys = currentItems.map(item => item.itemKey);
    const currentKeySet = new Set(currentKeys);
    const missing = currentKeys.filter(key => !requestedKeys.includes(key));
    const unknown = requestedKeys.filter(key => !currentKeySet.has(key));
    if (missing.length || unknown.length || requestedKeys.length !== currentKeys.length) {
        throw professionChecklistError(
            'Новий порядок повинен містити кожен активний пункт рівно один раз',
            409,
            'PROFESSION_CHECKLIST_REORDER_SET_MISMATCH',
            { missing, unknown }
        );
    }
    const changed = requestedKeys.some((key, index) => currentKeys[index] !== key);
    const items = changed
        ? await applyChecklistItemOrder(client, profession.id, requestedKeys, actor)
        : currentItems;
    const derivatives = await syncProfessionChecklistDerivatives(client, profession);
    return {
        profession,
        items,
        changed,
        derivatives,
        audit: {
            action: 'reorder',
            before: currentKeys,
            after: items.map(item => item.itemKey)
        }
    };
}

async function archiveProfessionChecklistItem(client, identity, itemKey, options = {}) {
    assertQueryClient(client, 'transaction client');
    const profession = await resolveProfession(client, identity, { forUpdate: true });
    const current = await loadLockedChecklistItem(client, profession.id, itemKey);
    const impactResult = await client.query(
        `SELECT COUNT(*)::integer AS progress_records,
                COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::integer AS completed_records,
                COUNT(DISTINCT staff_id)::integer AS affected_staff
         FROM hr_staff_profession_checklist_progress
         WHERE checklist_item_id = $1`,
        [current.id]
    );
    const impactRow = safeRows(impactResult)[0] || {};
    const impact = {
        progressRecords: Number(impactRow.progress_records) || 0,
        completedRecords: Number(impactRow.completed_records) || 0,
        affectedStaff: Number(impactRow.affected_staff) || 0
    };
    const actor = normalizeChecklistActor(options.actor);
    let item = current;
    const changed = current.isActive !== false;
    if (changed) {
        const result = await client.query(
            `UPDATE hr_profession_checklist_items
             SET is_active = false,
                 updated_by = $3,
                 updated_at = NOW()
             WHERE profession_id = $1
               AND item_key = $2
             RETURNING id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                       created_by, updated_by, created_at, updated_at`,
            [profession.id, current.itemKey, actor]
        );
        item = normalizeChecklistItemRow(safeRows(result)[0]);
    }
    const derivatives = await syncProfessionChecklistDerivatives(client, profession);
    return {
        profession,
        item,
        impact,
        changed,
        derivatives,
        audit: { action: 'archive', before: current, after: item, impact }
    };
}

async function validateStaffProfessionChecklistTarget(client, params = {}, options = {}) {
    assertQueryClient(client, options.forWrite === true ? 'transaction client' : 'db');
    const staffId = normalizePositiveInteger(params.staffId ?? params.staff_id, 'staffId');
    const professionIdentity = params.professionId || params.profession_id
        ? { id: params.professionId ?? params.profession_id }
        : { key: params.professionKey ?? params.profession_key };
    const forWrite = options.forWrite === true;
    const profession = await resolveProfession(client, professionIdentity, { forUpdate: forWrite });
    if (profession.isActive === false && options.requireActiveProfession !== false) {
        throw professionChecklistError(
            'Професія перебуває в архіві',
            409,
            'PROFESSION_CHECKLIST_PROFESSION_ARCHIVED'
        );
    }

    let item = null;
    const rawItemKey = params.itemKey ?? params.item_key ?? params.checklistKey ?? params.checklist_key;
    if (rawItemKey !== undefined && rawItemKey !== null && rawItemKey !== '') {
        const key = normalizeChecklistItemKey(rawItemKey);
        const itemResult = await client.query(
            `SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                    created_by, updated_by, created_at, updated_at
             FROM hr_profession_checklist_items
             WHERE profession_id = $1
               AND item_key = $2${forWrite ? ' FOR UPDATE' : ''}`,
            [profession.id, key]
        );
        const row = safeRows(itemResult)[0];
        if (!row) {
            throw professionChecklistError(
                'Пункт не належить цій професії або не існує',
                404,
                'PROFESSION_CHECKLIST_ITEM_NOT_FOUND'
            );
        }
        item = normalizeChecklistItemRow(row);
        if (item.isActive === false && options.requireActiveItem !== false) {
            throw professionChecklistError(
                'Архівний пункт не можна змінювати',
                409,
                'PROFESSION_CHECKLIST_ITEM_ARCHIVED'
            );
        }
    }

    const staffResult = await client.query(
        `SELECT id, name, is_active
         FROM staff
         WHERE id = $1${forWrite ? ' FOR UPDATE' : ''}`,
        [staffId]
    );
    const staff = safeRows(staffResult)[0];
    if (!staff) {
        throw professionChecklistError(
            'Працівника не знайдено',
            404,
            'PROFESSION_CHECKLIST_STAFF_NOT_FOUND'
        );
    }
    if (staff.is_active === false && options.requireActiveStaff !== false) {
        throw professionChecklistError(
            'Не можна змінювати прогрес архівного працівника',
            409,
            'PROFESSION_CHECKLIST_STAFF_ARCHIVED'
        );
    }

    const assignmentResult = await client.query(
        `SELECT id, staff_id, profession_key, is_primary, status, admission_status, internship_status
         FROM staff_role_assignments
         WHERE staff_id = $1
           AND profession_key = $2${forWrite ? ' FOR SHARE' : ''}`,
        [staffId, profession.key]
    );
    const assignment = safeRows(assignmentResult)[0] || null;
    if (!assignment && options.requireAssignment !== false) {
        throw professionChecklistError(
            'Професію не призначено працівнику',
            409,
            'PROFESSION_CHECKLIST_PROFESSION_NOT_ASSIGNED'
        );
    }
    if (assignment && assignment.status !== 'active' && options.requireActiveAssignment !== false) {
        throw professionChecklistError(
            'Для зміни прогресу потрібне активне призначення професії',
            409,
            'PROFESSION_CHECKLIST_ASSIGNMENT_INACTIVE'
        );
    }
    return {
        staff: {
            id: Number(staff.id),
            name: staff.name || '',
            isActive: staff.is_active !== false
        },
        profession,
        item,
        assignment: assignment ? {
            id: Number(assignment.id),
            staffId: Number(assignment.staff_id),
            professionKey: assignment.profession_key,
            isPrimary: assignment.is_primary === true,
            status: assignment.status,
            admissionStatus: assignment.admission_status,
            internshipStatus: assignment.internship_status
        } : null
    };
}

async function toggleStaffProfessionChecklistProgress(client, params = {}, options = {}) {
    const completed = normalizeChecklistCompleted(params.completed);
    const notes = normalizeChecklistNotes(params.notes);
    const actor = normalizeChecklistActor(
        options.actor ?? params.actor,
        CHECKLIST_PROGRESS_ACTOR_MAX_LENGTH
    );
    const context = await validateStaffProfessionChecklistTarget(client, params, {
        forWrite: true,
        requireActiveProfession: options.requireActiveProfession !== false,
        requireActiveItem: true,
        requireActiveStaff: options.allowInactiveStaff === true ? false : true,
        requireAssignment: true,
        requireActiveAssignment: options.allowInactiveAssignment === true ? false : true
    });
    if (!context.item) {
        throw professionChecklistError(
            'Потрібен itemKey',
            400,
            'PROFESSION_CHECKLIST_ITEM_REQUIRED'
        );
    }
    const beforeResult = await client.query(
        `SELECT id AS progress_id, staff_id, profession_key,
                checklist_item_id AS progress_checklist_item_id,
                checklist_key AS progress_checklist_key,
                legacy_checklist_key, title AS progress_title, completed_at, completed_by,
                notes, created_at AS progress_created_at, updated_at AS progress_updated_at
         FROM hr_staff_profession_checklist_progress
         WHERE staff_id = $1
           AND checklist_item_id = $2
         FOR UPDATE`,
        [context.staff.id, context.item.id]
    );
    const before = normalizeChecklistProgressRow(safeRows(beforeResult)[0]);
    const result = await client.query(
        `INSERT INTO hr_staff_profession_checklist_progress
            (staff_id, profession_key, checklist_key, checklist_item_id, title,
             completed_at, completed_by, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $6 THEN NOW() ELSE NULL END,
                 CASE WHEN $6 THEN $7 ELSE NULL END,
                 $8,
                 NOW())
         ON CONFLICT (staff_id, checklist_item_id)
             WHERE checklist_item_id IS NOT NULL
         DO UPDATE SET
            profession_key = EXCLUDED.profession_key,
            checklist_key = EXCLUDED.checklist_key,
            title = EXCLUDED.title,
            completed_at = CASE
                WHEN $6 THEN COALESCE(hr_staff_profession_checklist_progress.completed_at, NOW())
                ELSE NULL
            END,
            completed_by = CASE WHEN $6 THEN $7 ELSE NULL END,
            notes = EXCLUDED.notes,
            updated_at = NOW()
         RETURNING id AS progress_id, staff_id, profession_key,
                   checklist_item_id AS progress_checklist_item_id,
                   checklist_key AS progress_checklist_key,
                   legacy_checklist_key, title AS progress_title, completed_at, completed_by,
                   notes, created_at AS progress_created_at, updated_at AS progress_updated_at`,
        [
            context.staff.id,
            context.profession.key,
            context.item.itemKey,
            context.item.id,
            context.item.title,
            completed,
            actor,
            notes
        ]
    );
    const after = normalizeChecklistProgressRow(safeRows(result)[0]);
    return {
        context,
        progress: after,
        before,
        after,
        changed: !before
            || before.completed !== after.completed
            || before.notes !== after.notes
            || before.completedBy !== after.completedBy,
        audit: {
            action: 'toggle_progress',
            staffId: context.staff.id,
            professionKey: context.profession.key,
            itemKey: context.item.itemKey,
            before,
            after
        }
    };
}

function createProgressGroup(assignment) {
    return {
        staffId: assignment.staffId,
        staff_id: assignment.staffId,
        professionKey: assignment.professionKey,
        profession_key: assignment.professionKey,
        profession: null,
        items: [],
        archivedItems: [],
        orphanedProgress: [],
        summary: classifyChecklistProgress(0, 0)
    };
}

function finalizeProgressGroup(group) {
    const completed = group.items.filter(item => item.progress?.completed).length;
    group.summary = classifyChecklistProgress(group.items.length, completed);
    group.hasArchivedProgress = group.archivedItems.some(item => item.progress);
    group.hasOrphanedProgress = group.orphanedProgress.length > 0;
    return group;
}

async function loadProfessionChecklistProgressBatch(db, assignments, options = {}) {
    assertQueryClient(db);
    const normalizedAssignments = normalizeProgressAssignments(assignments);
    if (!normalizedAssignments.length) return { groups: [], byAssignment: {} };
    const includeArchived = options.includeArchived === true;
    const includeOrphaned = options.includeOrphaned !== false;
    const requestedJson = JSON.stringify(normalizedAssignments.map(assignment => ({
        staff_id: assignment.staffId,
        profession_key: assignment.professionKey
    })));
    const canonicalResult = await db.query(
        `WITH requested AS (
             SELECT staff_id, profession_key
             FROM jsonb_to_recordset($1::jsonb) AS request(staff_id integer, profession_key text)
         )
         SELECT requested.staff_id,
                profession.id AS profession_id,
                profession.key AS profession_key,
                profession.title AS profession_title,
                profession.department,
                profession.is_active AS profession_is_active,
                item.id AS item_id,
                item.item_key,
                item.title AS item_title,
                item.sort_order,
                item.is_active AS item_is_active,
                item.legacy_position,
                progress.id AS progress_id,
                progress.checklist_item_id AS progress_checklist_item_id,
                progress.checklist_key AS progress_checklist_key,
                progress.legacy_checklist_key,
                progress.title AS progress_title,
                progress.completed_at,
                progress.completed_by,
                progress.notes,
                progress.created_at AS progress_created_at,
                progress.updated_at AS progress_updated_at
         FROM requested
         JOIN hr_professions profession ON profession.key = requested.profession_key
         JOIN hr_profession_checklist_items item ON item.profession_id = profession.id
         LEFT JOIN hr_staff_profession_checklist_progress progress
           ON progress.staff_id = requested.staff_id
          AND progress.checklist_item_id = item.id
         WHERE ($2::boolean OR item.is_active = true)
         ORDER BY requested.staff_id, profession.key, item.is_active DESC, item.sort_order, item.id`,
        [requestedJson, includeArchived]
    );
    const groupsByIdentity = new Map(normalizedAssignments.map(assignment => [
        `${assignment.staffId}:${assignment.professionKey}`,
        createProgressGroup(assignment)
    ]));
    for (const row of safeRows(canonicalResult)) {
        const identity = `${Number(row.staff_id)}:${normalizeProfessionKey(row.profession_key)}`;
        const group = groupsByIdentity.get(identity);
        if (!group) continue;
        if (!group.profession) group.profession = normalizeProfessionRow(row);
        const item = normalizeChecklistItemRow(row);
        item.progress = normalizeChecklistProgressRow(row);
        item.done = Boolean(item.progress?.completed);
        if (item.isActive === false) group.archivedItems.push(item);
        else group.items.push(item);
    }

    if (includeOrphaned) {
        const orphanResult = await db.query(
            `WITH requested AS (
                 SELECT staff_id, profession_key
                 FROM jsonb_to_recordset($1::jsonb) AS request(staff_id integer, profession_key text)
             )
             SELECT progress.id AS progress_id,
                    progress.staff_id,
                    progress.profession_key,
                    progress.checklist_item_id AS progress_checklist_item_id,
                    progress.checklist_key AS progress_checklist_key,
                    progress.legacy_checklist_key,
                    progress.title AS progress_title,
                    progress.completed_at,
                    progress.completed_by,
                    progress.notes,
                    progress.created_at AS progress_created_at,
                    progress.updated_at AS progress_updated_at,
                    issue.reason AS issue_reason,
                    issue.candidate_item_keys
             FROM requested
             JOIN hr_staff_profession_checklist_progress progress
               ON progress.staff_id = requested.staff_id
              AND progress.profession_key = requested.profession_key
             LEFT JOIN hr_profession_checklist_items item
               ON item.id = progress.checklist_item_id
             LEFT JOIN hr_profession_checklist_migration_issues issue
               ON issue.progress_id = progress.id
              AND issue.resolved_at IS NULL
             LEFT JOIN hr_professions profession
               ON profession.key = progress.profession_key
             WHERE progress.checklist_item_id IS NULL
                OR item.id IS NULL
                OR item.profession_id IS DISTINCT FROM profession.id
             ORDER BY progress.staff_id, progress.profession_key, progress.created_at, progress.id`,
            [requestedJson]
        );
        for (const row of safeRows(orphanResult)) {
            const identity = `${Number(row.staff_id)}:${normalizeProfessionKey(row.profession_key)}`;
            const group = groupsByIdentity.get(identity);
            if (group) group.orphanedProgress.push(normalizeChecklistProgressRow(row));
        }
    }

    const groups = [...groupsByIdentity.values()].map(finalizeProgressGroup);
    return {
        groups,
        byAssignment: Object.fromEntries(groups.map(group => [
            `${group.staffId}:${group.professionKey}`,
            group
        ]))
    };
}

async function loadStaffProfessionChecklistProgress(db, params = {}, options = {}) {
    const context = await validateStaffProfessionChecklistTarget(db, params, {
        forWrite: false,
        requireActiveProfession: options.requireActiveProfession === true,
        requireActiveStaff: options.requireActiveStaff === true,
        requireAssignment: options.requireAssignment !== false,
        requireActiveAssignment: options.requireActiveAssignment === true,
        requireActiveItem: false
    });
    const batch = await loadProfessionChecklistProgressBatch(db, [{
        staffId: context.staff.id,
        professionKey: context.profession.key
    }], {
        includeArchived: options.includeArchived === true,
        includeOrphaned: options.includeOrphaned !== false
    });
    const progress = batch.groups[0] || createProgressGroup({
        staffId: context.staff.id,
        professionKey: context.profession.key
    });
    progress.profession = context.profession;
    return { context, ...finalizeProgressGroup(progress) };
}

function dashboardParams(filters) {
    return [
        filters.professionKeys.length ? filters.professionKeys : null,
        filters.departments.length ? filters.departments : null,
        filters.staffIds.length ? filters.staffIds : null,
        filters.includeInactiveProfessions,
        filters.includeInactiveStaff,
        filters.assignmentStatuses.length ? filters.assignmentStatuses : null,
        filters.searchPattern,
        filters.statuses.length ? filters.statuses : null,
        filters.limit,
        filters.offset
    ];
}

async function loadProfessionChecklistDashboard(db, rawFilters = {}) {
    assertQueryClient(db);
    const filters = normalizeDashboardFilters(rawFilters);
    const params = dashboardParams(filters);
    const professionResult = await db.query(
        `WITH item_counts AS (
             SELECT profession_id,
                    COUNT(*) FILTER (WHERE is_active = true)::integer AS active_items,
                    COUNT(*) FILTER (WHERE is_active = false)::integer AS archived_items
             FROM hr_profession_checklist_items
             GROUP BY profession_id
         ), assignment_counts AS (
             SELECT assignment.profession_key,
                    COUNT(*)::integer AS assigned_staff
             FROM staff_role_assignments assignment
             JOIN staff member ON member.id = assignment.staff_id
             WHERE ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
               AND ($5::boolean OR member.is_active = true)
               AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
             GROUP BY assignment.profession_key
         ), orphan_counts AS (
             SELECT progress.profession_key,
                    COUNT(*)::integer AS orphaned_progress
             FROM hr_staff_profession_checklist_progress progress
             JOIN staff member ON member.id = progress.staff_id
             WHERE progress.checklist_item_id IS NULL
               AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
               AND ($5::boolean OR member.is_active = true)
             GROUP BY progress.profession_key
         )
         SELECT profession.id,
                profession.key,
                profession.title,
                profession.department,
                profession.is_active,
                COALESCE(item_counts.active_items, 0)::integer AS active_items,
                COALESCE(item_counts.archived_items, 0)::integer AS archived_items,
                COALESCE(assignment_counts.assigned_staff, 0)::integer AS assigned_staff,
                COALESCE(orphan_counts.orphaned_progress, 0)::integer AS orphaned_progress
         FROM hr_professions profession
         LEFT JOIN item_counts ON item_counts.profession_id = profession.id
         LEFT JOIN assignment_counts ON assignment_counts.profession_key = profession.key
         LEFT JOIN orphan_counts ON orphan_counts.profession_key = profession.key
         WHERE ($1::text[] IS NULL OR profession.key = ANY($1::text[]))
           AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
           AND ($4::boolean OR profession.is_active = true)
           AND (
               ($3::integer[] IS NULL AND $6::text[] IS NULL)
               OR COALESCE(assignment_counts.assigned_staff, 0) > 0
           )
           AND (
               $7::text IS NULL
               OR profession.key ILIKE $7
               OR profession.title ILIKE $7
               OR COALESCE(profession.department, '') ILIKE $7
               OR EXISTS (
                   SELECT 1
                   FROM staff_role_assignments search_assignment
                   JOIN staff search_member ON search_member.id = search_assignment.staff_id
                   WHERE search_assignment.profession_key = profession.key
                     AND search_member.name ILIKE $7
                     AND ($3::integer[] IS NULL OR search_member.id = ANY($3::integer[]))
                     AND ($5::boolean OR search_member.is_active = true)
                     AND ($6::text[] IS NULL OR search_assignment.status = ANY($6::text[]))
               )
           )
         ORDER BY profession.is_active DESC, profession.sort_order, profession.title, profession.id`,
        params.slice(0, 7)
    );
    const professions = safeRows(professionResult).map(row => ({
        ...normalizeProfessionRow(row),
        activeItems: Number(row.active_items) || 0,
        archivedItems: Number(row.archived_items) || 0,
        assignedStaff: Number(row.assigned_staff) || 0,
        orphanedProgress: Number(row.orphaned_progress) || 0
    }));

    const assignmentClassificationSql = `WITH classified AS (
             SELECT assignment.id AS assignment_id,
                    assignment.staff_id,
                    member.name AS staff_name,
                    member.is_active AS staff_is_active,
                    assignment.status AS assignment_status,
                    assignment.is_primary,
                    assignment.admission_status,
                    assignment.internship_status,
                    profession.id AS profession_id,
                    profession.key AS profession_key,
                    profession.title AS profession_title,
                    profession.department,
                    COUNT(DISTINCT item.id)::integer AS total_items,
                    COUNT(DISTINCT item.id) FILTER (WHERE progress.completed_at IS NOT NULL)::integer AS completed_items
             FROM staff_role_assignments assignment
             JOIN staff member ON member.id = assignment.staff_id
             JOIN hr_professions profession ON profession.key = assignment.profession_key
             LEFT JOIN hr_profession_checklist_items item
               ON item.profession_id = profession.id
              AND item.is_active = true
             LEFT JOIN hr_staff_profession_checklist_progress progress
               ON progress.staff_id = assignment.staff_id
              AND progress.checklist_item_id = item.id
             WHERE ($1::text[] IS NULL OR profession.key = ANY($1::text[]))
               AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
               AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
               AND ($4::boolean OR profession.is_active = true)
               AND ($5::boolean OR member.is_active = true)
               AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
               AND (
                   $7::text IS NULL
                   OR profession.key ILIKE $7
                   OR profession.title ILIKE $7
                   OR COALESCE(profession.department, '') ILIKE $7
                   OR member.name ILIKE $7
               )
             GROUP BY assignment.id, member.id, profession.id
         ), with_status AS (
             SELECT classified.*,
                    CASE
                        WHEN total_items = 0 THEN 'without_template'
                        WHEN completed_items >= total_items THEN 'completed'
                        WHEN completed_items > 0 THEN 'in_progress'
                        ELSE 'not_started'
                    END AS checklist_status
             FROM classified
         )`;
    const [assignmentResult, assignmentSummaryResult] = await Promise.all([
        db.query(
            `${assignmentClassificationSql}
         SELECT with_status.*
         FROM with_status
         WHERE ($8::text[] IS NULL OR checklist_status = ANY($8::text[]))
         ORDER BY profession_title, staff_name, staff_id
         LIMIT $9 OFFSET $10`,
            params
        ),
        db.query(
            `${assignmentClassificationSql}
         SELECT COUNT(*)::integer AS filtered_total,
                 COUNT(*) FILTER (
                     WHERE $8::text[] IS NULL OR checklist_status = ANY($8::text[])
                 )::integer AS selected_total,
                 COUNT(*) FILTER (WHERE checklist_status = 'without_template')::integer AS without_template_total,
                COUNT(*) FILTER (WHERE checklist_status = 'not_started')::integer AS not_started_total,
                COUNT(*) FILTER (WHERE checklist_status = 'in_progress')::integer AS in_progress_total,
                COUNT(*) FILTER (WHERE checklist_status = 'completed')::integer AS completed_total
         FROM with_status`,
            params.slice(0, 8)
        )
    ]);
    const assignmentRows = safeRows(assignmentResult);
    const assignments = assignmentRows.map(row => ({
        assignmentId: Number(row.assignment_id),
        staffId: Number(row.staff_id),
        staffName: row.staff_name || '',
        staffIsActive: row.staff_is_active !== false,
        assignmentStatus: row.assignment_status,
        isPrimary: row.is_primary === true,
        admissionStatus: row.admission_status,
        internshipStatus: row.internship_status,
        professionId: Number(row.profession_id),
        professionKey: row.profession_key,
        professionTitle: row.profession_title,
        department: row.department || '',
        status: row.checklist_status,
        ...classifyChecklistProgress(row.total_items, row.completed_items)
    }));

    const wantsArchived = !filters.statuses.length || filters.statuses.includes('archived');
    const archivedResult = wantsArchived
        ? await db.query(
            `SELECT progress.id AS progress_id,
                    progress.staff_id,
                    member.name AS staff_name,
                    member.is_active AS staff_is_active,
                    progress.profession_key,
                    profession.title AS profession_title,
                    profession.department,
                    progress.checklist_item_id AS progress_checklist_item_id,
                    progress.checklist_key AS progress_checklist_key,
                    progress.legacy_checklist_key,
                    progress.title AS progress_title,
                    progress.completed_at,
                    progress.completed_by,
                    progress.notes,
                    progress.created_at AS progress_created_at,
                    progress.updated_at AS progress_updated_at,
                    item.item_key,
                    item.title AS item_title,
                    COUNT(*) OVER()::integer AS filtered_total
             FROM hr_staff_profession_checklist_progress progress
             JOIN hr_profession_checklist_items item
               ON item.id = progress.checklist_item_id
              AND item.is_active = false
             JOIN hr_professions profession ON profession.id = item.profession_id
             JOIN staff member ON member.id = progress.staff_id
             LEFT JOIN staff_role_assignments assignment
               ON assignment.staff_id = progress.staff_id
              AND assignment.profession_key = profession.key
             WHERE ($1::text[] IS NULL OR profession.key = ANY($1::text[]))
               AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
               AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
               AND ($4::boolean OR profession.is_active = true)
               AND ($5::boolean OR member.is_active = true)
               AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
               AND ($8::text[] IS NULL OR 'archived' = ANY($8::text[]))
               AND (
                   $7::text IS NULL
                   OR profession.key ILIKE $7
                   OR profession.title ILIKE $7
                   OR member.name ILIKE $7
                   OR item.title ILIKE $7
               )
             ORDER BY progress.updated_at DESC, progress.id DESC
             LIMIT $9 OFFSET $10`,
            params
        )
        : { rows: [] };
    const archivedRows = safeRows(archivedResult);
    const archived = archivedRows.map(row => ({
        status: 'archived',
        staffName: row.staff_name || '',
        staffIsActive: row.staff_is_active !== false,
        professionTitle: row.profession_title || row.profession_key,
        department: row.department || '',
        itemKey: row.item_key,
        itemTitle: row.item_title,
        progress: normalizeChecklistProgressRow(row)
    }));
    const archivedCountResult = await db.query(
        `SELECT COUNT(*)::integer AS filtered_total
         FROM hr_staff_profession_checklist_progress progress
         JOIN hr_profession_checklist_items item
           ON item.id = progress.checklist_item_id
          AND item.is_active = false
         JOIN hr_professions profession ON profession.id = item.profession_id
         JOIN staff member ON member.id = progress.staff_id
         LEFT JOIN staff_role_assignments assignment
           ON assignment.staff_id = progress.staff_id
          AND assignment.profession_key = profession.key
         WHERE ($1::text[] IS NULL OR profession.key = ANY($1::text[]))
           AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
           AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
           AND ($4::boolean OR profession.is_active = true)
           AND ($5::boolean OR member.is_active = true)
           AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
           AND (
               $7::text IS NULL
               OR profession.key ILIKE $7
               OR profession.title ILIKE $7
               OR member.name ILIKE $7
               OR item.title ILIKE $7
           )`,
        params.slice(0, 7)
    );

    const wantsOrphaned = !filters.statuses.length || filters.statuses.includes('orphaned');
    const orphanedResult = wantsOrphaned
        ? await db.query(
            `SELECT progress.id AS progress_id,
                    progress.staff_id,
                    member.name AS staff_name,
                    member.is_active AS staff_is_active,
                    progress.profession_key,
                    profession.title AS profession_title,
                    profession.department,
                    progress.checklist_item_id AS progress_checklist_item_id,
                    progress.checklist_key AS progress_checklist_key,
                    progress.legacy_checklist_key,
                    progress.title AS progress_title,
                    progress.completed_at,
                    progress.completed_by,
                    progress.notes,
                    progress.created_at AS progress_created_at,
                    progress.updated_at AS progress_updated_at,
                    issue.reason AS issue_reason,
                    issue.candidate_item_keys,
                    COUNT(*) OVER()::integer AS filtered_total
             FROM hr_staff_profession_checklist_progress progress
             JOIN staff member ON member.id = progress.staff_id
             LEFT JOIN hr_professions profession ON profession.key = progress.profession_key
             LEFT JOIN hr_profession_checklist_items item ON item.id = progress.checklist_item_id
             LEFT JOIN staff_role_assignments assignment
               ON assignment.staff_id = progress.staff_id
              AND assignment.profession_key = progress.profession_key
             LEFT JOIN hr_profession_checklist_migration_issues issue
               ON issue.progress_id = progress.id
              AND issue.resolved_at IS NULL
             WHERE (
                   progress.checklist_item_id IS NULL
                   OR item.id IS NULL
                   OR item.profession_id IS DISTINCT FROM profession.id
               )
               AND ($1::text[] IS NULL OR progress.profession_key = ANY($1::text[]))
               AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
               AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
               AND ($4::boolean OR profession.id IS NULL OR profession.is_active = true)
               AND ($5::boolean OR member.is_active = true)
               AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
               AND ($8::text[] IS NULL OR 'orphaned' = ANY($8::text[]))
               AND (
                   $7::text IS NULL
                   OR progress.profession_key ILIKE $7
                   OR COALESCE(profession.title, '') ILIKE $7
                   OR member.name ILIKE $7
                   OR progress.title ILIKE $7
               )
             ORDER BY progress.updated_at DESC, progress.id DESC
             LIMIT $9 OFFSET $10`,
            params
        )
        : { rows: [] };
    const orphanedRows = safeRows(orphanedResult);
    const orphaned = orphanedRows.map(row => ({
        status: 'orphaned',
        staffName: row.staff_name || '',
        staffIsActive: row.staff_is_active !== false,
        professionTitle: row.profession_title || row.profession_key,
        department: row.department || '',
        progress: normalizeChecklistProgressRow(row)
    }));
    const orphanedCountResult = await db.query(
        `SELECT COUNT(*)::integer AS filtered_total
         FROM hr_staff_profession_checklist_progress progress
         JOIN staff member ON member.id = progress.staff_id
         LEFT JOIN hr_professions profession ON profession.key = progress.profession_key
         LEFT JOIN hr_profession_checklist_items item ON item.id = progress.checklist_item_id
         LEFT JOIN staff_role_assignments assignment
           ON assignment.staff_id = progress.staff_id
          AND assignment.profession_key = progress.profession_key
         LEFT JOIN hr_profession_checklist_migration_issues issue
           ON issue.progress_id = progress.id
          AND issue.resolved_at IS NULL
         WHERE (
               progress.checklist_item_id IS NULL
               OR item.id IS NULL
               OR item.profession_id IS DISTINCT FROM profession.id
           )
           AND ($1::text[] IS NULL OR progress.profession_key = ANY($1::text[]))
           AND ($2::text[] IS NULL OR profession.department = ANY($2::text[]))
           AND ($3::integer[] IS NULL OR member.id = ANY($3::integer[]))
           AND ($4::boolean OR profession.id IS NULL OR profession.is_active = true)
           AND ($5::boolean OR member.is_active = true)
           AND ($6::text[] IS NULL OR assignment.status = ANY($6::text[]))
           AND (
               $7::text IS NULL
               OR progress.profession_key ILIKE $7
               OR COALESCE(profession.title, '') ILIKE $7
               OR member.name ILIKE $7
               OR progress.title ILIKE $7
           )`,
        params.slice(0, 7)
    );

    const statusFilterAllowsWithoutTemplate = !filters.statuses.length
        || filters.statuses.includes('without_template');
    const allProfessionsWithoutTemplate = professions.filter(profession => profession.activeItems === 0);
    const professionsWithoutTemplate = statusFilterAllowsWithoutTemplate
        ? allProfessionsWithoutTemplate
        : [];
    const assignmentCountRow = safeRows(assignmentSummaryResult)[0] || {};
    const archivedTotal = Number(safeRows(archivedCountResult)[0]?.filtered_total) || 0;
    const orphanedTotal = Number(safeRows(orphanedCountResult)[0]?.filtered_total) || 0;
    return {
        filters,
        summary: {
            without_template: allProfessionsWithoutTemplate.length,
            not_started: Number(assignmentCountRow.not_started_total) || 0,
            in_progress: Number(assignmentCountRow.in_progress_total) || 0,
            completed: Number(assignmentCountRow.completed_total) || 0,
            archived: archivedTotal,
            orphaned: orphanedTotal
        },
        metrics: {
            professions: professions.length,
            activeTemplateItems: professions.reduce((sum, profession) => sum + profession.activeItems, 0),
            archivedTemplateItems: professions.reduce((sum, profession) => sum + profession.archivedItems, 0),
            filteredAssignments: Number(assignmentCountRow.filtered_total) || 0,
            assignmentsWithoutTemplate: Number(assignmentCountRow.without_template_total) || 0
        },
        professions,
        professionsWithoutTemplate,
        assignments,
        archived,
        orphaned,
        pagination: {
            semantics: 'independent_feeds',
            assignments: {
                limit: filters.limit,
                offset: filters.offset,
                total: Number(assignmentCountRow.selected_total) || 0,
                returned: assignments.length
            },
            archived: {
                limit: filters.limit,
                offset: filters.offset,
                total: archivedTotal,
                returned: archived.length
            },
            orphaned: {
                limit: filters.limit,
                offset: filters.offset,
                total: orphanedTotal,
                returned: orphaned.length
            }
        }
    };
}

module.exports = {
    CHECKLIST_DASHBOARD_STATUSES,
    CHECKLIST_ITEM_KEY_PATTERN,
    CHECKLIST_ITEM_TITLE_MAX_LENGTH,
    CHECKLIST_NOTES_MAX_LENGTH,
    ProfessionChecklistError,
    professionChecklistError,
    isProfessionChecklistError,
    normalizeProfessionKey,
    normalizeProfessionIdentity,
    normalizeChecklistItemKey,
    normalizeChecklistItemTitle,
    normalizeChecklistNotes,
    normalizeChecklistActor,
    normalizeChecklistCompleted,
    normalizeChecklistReorderKeys,
    normalizeChecklistInsertPosition,
    normalizeChecklistItemRow,
    normalizeChecklistProgressRow,
    normalizeDashboardFilters,
    normalizeProgressAssignments,
    classifyChecklistProgress,
    generateChecklistItemKey,
    generateProfessionChecklistItemKey: generateChecklistItemKey,
    resolveProfession,
    loadProfessionChecklistTemplates,
    listProfessionChecklistTemplates: loadProfessionChecklistTemplates,
    loadProfessionChecklistTemplate,
    loadProfessionChecklistItems,
    listProfessionChecklistItems: loadProfessionChecklistItems,
    createProfessionChecklistItem,
    renameProfessionChecklistItem,
    reorderProfessionChecklistItems,
    archiveProfessionChecklistItem,
    syncProfessionChecklistCompatibilityMirror,
    syncProfessionChecklistTrainingSeed,
    syncProfessionChecklistDerivatives,
    validateStaffProfessionChecklistTarget,
    toggleStaffProfessionChecklistProgress,
    toggleProfessionChecklistProgress: toggleStaffProfessionChecklistProgress,
    loadProfessionChecklistProgressBatch,
    loadChecklistProgressBatch: loadProfessionChecklistProgressBatch,
    loadStaffProfessionChecklistProgress,
    loadProfessionChecklistDashboard
};
