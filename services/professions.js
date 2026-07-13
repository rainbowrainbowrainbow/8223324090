'use strict';

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Array.isArray(value.items) ? value.items : fallback;
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch {
            return fallback;
        }
    }
    return trimmed
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function normalizeRequestedProfessionKey(value) {
    const canonicalInput = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
    const normalized = normalizeProfessionKey(value);
    return normalized && normalized === canonicalInput ? normalized : '';
}

function normalizeProfessionKeyArray(value, options = {}) {
    const exclude = new Set((options.exclude || []).map(normalizeProfessionKey).filter(Boolean));
    const seen = new Set();
    const result = [];
    for (const item of parseJsonArray(value, [])) {
        const key = normalizeProfessionKey(item);
        if (!key || exclude.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(key);
    }
    return result;
}

function normalizeSecondaryProfessions(value, primaryKey = '') {
    return normalizeProfessionKeyArray(value, { exclude: [primaryKey] });
}

const HIDDEN_PROFESSION_KEYS = new Set([
    'bartender',
    'hr_manager',
    'instructor',
    'head_cook',
    'head_chef',
    'cleaning',
    'technician'
]);

function isHiddenProfessionKey(value) {
    return HIDDEN_PROFESSION_KEYS.has(normalizeProfessionKey(value));
}

const PROFESSION_OVERRIDES = Object.freeze({
    senior_instructor: Object.freeze({
        title: 'Адміністратор ігрових зон',
        department: 'Ігрові зони',
        short_info: 'Адмініструє ігрові зони, безпеку, порядок і операційне закриття зміни.'
    }),
    maintenance: Object.freeze({
        title: 'Технічний директор',
        department: 'Техніка',
        short_info: 'Відповідає за технічну готовність простору, обладнання, ремонти і критичні технічні рішення.'
    })
});

const VIRTUAL_PROFESSIONS = Object.freeze([
    Object.freeze({
        id: -7001,
        key: 'pizzaiolo',
        title: 'Піцайоло',
        department: 'Кухня',
        short_info: 'Готує піцу, контролює заготовки, випікання і якість видачі.',
        responsibilities: ['Готує піцу', 'Контролює заготовки', 'Тримає стандарт видачі'],
        checklist: ['Перевірити тісто та начинки', 'Підготувати робочу зону', 'Оновити потреби закупівель'],
        color: '#f97316',
        sort_order: 143,
        is_active: true,
        is_virtual: true
    })
]);

function staffProfessionKeys(staff = {}) {
    return normalizeProfessionKeyArray([
        staff.role_type,
        ...parseJsonArray(staff.secondary_professions ?? staff.secondaryProfessions, [])
    ]);
}

function staffHasProfession(staff = {}, professionKey = '') {
    const key = normalizeProfessionKey(professionKey);
    if (!key) return false;
    return staffProfessionKeys(staff).includes(key);
}

function validateStaffProfessionAssignments(staff = {}, requestedProfessionKeys = []) {
    const allowedProfessionKeys = staffProfessionKeys(staff);
    const allowedSet = new Set(allowedProfessionKeys);
    const professionKeys = [];
    const malformedProfessionKeys = [];
    const seen = new Set();
    for (const rawKey of parseJsonArray(requestedProfessionKeys, [])) {
        const key = normalizeRequestedProfessionKey(rawKey);
        if (!key) {
            malformedProfessionKeys.push(String(rawKey ?? ''));
        } else if (!seen.has(key)) {
            seen.add(key);
            professionKeys.push(key);
        }
    }
    const invalidProfessionKeys = [
        ...professionKeys.filter(key => !allowedSet.has(key)),
        ...malformedProfessionKeys
    ];
    return {
        ok: invalidProfessionKeys.length === 0,
        professionKeys,
        allowedProfessionKeys,
        invalidProfessionKeys,
        malformedProfessionKeys
    };
}

async function loadStaffProfessionCard(db, staffId, options = {}) {
    const id = Number(staffId);
    if (!Number.isFinite(id) || id <= 0) {
        return { ok: false, status: 400, error: 'Потрібен коректний staffId' };
    }
    const result = await db.query(
        `SELECT id, name, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions, is_active
         FROM staff
         WHERE id = $1
         ${options.forShare === true ? 'FOR SHARE' : ''}`,
        [id]
    );
    const staff = result.rows[0];
    if (!staff) return { ok: false, status: 404, error: 'Співробітника не знайдено' };
    return { ok: true, staff };
}

async function resolveStaffProfessionAssignments(db, staffId, requestedProfessionKeys = [], options = {}) {
    const card = await loadStaffProfessionCard(db, staffId, options);
    if (!card.ok) return card;
    const { staff } = card;
    if (options.requireActive !== false && staff.is_active === false) {
        return { ok: false, status: 400, error: 'Співробітник неактивний', staff };
    }
    const validation = validateStaffProfessionAssignments(staff, requestedProfessionKeys);
    if (!validation.ok) {
        return {
            ok: false,
            status: 400,
            error: `Не можна поставити ${staff.name || 'співробітника'} на професії, яких немає в HR-картці: ${validation.invalidProfessionKeys.join(', ')}`,
            staff,
            ...validation
        };
    }
    return { ok: true, staff, ...validation };
}

async function resolveStaffProfessionAssignment(db, staffId, requestedProfessionKey = '', options = {}) {
    const card = await loadStaffProfessionCard(db, staffId, options);
    if (!card.ok) return card;
    const { staff } = card;
    if (options.requireActive !== false && staff.is_active === false) {
        return { ok: false, status: 400, error: 'Співробітник неактивний' };
    }
    const professionKey = normalizeProfessionKey(requestedProfessionKey) || normalizeProfessionKey(staff.role_type);
    if (!professionKey) {
        return { ok: false, status: 400, error: 'У співробітника не задана професія для графіка' };
    }
    if (!staffHasProfession(staff, professionKey)) {
        return {
            ok: false,
            status: 400,
            error: `Не можна поставити ${staff.name || 'співробітника'} в графік на професію "${professionKey}", бо її немає в основних або додаткових професіях`
        };
    }
    return { ok: true, staff, professionKey };
}

function parseTextList(value, limit = 24) {
    return parseJsonArray(value, [])
        .map(item => String(item || '').replace(/\u0000/g, '').trim())
        .filter(Boolean)
        .slice(0, limit);
}

function normalizeProfessionCatalogRow(row = {}) {
    return {
        id: row.id,
        key: normalizeProfessionKey(row.key),
        title: row.title || row.key || '',
        department: row.department || '',
        short_info: row.short_info || row.shortInfo || '',
        shortInfo: row.short_info || row.shortInfo || '',
        responsibilities: parseTextList(row.responsibilities, 16),
        checklist: parseTextList(row.checklist, 24),
        structure_node_id: row.structure_node_id || row.structureNodeId || null,
        structureNodeId: row.structure_node_id || row.structureNodeId || null,
        color: row.color || null,
        sort_order: Number(row.sort_order ?? row.sortOrder ?? 100),
        sortOrder: Number(row.sort_order ?? row.sortOrder ?? 100),
        is_active: row.is_active !== false,
        isActive: row.is_active !== false,
        is_virtual: row.is_virtual === true || row.isVirtual === true,
        isVirtual: row.is_virtual === true || row.isVirtual === true
    };
}

function curateProfessionCatalogRow(row = {}) {
    const normalized = normalizeProfessionCatalogRow(row);
    if (!normalized.key || isHiddenProfessionKey(normalized.key)) return null;
    const override = PROFESSION_OVERRIDES[normalized.key];
    if (!override) return normalized;
    return normalizeProfessionCatalogRow({
        ...normalized,
        ...override,
        shortInfo: override.short_info ?? override.shortInfo ?? normalized.shortInfo
    });
}

function compareProfessionCatalogRows(a, b) {
    const activeDelta = Number(b.is_active !== false) - Number(a.is_active !== false);
    if (activeDelta) return activeDelta;
    return (Number(a.sort_order) || 100) - (Number(b.sort_order) || 100)
        || String(a.title || '').localeCompare(String(b.title || ''), 'uk')
        || String(a.key || '').localeCompare(String(b.key || ''), 'uk');
}

function curateProfessionCatalogRows(rows = []) {
    const byKey = new Map();
    for (const row of rows || []) {
        const curated = curateProfessionCatalogRow(row);
        if (!curated?.key) continue;
        const existing = byKey.get(curated.key);
        if (!existing || compareProfessionCatalogRows(curated, existing) < 0) {
            byKey.set(curated.key, curated);
        }
    }
    for (const virtualRow of VIRTUAL_PROFESSIONS) {
        const curated = curateProfessionCatalogRow(virtualRow);
        if (curated?.key && !byKey.has(curated.key)) byKey.set(curated.key, curated);
    }
    return [...byKey.values()].sort(compareProfessionCatalogRows);
}

function professionCatalogActiveKeySet(rows = []) {
    return new Set(
        curateProfessionCatalogRows(rows)
            .filter(row => row.is_active !== false)
            .map(row => normalizeProfessionKey(row.key))
            .filter(Boolean)
    );
}

function validateProfessionKeys(keys, activeKeys) {
    const keySet = activeKeys instanceof Set ? activeKeys : new Set(activeKeys || []);
    return (keys || []).filter(key => !keySet.has(key));
}

module.exports = {
    parseJsonArray,
    parseTextList,
    normalizeProfessionKey,
    normalizeRequestedProfessionKey,
    normalizeProfessionKeyArray,
    normalizeSecondaryProfessions,
    isHiddenProfessionKey,
    staffProfessionKeys,
    staffHasProfession,
    validateStaffProfessionAssignments,
    resolveStaffProfessionAssignments,
    resolveStaffProfessionAssignment,
    normalizeProfessionCatalogRow,
    curateProfessionCatalogRows,
    professionCatalogActiveKeySet,
    validateProfessionKeys
};
