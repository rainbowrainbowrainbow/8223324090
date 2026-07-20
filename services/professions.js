'use strict';

const { scheduleableStaffWhere } = require('./staffOperationalFilters');
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
    'technician',
    'intern'
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
        checklist: parseTextList(row.checklist, 32),
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

const PROFESSION_CONDITION_DAY_TYPES = Object.freeze(['weekday', 'weekend']);
const PROFESSION_CONDITION_RATE_UNITS = new Set(['hour', 'day', 'month']);

function normalizeProfessionConditionTime(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeProfessionConditionRateUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    return PROFESSION_CONDITION_RATE_UNITS.has(unit) ? unit : 'hour';
}

function professionConditionError(message, statusCode = 400, code = 'INVALID_PROFESSION_CONDITIONS') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

async function loadPrimaryStaffShiftPreference(db, staffId, dayType) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('loadPrimaryStaffShiftPreference requires a database client');
    }
    const id = Number(staffId);
    const normalizedDayType = String(dayType || '').trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0) {
        throw professionConditionError('valid staffId is required');
    }
    if (!PROFESSION_CONDITION_DAY_TYPES.includes(normalizedDayType)) {
        throw professionConditionError('dayType must be weekday or weekend');
    }

    const staffResult = await db.query(
        `SELECT s.id, s.role_type, COALESCE(s.is_active, true) AS is_active,
                (
                    SELECT sra.profession_key
                    FROM staff_role_assignments sra
                    WHERE sra.staff_id = s.id
                      AND COALESCE(sra.is_primary, false) = true
                      AND COALESCE(sra.status, 'active') = 'active'
                    ORDER BY sra.id DESC
                    LIMIT 1
                ) AS assigned_primary_profession_key
         FROM staff s
         WHERE s.id = $1`,
        [id]
    );
    const staff = safeRows(staffResult)[0] || null;
    const professionKey = normalizeProfessionKey(staff?.assigned_primary_profession_key)
        || normalizeProfessionKey(staff?.role_type);
    if (!staff || staff.is_active === false || !professionKey) {
        return {
            staffId: id,
            professionKey: professionKey || null,
            dayType: normalizedDayType,
            startTime: null,
            endTime: null,
            isActive: false,
            source: 'unset'
        };
    }

    const preferenceResult = await db.query(
        `SELECT start_time, end_time, is_active
         FROM staff_shift_preferences
         WHERE staff_id = $1
           AND profession_key = $2
           AND day_type = $3
         LIMIT 1`,
        [id, professionKey, normalizedDayType]
    );
    const preference = safeRows(preferenceResult)[0] || null;
    const startTime = preference?.is_active === false
        ? null
        : normalizeProfessionConditionTime(preference?.start_time);
    const endTime = preference?.is_active === false
        ? null
        : normalizeProfessionConditionTime(preference?.end_time);
    const isActive = Boolean(preference && preference.is_active !== false && startTime && endTime && startTime !== endTime);

    return {
        staffId: id,
        professionKey,
        dayType: normalizedDayType,
        startTime: isActive ? startTime : null,
        endTime: isActive ? endTime : null,
        isActive,
        source: isActive ? 'staff_shift_preferences' : 'unset'
    };
}

function normalizeProfessionConditionPayload(payload = {}, current = {}) {
    const rateMode = String(payload.rateMode ?? payload.rate_mode ?? payload.rate?.mode ?? '').trim().toLowerCase() || 'explicit';
    if (!['explicit', 'fallback', 'unchanged'].includes(rateMode)) {
        throw professionConditionError('rateMode must be explicit, fallback, or unchanged');
    }
    const currentRateUnit = normalizeProfessionConditionRateUnit(current.rateUnit);
    if (rateMode === 'explicit' && currentRateUnit !== 'hour') {
        throw professionConditionError('profession rate overrides are available only for hourly staff');
    }

    let explicitRate = null;
    if (rateMode === 'explicit') {
        explicitRate = Number(payload.hourlyRate ?? payload.hourly_rate ?? payload.rate?.amount ?? payload.rate);
        if (!Number.isFinite(explicitRate) || explicitRate <= 0 || explicitRate > 1000000) {
            throw professionConditionError('rate must be greater than 0 and no more than 1000000');
        }
        explicitRate = Math.round(explicitRate * 100) / 100;
    }

    const requestedRateUnit = payload.rateUnit ?? payload.rate_unit ?? payload.rate?.unit;
    if (requestedRateUnit) {
        const requestedUnit = String(requestedRateUnit).trim().toLowerCase();
        if (!PROFESSION_CONDITION_RATE_UNITS.has(requestedUnit)) {
            throw professionConditionError('rateUnit must be hour, day, or month');
        }
        if (requestedUnit !== currentRateUnit) {
            throw professionConditionError('rateUnit is inherited from the staff profile and cannot be changed here');
        }
    }

    const sourcePreferences = payload.shiftPreferences ?? payload.shift_preferences ?? payload.preferences;
    if (!Array.isArray(sourcePreferences)) {
        throw professionConditionError('shiftPreferences must be an array');
    }
    const seen = new Set();
    const shiftPreferences = [];
    for (const item of sourcePreferences) {
        const dayType = String(item?.dayType ?? item?.day_type ?? '').trim().toLowerCase();
        if (!PROFESSION_CONDITION_DAY_TYPES.includes(dayType) || seen.has(dayType)) {
            throw professionConditionError('shiftPreferences must contain unique weekday/weekend rows');
        }
        seen.add(dayType);
        const rawStart = item?.startTime ?? item?.start_time;
        const rawEnd = item?.endTime ?? item?.end_time;
        const isEmpty = (rawStart === null || rawStart === undefined || rawStart === '')
            && (rawEnd === null || rawEnd === undefined || rawEnd === '');
        if (isEmpty) {
            shiftPreferences.push({ dayType, startTime: null, endTime: null, isActive: false });
            continue;
        }
        const startTime = normalizeProfessionConditionTime(rawStart);
        const endTime = normalizeProfessionConditionTime(rawEnd);
        if (!startTime || !endTime) {
            throw professionConditionError(`${dayType} startTime and endTime must be valid HH:MM values`);
        }
        if (startTime === endTime) {
            throw professionConditionError(`${dayType} startTime and endTime must be different`);
        }
        shiftPreferences.push({ dayType, startTime, endTime, isActive: true });
    }
    if (seen.size !== PROFESSION_CONDITION_DAY_TYPES.length) {
        throw professionConditionError('shiftPreferences must contain weekday and weekend rows');
    }
    return { rateMode, rateChanged: rateMode !== 'unchanged', explicitRate, rateUnit: currentRateUnit, shiftPreferences };
}

async function loadStaffProfessionCondition(db, staffId, professionKey, options = {}) {
    const id = Number(staffId);
    const key = normalizeRequestedProfessionKey(professionKey);
    if (!Number.isInteger(id) || id <= 0) throw professionConditionError('valid staffId is required');
    if (!key) throw professionConditionError('valid professionKey is required');

    const professionResult = await db.query(
        `SELECT id, key, title, is_active
         FROM hr_professions
         WHERE key = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [key]
    );
    const profession = safeRows(professionResult)[0];
    if (!profession) throw professionConditionError('profession not found', 404, 'PROFESSION_NOT_FOUND');

    // Keep the same profession -> staff -> assignment lock order as checklist
    // mutations so concurrent HR edits cannot deadlock each other.
    const staffResult = await db.query(
        `SELECT id, name, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                COALESCE(is_active, true) AS is_active, hourly_rate, COALESCE(rate_unit, 'hour') AS rate_unit
         FROM staff
         WHERE id = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [id]
    );
    const staff = safeRows(staffResult)[0];
    if (!staff) throw professionConditionError('staff member not found', 404, 'STAFF_NOT_FOUND');

    const assignmentResult = await db.query(
        `SELECT id, is_primary, status, admission_status, internship_status
         FROM staff_role_assignments
         WHERE staff_id = $1 AND profession_key = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [id, key]
    );
    const assignment = safeRows(assignmentResult)[0] || null;
    const legacyKeys = staffProfessionKeys(staff);
    if (!assignment && !legacyKeys.includes(key)) {
        throw professionConditionError('staff member is not assigned to this profession', 409, 'PROFESSION_NOT_ASSIGNED');
    }

    const rateResult = await db.query(
        `SELECT hourly_rate
         FROM staff_profession_rates
         WHERE staff_id = $1 AND profession_key = $2`,
        [id, key]
    );
    const preferenceResult = await db.query(
        `SELECT day_type, start_time, end_time, is_active
         FROM staff_shift_preferences
         WHERE staff_id = $1 AND profession_key = $2
         ORDER BY CASE day_type WHEN 'weekday' THEN 1 WHEN 'weekend' THEN 2 ELSE 3 END`,
        [id, key]
    );
    const explicitRateRow = safeRows(rateResult)[0] || null;
    const rateUnit = normalizeProfessionConditionRateUnit(staff.rate_unit);
    const fallbackRate = staff.hourly_rate == null ? null : Number(staff.hourly_rate);
    const storedExplicitRate = explicitRateRow?.hourly_rate == null ? null : Number(explicitRateRow.hourly_rate);
    const rateIgnored = storedExplicitRate != null && rateUnit !== 'hour';
    const explicitRate = rateIgnored ? null : storedExplicitRate;
    const preferenceMap = new Map(safeRows(preferenceResult).map(row => [String(row.day_type), row]));

    return {
        staffId: id,
        professionId: Number(profession.id),
        professionKey: key,
        staffActive: staff.is_active !== false,
        professionActive: profession.is_active !== false,
        isPrimary: assignment ? assignment.is_primary === true : normalizeProfessionKey(staff.role_type) === key,
        assignmentStatus: assignment?.status || (staff.is_active === false ? 'inactive' : 'active'),
        admissionStatus: assignment?.admission_status || (normalizeProfessionKey(staff.role_type) === key ? 'approved' : 'pending'),
        internshipStatus: assignment?.internship_status || (key === 'intern' ? 'in_progress' : 'none'),
        rateMode: explicitRate == null ? 'fallback' : 'explicit',
        explicitRate,
        storedExplicitRate,
        ignoredExplicitRate: rateIgnored ? storedExplicitRate : null,
        rateIgnored,
        fallbackRate,
        effectiveRate: explicitRate == null ? fallbackRate : explicitRate,
        rateSource: rateIgnored
            ? 'staff.hourly_rate;staff_profession_rates.hourly_rate_ignored'
            : (explicitRate == null ? 'staff.hourly_rate' : 'staff_profession_rates.hourly_rate'),
        rateUnit,
        shiftPreferences: PROFESSION_CONDITION_DAY_TYPES.map(dayType => {
            const row = preferenceMap.get(dayType);
            return {
                dayType,
                startTime: row?.is_active === false ? null : normalizeProfessionConditionTime(row?.start_time),
                endTime: row?.is_active === false ? null : normalizeProfessionConditionTime(row?.end_time),
                isActive: Boolean(row && row.is_active !== false),
                source: row && row.is_active !== false ? 'staff_shift_preferences' : 'unset'
            };
        })
    };
}

async function saveStaffProfessionCondition(db, staffId, professionKey, payload = {}, options = {}) {
    const before = await loadStaffProfessionCondition(db, staffId, professionKey, { forUpdate: true });
    const normalized = normalizeProfessionConditionPayload(payload, before);
    const actor = String(options.actor || '').trim().slice(0, 100) || null;

    if (normalized.rateMode === 'fallback') {
        await db.query(
            'DELETE FROM staff_profession_rates WHERE staff_id = $1 AND profession_key = $2',
            [before.staffId, before.professionKey]
        );
    } else if (normalized.rateMode === 'explicit') {
        await db.query(
            `INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (staff_id, profession_key) DO UPDATE SET
                hourly_rate = EXCLUDED.hourly_rate,
                updated_at = NOW()`,
            [before.staffId, before.professionKey, normalized.explicitRate]
        );
    }
    if (normalized.rateChanged) {
        await db.query(
            `UPDATE staff_role_assignments
             SET hourly_rate = $3, updated_by = $4, updated_at = NOW()
             WHERE staff_id = $1 AND profession_key = $2`,
            [before.staffId, before.professionKey, normalized.explicitRate, actor]
        );
    }

    for (const preference of normalized.shiftPreferences) {
        if (!preference.isActive) {
            await db.query(
                `DELETE FROM staff_shift_preferences
                 WHERE staff_id = $1 AND profession_key = $2 AND day_type = $3`,
                [before.staffId, before.professionKey, preference.dayType]
            );
            continue;
        }
        await db.query(
            `INSERT INTO staff_shift_preferences
                (staff_id, profession_key, day_type, start_time, end_time, is_active, created_by, updated_by)
             VALUES ($1, $2, $3, $4::time, $5::time, true, $6, $6)
             ON CONFLICT (staff_id, profession_key, day_type) DO UPDATE SET
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                is_active = true,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()`,
            [before.staffId, before.professionKey, preference.dayType, preference.startTime, preference.endTime, actor]
        );
    }

    const after = await loadStaffProfessionCondition(db, before.staffId, before.professionKey);
    return { before, after };
}

async function loadProfessionWorkspaceCatalog(db, options = {}) {
    if (!db || typeof db.query !== 'function') throw new TypeError('Profession workspace requires a database client');
    const includeInactivePeople = options.includeInactivePeople === true
        || options.includeInactive === true
        || options.include_inactive === true;
    const peopleWhereClause = includeInactivePeople ? '' : `WHERE ${scheduleableStaffWhere('s')}`;
    const [professionResult, peopleResult, preferenceResult, progressResult, checklistItemResult, trainingResult, structureResult] = await Promise.all([
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
             ${peopleWhereClause}
             ORDER BY pa.profession_key, s.id, pa.is_primary DESC`
        ),
        db.query(
            `SELECT staff_id, profession_key, day_type, start_time, end_time
             FROM staff_shift_preferences
             WHERE COALESCE(is_active, true) = true
             ORDER BY profession_key, staff_id, day_type`
        ),
        db.query(
            `SELECT progress.profession_key,
                    COUNT(*) FILTER (WHERE item.id IS NOT NULL AND item.is_active = true)::int AS active_progress_records,
                    COUNT(*) FILTER (WHERE item.id IS NOT NULL AND item.is_active = true AND progress.completed_at IS NOT NULL)::int AS active_completed_records,
                    COUNT(DISTINCT progress.staff_id) FILTER (WHERE item.id IS NOT NULL AND item.is_active = true)::int AS active_staff_with_progress,
                    COUNT(*)::int AS historical_progress_records,
                    COUNT(*) FILTER (WHERE progress.completed_at IS NOT NULL)::int AS historical_completed_records,
                    COUNT(*) FILTER (WHERE item.id IS NOT NULL AND item.is_active = false)::int AS archived_progress_records,
                    COUNT(*) FILTER (WHERE item.id IS NULL)::int AS orphaned_progress_records
             FROM hr_staff_profession_checklist_progress progress
             LEFT JOIN hr_professions profession ON profession.key = progress.profession_key
             LEFT JOIN hr_profession_checklist_items item
               ON item.id = progress.checklist_item_id
              AND item.profession_id = profession.id
             GROUP BY progress.profession_key`
        ),
        db.query(
            `SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position,
                    created_by, updated_by, created_at, updated_at
             FROM hr_profession_checklist_items
             ORDER BY profession_id, is_active DESC, sort_order, id`
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
        const rateUnit = normalizeProfessionConditionRateUnit(row.rate_unit);
        const storedExplicitRate = row.explicit_hourly_rate == null ? null : Number(row.explicit_hourly_rate);
        const rateIgnored = storedExplicitRate != null && rateUnit !== 'hour';
        const explicitRate = rateIgnored ? null : storedExplicitRate;
        const fallbackRate = row.fallback_hourly_rate == null ? null : Number(row.fallback_hourly_rate);
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
            rateMode: explicitRate == null ? 'fallback' : 'explicit',
            explicitRate,
            storedExplicitRate,
            ignoredExplicitRate: rateIgnored ? storedExplicitRate : null,
            rateIgnored,
            fallbackRate,
            hourlyRate: explicitRate == null ? fallbackRate : explicitRate,
            rateSource: rateIgnored
                ? 'staff.hourly_rate;staff_profession_rates.hourly_rate_ignored'
                : (explicitRate == null ? 'staff.hourly_rate' : 'staff_profession_rates.hourly_rate'),
            rateUnit,
            structureNodeId: row.company_structure_node_id || null,
            shiftPreferences: preferencesByAssignment.get(`${Number(row.staff_id)}:${key}`) || []
        });
    }
    peopleByKey.forEach(rows => rows.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'uk')));

    const progressByKey = new Map(safeRows(progressResult).map(row => [normalizeProfessionKey(row.profession_key), {
        records: Number(row.active_progress_records || 0),
        completed: Number(row.active_completed_records || 0),
        staffWithProgress: Number(row.active_staff_with_progress || 0),
        activeRecords: Number(row.active_progress_records || 0),
        activeCompleted: Number(row.active_completed_records || 0),
        activeStaffWithProgress: Number(row.active_staff_with_progress || 0),
        historicalRecords: Number(row.historical_progress_records || 0),
        historicalCompleted: Number(row.historical_completed_records || 0),
        archivedRecords: Number(row.archived_progress_records || 0),
        orphanedRecords: Number(row.orphaned_progress_records || 0)
    }]));
    const trainingByKey = new Map(safeRows(trainingResult).map(row => [normalizeProfessionKey(row.profession_key), {
        courses: Number(row.course_count || 0),
        activeCourses: Number(row.active_course_count || 0)
    }]));
    const checklistItemsByProfessionId = new Map();
    for (const row of safeRows(checklistItemResult)) {
        const professionId = Number(row.profession_id);
        if (!checklistItemsByProfessionId.has(professionId)) checklistItemsByProfessionId.set(professionId, []);
        checklistItemsByProfessionId.get(professionId).push({
            id: Number(row.id),
            professionId,
            profession_id: professionId,
            itemKey: row.item_key,
            item_key: row.item_key,
            checklistKey: row.item_key,
            checklist_key: row.item_key,
            title: row.title || '',
            sortOrder: Number(row.sort_order || 0),
            sort_order: Number(row.sort_order || 0),
            isActive: row.is_active !== false,
            is_active: row.is_active !== false,
            legacyPosition: row.legacy_position == null ? null : Number(row.legacy_position),
            legacy_position: row.legacy_position == null ? null : Number(row.legacy_position),
            createdBy: row.created_by || null,
            updatedBy: row.updated_by || null,
            createdAt: row.created_at || null,
            updatedAt: row.updated_at || null
        });
    }
    const structure = normalizeStaffCompanyStructurePayload(safeRows(structureResult)[0]?.value || {});
    const structureNodeById = new Map(structure.nodes.map(node => [node.id, node]));

    const items = curateProfessionCatalogRows(safeRows(professionResult)).map(profession => {
        const key = normalizeProfessionKey(profession.key);
        const people = peopleByKey.get(key) || [];
        const structureNode = profession.structureNodeId ? structureNodeById.get(profession.structureNodeId) || null : null;
        const normalizedChecklistItems = checklistItemsByProfessionId.get(Number(profession.id)) || [];
        const checklistItems = profession.isVirtual
            ? (Array.isArray(profession.checklist) ? profession.checklist : []).map((title, index) => ({
                id: null,
                professionId: profession.id,
                profession_id: profession.id,
                itemKey: `system_${key}_${index + 1}`.slice(0, 128),
                item_key: `system_${key}_${index + 1}`.slice(0, 128),
                title,
                sortOrder: (index + 1) * 10,
                sort_order: (index + 1) * 10,
                isActive: true,
                is_active: true,
                source: 'system'
            }))
            : normalizedChecklistItems;
        const activeChecklistItems = checklistItems.filter(item => item.isActive !== false);
        const archivedChecklistItems = checklistItems.filter(item => item.isActive === false);
        const checklist = activeChecklistItems.map(item => item.title);
        const checklistTemplate = {
            profession: { id: profession.id, key, title: profession.title, department: profession.department || '', isActive: profession.is_active !== false },
            items: checklistItems,
            activeItems: activeChecklistItems,
            archivedItems: archivedChecklistItems,
            checklist,
            counts: {
                total: checklistItems.length,
                active: activeChecklistItems.length,
                archived: archivedChecklistItems.length
            },
            source: profession.isVirtual ? 'system' : 'hr_profession_checklist_items'
        };
        return {
            ...profession,
            checklist,
            checklistTemplate,
            source: profession.source || (profession.isVirtual ? 'system' : 'db'),
            isReadonly: profession.isReadonly === true || profession.isVirtual === true,
            is_readonly: profession.isReadonly === true || profession.isVirtual === true,
            staffCount: people.length,
            activeStaffCount: people.filter(person => person.isActive).length,
            hasChecklist: checklist.length > 0,
            checklistCount: checklist.length,
            structureNode: structureNode ? { id: structureNode.id, title: structureNode.title } : null,
            people,
            checklistProgress: progressByKey.get(key) || {
                records: 0,
                completed: 0,
                staffWithProgress: 0,
                activeRecords: 0,
                activeCompleted: 0,
                activeStaffWithProgress: 0,
                historicalRecords: 0,
                historicalCompleted: 0,
                archivedRecords: 0,
                orphanedRecords: 0
            },
            trainingUsage: trainingByKey.get(key) || { courses: 0, activeCourses: 0 }
        };
    });

    return {
        items,
        structureNodes: structure.nodes.map(node => ({ id: node.id, title: node.title })),
        inventory: professionCatalogInventory()
    };
}

async function loadProfessionWorkspace(db, identity = {}, options = {}) {
    const catalog = await loadProfessionWorkspaceCatalog(db, options);
    const profession = catalog.items.find(item => professionWorkspaceIdentityMatches(item, identity));
    if (!profession) return null;
    return {
        profession,
        people: profession.people,
        checklist: profession.checklist,
        checklistTemplate: profession.checklistTemplate,
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
    normalizeProfessionConditionPayload,
    loadPrimaryStaffShiftPreference,
    loadStaffProfessionCondition,
    saveStaffProfessionCondition,
    professionCatalogActiveKeySet,
    validateProfessionKeys
};
