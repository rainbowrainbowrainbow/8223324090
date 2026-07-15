'use strict';

const { normalizeStaffCompanyStructurePayload } = require('./staffDisplayGroups');

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
    const source = row.source === 'system' || row.is_virtual === true || row.isVirtual === true ? 'system' : 'db';
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
        isVirtual: row.is_virtual === true || row.isVirtual === true,
        source,
        is_readonly: source === 'system' || row.is_readonly === true || row.isReadonly === true,
        isReadonly: source === 'system' || row.is_readonly === true || row.isReadonly === true
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

async function loadAssignedStaffProfessionKeys(db, staff = {}) {
    const keys = staffProfessionKeys(staff);
    const staffId = Number(staff.id ?? staff.staff_id);
    if (!db || typeof db.query !== 'function' || !Number.isInteger(staffId) || staffId <= 0) return keys;
    const result = await db.query(
        `SELECT profession_key
         FROM staff_role_assignments
         WHERE staff_id = $1
         ORDER BY is_primary DESC, profession_key`,
        [staffId]
    );
    return normalizeProfessionKeyArray([
        ...keys,
        ...safeRows(result).map(row => row.profession_key)
    ]);
}

function professionCatalogInventory() {
    return {
        dbSource: 'hr_professions',
        virtual: VIRTUAL_PROFESSIONS.map(row => normalizeProfessionKey(row.key)).filter(Boolean),
        overrides: Object.keys(PROFESSION_OVERRIDES),
        hiddenLegacyDuplicates: [...HIDDEN_PROFESSION_KEYS]
    };
}

function professionWorkspaceIdentityMatches(profession = {}, identity = {}) {
    const requestedId = Number(identity.id ?? identity);
    const requestedKey = normalizeProfessionKey(identity.key ?? (Number.isFinite(requestedId) ? '' : identity));
    if (Number.isFinite(requestedId) && requestedId !== 0 && Number(profession.id) === requestedId) return true;
    return Boolean(requestedKey && normalizeProfessionKey(profession.key) === requestedKey);
}

function safeRows(result) {
    return Array.isArray(result?.rows) ? result.rows : [];
}

async function loadProfessionWorkspaceCatalog(db) {
    if (!db || typeof db.query !== 'function') throw new TypeError('Profession workspace requires a database client');
    const [professionResult, peopleResult, preferenceResult, progressResult, trainingResult, structureResult] = await Promise.all([
        db.query(
            `SELECT id, key, title, department, short_info, responsibilities, checklist,
                    color, structure_node_id, sort_order, is_active, created_at, updated_at
             FROM hr_professions
             ORDER BY is_active DESC, sort_order ASC, title ASC`
        ),
        db.query(
            `WITH profession_assignments AS (
                SELECT s.id AS staff_id, s.role_type AS profession_key, true AS is_primary
                FROM staff s
                WHERE NULLIF(BTRIM(s.role_type), '') IS NOT NULL
                UNION
                SELECT s.id AS staff_id, secondary.value AS profession_key, false AS is_primary
                FROM staff s
                CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.secondary_professions, '[]'::jsonb)) secondary(value)
                UNION
                SELECT sra.staff_id, sra.profession_key, COALESCE(sra.is_primary, false) AS is_primary
                FROM staff_role_assignments sra
             )
             SELECT DISTINCT ON (pa.profession_key, s.id)
                    pa.profession_key, s.id AS staff_id, s.name AS staff_name, s.department,
                    COALESCE(s.is_active, true) AS is_active, pa.is_primary,
                    spr.hourly_rate AS explicit_hourly_rate,
                    s.hourly_rate AS fallback_hourly_rate,
                    COALESCE(s.rate_unit, 'hour') AS rate_unit,
                    COALESCE(sra.status, CASE WHEN COALESCE(s.is_active, true) THEN 'active' ELSE 'inactive' END) AS assignment_status,
                    COALESCE(sra.admission_status, CASE WHEN pa.profession_key = s.role_type THEN 'approved' ELSE 'pending' END) AS admission_status,
                    COALESCE(sra.internship_status, CASE WHEN pa.profession_key = 'intern' THEN 'in_progress' ELSE 'none' END) AS internship_status,
                    s.company_structure_node_id
             FROM profession_assignments pa
             JOIN staff s ON s.id = pa.staff_id
             LEFT JOIN staff_profession_rates spr
                    ON spr.staff_id = s.id AND spr.profession_key = pa.profession_key
             LEFT JOIN staff_role_assignments sra
                    ON sra.staff_id = s.id AND sra.profession_key = pa.profession_key
             ORDER BY pa.profession_key, s.id, pa.is_primary DESC`
        ),
        db.query(
            `SELECT staff_id, profession_key, day_type, start_time, end_time
             FROM staff_shift_preferences
             WHERE COALESCE(is_active, true) = true
             ORDER BY profession_key, staff_id, day_type`
        ),
        db.query(
            `SELECT profession_key,
                    COUNT(*)::int AS progress_records,
                    COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed_records,
                    COUNT(DISTINCT staff_id)::int AS staff_with_progress
             FROM hr_staff_profession_checklist_progress
             GROUP BY profession_key`
        ),
        db.query(
            `SELECT profession_key,
                    COUNT(*)::int AS course_count,
                    COUNT(*) FILTER (WHERE COALESCE(is_active, true) = true)::int AS active_course_count
             FROM training_courses
             WHERE profession_key IS NOT NULL
             GROUP BY profession_key`
        ),
        db.query("SELECT value FROM settings WHERE key = 'hr_company_structure'")
    ]);

    const preferencesByAssignment = new Map();
    for (const row of safeRows(preferenceResult)) {
        const assignmentKey = `${Number(row.staff_id)}:${normalizeProfessionKey(row.profession_key)}`;
        if (!preferencesByAssignment.has(assignmentKey)) preferencesByAssignment.set(assignmentKey, []);
        preferencesByAssignment.get(assignmentKey).push({
            dayType: row.day_type || 'weekday',
            startTime: row.start_time || null,
            endTime: row.end_time || null,
            isActive: true,
            source: 'staff_shift_preferences'
        });
    }

    const peopleByKey = new Map();
    for (const row of safeRows(peopleResult)) {
        const key = normalizeProfessionKey(row.profession_key);
        if (!key) continue;
        if (!peopleByKey.has(key)) peopleByKey.set(key, []);
        peopleByKey.get(key).push({
            id: Number(row.staff_id),
            name: row.staff_name || '',
            department: row.department || '',
            isActive: row.is_active !== false,
            isPrimary: row.is_primary === true,
            assignmentStatus: row.assignment_status || 'active',
            admissionStatus: row.admission_status || 'pending',
            internshipStatus: row.internship_status || 'none',
            rateMode: row.explicit_hourly_rate == null ? 'fallback' : 'explicit',
            explicitRate: row.explicit_hourly_rate == null ? null : Number(row.explicit_hourly_rate),
            fallbackRate: row.fallback_hourly_rate == null ? null : Number(row.fallback_hourly_rate),
            hourlyRate: row.explicit_hourly_rate == null
                ? (row.fallback_hourly_rate == null ? null : Number(row.fallback_hourly_rate))
                : Number(row.explicit_hourly_rate),
            rateSource: row.explicit_hourly_rate == null ? 'staff.hourly_rate' : 'staff_profession_rates.hourly_rate',
            rateUnit: row.rate_unit || 'hour',
            structureNodeId: row.company_structure_node_id || null,
            shiftPreferences: preferencesByAssignment.get(`${Number(row.staff_id)}:${key}`) || []
        });
    }
    peopleByKey.forEach(rows => rows.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'uk')));

    const progressByKey = new Map(safeRows(progressResult).map(row => [normalizeProfessionKey(row.profession_key), {
        records: Number(row.progress_records || 0),
        completed: Number(row.completed_records || 0),
        staffWithProgress: Number(row.staff_with_progress || 0)
    }]));
    const trainingByKey = new Map(safeRows(trainingResult).map(row => [normalizeProfessionKey(row.profession_key), {
        courses: Number(row.course_count || 0),
        activeCourses: Number(row.active_course_count || 0)
    }]));
    const structure = normalizeStaffCompanyStructurePayload(safeRows(structureResult)[0]?.value || {});
    const structureNodeById = new Map(structure.nodes.map(node => [node.id, node]));

    const items = curateProfessionCatalogRows(safeRows(professionResult)).map(profession => {
        const key = normalizeProfessionKey(profession.key);
        const people = peopleByKey.get(key) || [];
        const structureNode = profession.structureNodeId ? structureNodeById.get(profession.structureNodeId) || null : null;
        const checklist = Array.isArray(profession.checklist) ? profession.checklist : [];
        return {
            ...profession,
            source: profession.source || (profession.isVirtual ? 'system' : 'db'),
            isReadonly: profession.isReadonly === true || profession.isVirtual === true,
            is_readonly: profession.isReadonly === true || profession.isVirtual === true,
            staffCount: people.length,
            activeStaffCount: people.filter(person => person.isActive).length,
            hasChecklist: checklist.length > 0,
            checklistCount: checklist.length,
            structureNode: structureNode ? { id: structureNode.id, title: structureNode.title } : null,
            people,
            checklistProgress: progressByKey.get(key) || { records: 0, completed: 0, staffWithProgress: 0 },
            trainingUsage: trainingByKey.get(key) || { courses: 0, activeCourses: 0 }
        };
    });

    return {
        items,
        structureNodes: structure.nodes.map(node => ({ id: node.id, title: node.title })),
        inventory: professionCatalogInventory()
    };
}

async function loadProfessionWorkspace(db, identity = {}) {
    const catalog = await loadProfessionWorkspaceCatalog(db);
    const profession = catalog.items.find(item => professionWorkspaceIdentityMatches(item, identity));
    if (!profession) return null;
    return {
        profession,
        people: profession.people,
        checklist: profession.checklist,
        checklistProgress: profession.checklistProgress,
        trainingUsage: profession.trainingUsage,
        structureNode: profession.structureNode,
        inventory: catalog.inventory
    };
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
    loadAssignedStaffProfessionKeys,
    staffHasProfession,
    validateStaffProfessionAssignments,
    resolveStaffProfessionAssignments,
    resolveStaffProfessionAssignment,
    normalizeProfessionCatalogRow,
    curateProfessionCatalogRows,
    professionCatalogInventory,
    loadProfessionWorkspaceCatalog,
    loadProfessionWorkspace,
    professionCatalogActiveKeySet,
    validateProfessionKeys
};
