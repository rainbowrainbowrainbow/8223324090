'use strict';

const { normalizeProfessionKey, normalizeSecondaryProfessions } = require('./professions');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');

const CONTRACT_VERSION = 'v27.2';
const DOCUMENT_TEMPLATES = Object.freeze(['arrival_inout', 'month_grid']);
const DAILY_MODES = Object.freeze(['manual_blank', 'actual_times']);
const ROSTER_MODES = Object.freeze(['all_eligible', 'scheduled_on_date']);
const SAFE_CATEGORY_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;
const LEGACY_IDENTITY_SUFFIX_RE = /\.(?:mgr|clean)$/i;
const MONTH_GRID_NUMERIC_LEGEND = '0,5 — половина зміни · 0,75 — три чверті зміни · 1 — повна зміна';
const DOCUMENT_TEXT_DEFAULTS = Object.freeze({
    arrival_inout: Object.freeze({
        title: 'Лист приходу / уходу працівників',
        monthlyInstruction: 'Укажіть частку зміни числом: 0,5; 0,75 або 1',
        footerNote: 'EG-FORMS-v27 • Лист приходу/уходу • A4 вертикально • CRM Event Genix'
    }),
    month_grid: Object.freeze({
        title: 'Місячний табель-відмічалка',
        monthlyInstruction: 'Укажіть частку зміни числом: 0,5; 0,75 або 1',
        footerNote: 'EG-FORMS-v27 • Місячний табель • A4 горизонтально • CRM Event Genix'
    })
});
const LEGACY_DOCUMENT_TEXT_DEFAULTS = Object.freeze({
    arrival_inout: Object.freeze({
        monthlyInstruction: 'У клітинці ставимо заштриховку з легенди',
        footerNote: 'EG-FORMS-v27 • Лист приходу/уходу • A4 vertical • CRM Event Genix'
    }),
    month_grid: Object.freeze({
        monthlyInstruction: 'У клітинці ставимо заштриховку з легенди',
        footerNote: 'EG-FORMS-v27 • Місячний табель • A4 horizontal • CRM Event Genix'
    })
});

const FONT_PRESET = Object.freeze({
    title: Object.freeze({ value: 14, min: 12, max: 16 }),
    meta: Object.freeze({ value: 9, min: 7, max: 10 }),
    footer: Object.freeze({ value: 5, min: 4, max: 6 }),
    dailyEmployee: Object.freeze({ value: 15, min: 12, max: 16 }),
    dailyCategory: Object.freeze({ value: 8, min: 6.5, max: 9 }),
    dailyTimeLabel: Object.freeze({ value: 10, min: 8, max: 11 }),
    monthlyEmployee: Object.freeze({ value: 9, min: 7, max: 10 }),
    monthlyCategory: Object.freeze({ value: 6, min: 5, max: 7.5 }),
    monthlyDayHeader: Object.freeze({ value: 7, min: 6, max: 8 }),
    monthlyLegend: Object.freeze({ value: 6.5, min: 5.5, max: 8 })
});

const PRINT_CATEGORY_DEFINITIONS = Object.freeze([
    category('art_director', 'Арт-директор', ['art_director'], 10, 3, 1),
    category('leader', 'Керівник', ['director', 'vice_director'], 20, 3, 2),
    category('bartender', 'Бармен', ['bartender', 'barista'], 30, 3, 3, {
        discriminator: /бармен/i,
        discriminatorKeys: ['barista']
    }),
    category('wardrobe', 'Гардеробниця', ['wardrobe'], 40, 3, 4),
    category('cleaning', 'Прибирання', ['cleaner', 'cleaning'], 50, 3, 6, {
        discriminator: /прибиран/i,
        discriminatorKeys: ['cleaning']
    }),
    category('hall_hostess', 'Хозяюшка залу', ['cleaning'], 60, 2, 4, {
        discriminator: /хозяюшка\s+залу/i,
        discriminatorKeys: ['cleaning']
    }),
    category('trampoline', 'Батутист', ['trampoline_instructor', 'instructor', 'senior_instructor'], 70, 3, 7, {
        discriminator: /батутист/i,
        discriminatorKeys: ['instructor', 'senior_instructor']
    }),
    category('animator', 'Аніматор', ['animator'], 80, 1, 5),
    category('tech_director', 'Тех-директор', ['it_specialist', 'maintenance', 'technician'], 90, 1, 6, {
        discriminator: /тех(?:нічний)?[-\s]*директор/i,
        discriminatorKeys: ['it_specialist', 'maintenance', 'technician']
    }),
    category('hr', 'HR-менеджер', ['hr', 'hr_manager'], 100, 1, 1),
    category('admin', 'Адміністратор', ['admin'], 110, 2, 1),
    category('accountant', 'Бухгалтер', ['accountant'], 120, 1, 2),
    category('sales_manager', 'Менеджер з продажу', ['manager'], 130, 2, 2),
    category('top_manager', 'Топ-менеджер', ['senior_manager'], 140, 1, 3),
    category('cook', 'Кухар', ['cook', 'head_cook', 'head_chef'], 150, 2, 3),
    category('waiter', 'Офіціант', ['waiter'], 160, 1, 4),
    category('dishwasher', 'Мийниця', ['dishwasher'], 170, 3, 5),
    category('security', 'Охоронець', ['security', 'maintenance'], 180, 2, 5, {
        discriminator: /охорон/i,
        discriminatorKeys: ['maintenance']
    })
]);

const CATEGORY_BY_ID = new Map(PRINT_CATEGORY_DEFINITIONS.map(item => [item.id, item]));
const UKRAINIAN_NAME_COLLATOR = new Intl.Collator('uk-UA', { sensitivity: 'base', numeric: true });
const KYIV_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});

function category(id, label, professionKeys, dailyOrder, monthlyPage, monthlyOrder, options = {}) {
    return Object.freeze({
        id,
        label,
        professionKeys: Object.freeze(professionKeys),
        dailyOrder,
        monthlyPage,
        monthlyOrder,
        discriminator: options.discriminator || null,
        discriminatorKeys: Object.freeze(options.discriminatorKeys || [])
    });
}

function documentInputError(message, code = 'HR_ATTENDANCE_DOCUMENT_INVALID_INPUT', details = undefined) {
    const err = new Error(message);
    err.statusCode = 400;
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
}

function singleLine(value, maxLength, field, fallback = '') {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value)
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length > maxLength) {
        throw documentInputError(`${field} перевищує ${maxLength} символів`);
    }
    return text || fallback;
}

function validIsoDate(value, field = 'documentDate') {
    const text = String(value || '').trim();
    if (!ISO_DATE_RE.test(text)) throw documentInputError(`${field} має бути у форматі YYYY-MM-DD`);
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw documentInputError(`${field} містить некоректну дату`);
    }
    return text;
}

function validIsoMonth(value) {
    const text = String(value || '').trim();
    if (!ISO_MONTH_RE.test(text)) throw documentInputError('month має бути у форматі YYYY-MM');
    const [year, month] = text.split('-').map(Number);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) {
        throw documentInputError('month містить некоректний місяць');
    }
    return text;
}

function normalizedFontPreset(input = {}) {
    if (input === undefined || input === null) input = {};
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw documentInputError('fontPreset має бути об’єктом');
    }
    const unknown = Object.keys(input).filter(key => !FONT_PRESET[key]);
    if (unknown.length) throw documentInputError('fontPreset містить невідомі параметри', undefined, unknown);
    const values = {};
    let customized = false;
    for (const [key, contract] of Object.entries(FONT_PRESET)) {
        const raw = input[key];
        const value = raw === undefined || raw === null || raw === '' ? contract.value : Number(raw);
        if (!Number.isFinite(value) || value < contract.min || value > contract.max || Math.round(value * 2) !== value * 2) {
            throw documentInputError(`${key} має бути від ${contract.min} до ${contract.max} з кроком 0.5`);
        }
        values[key] = value;
        if (value !== contract.value) customized = true;
    }
    return Object.freeze({ name: 'Еталон v27', customized, values: Object.freeze(values) });
}

function normalizedCategoryIds(input) {
    if (!Array.isArray(input) || input.length === 0) {
        throw documentInputError('categoryIds має містити хоча б одну категорію');
    }
    const ids = [];
    const seen = new Set();
    for (const raw of input) {
        const id = String(raw || '').trim().toLowerCase();
        if (!SAFE_CATEGORY_ID_RE.test(id) || !CATEGORY_BY_ID.has(id)) {
            throw documentInputError(`Невідома категорія: ${id || '(порожня)'}`);
        }
        if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

function mapLegacyDocumentDefaultTexts(templateId, texts = {}) {
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) return texts;
    const defaults = DOCUMENT_TEXT_DEFAULTS[templateId];
    const legacyDefaults = LEGACY_DOCUMENT_TEXT_DEFAULTS[templateId];
    if (!defaults || !legacyDefaults) return { ...texts };
    const mapped = { ...texts };
    for (const key of ['monthlyInstruction', 'footerNote']) {
        if (mapped[key] === legacyDefaults[key]) mapped[key] = defaults[key];
    }
    return mapped;
}

function normalizeDocumentRequest(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw documentInputError('PDF settings мають бути об’єктом');
    }
    const allowedTopLevel = new Set([
        'templateId', 'documentDate', 'month', 'categoryIds', 'dailyMode', 'rosterMode',
        'locationShift', 'markedBy', 'texts', 'fontPreset', 'allowEmpty'
    ]);
    const unknown = Object.keys(payload).filter(key => !allowedTopLevel.has(key));
    if (unknown.length) {
        throw documentInputError('Request містить заборонені або невідомі поля', undefined, unknown);
    }

    const templateId = String(payload.templateId || '').trim();
    if (!DOCUMENT_TEMPLATES.includes(templateId)) {
        throw documentInputError(`templateId має бути одним із: ${DOCUMENT_TEMPLATES.join(', ')}`);
    }
    const categoryIds = normalizedCategoryIds(payload.categoryIds);
    const texts = payload.texts === undefined || payload.texts === null ? {} : payload.texts;
    if (typeof texts !== 'object' || Array.isArray(texts)) throw documentInputError('texts має бути об’єктом');
    const allowedTextKeys = new Set(['title', 'locationLabel', 'markedByLabel', 'monthlyInstruction', 'footerNote']);
    const unknownTexts = Object.keys(texts).filter(key => !allowedTextKeys.has(key));
    if (unknownTexts.length) throw documentInputError('texts містить невідомі параметри', undefined, unknownTexts);

    const dailyMode = String(payload.dailyMode || 'manual_blank').trim();
    if (!DAILY_MODES.includes(dailyMode)) {
        throw documentInputError(`dailyMode має бути одним із: ${DAILY_MODES.join(', ')}`);
    }
    const rosterMode = String(payload.rosterMode || 'all_eligible').trim();
    if (!ROSTER_MODES.includes(rosterMode)) {
        throw documentInputError(`rosterMode має бути одним із: ${ROSTER_MODES.join(', ')}`);
    }
    if (templateId === 'month_grid' && rosterMode !== 'all_eligible') {
        throw documentInputError('month_grid підтримує лише rosterMode all_eligible');
    }

    const documentDate = templateId === 'arrival_inout'
        ? validIsoDate(payload.documentDate)
        : null;
    const month = templateId === 'month_grid'
        ? validIsoMonth(payload.month)
        : null;
    const rosterDate = documentDate || `${month}-01`;
    const defaults = DOCUMENT_TEXT_DEFAULTS[templateId];

    return deepFreeze({
        templateId,
        documentDate,
        month,
        rosterDate,
        categoryIds,
        dailyMode: templateId === 'arrival_inout' ? dailyMode : 'manual_blank',
        rosterMode,
        allowEmpty: payload.allowEmpty === true,
        locationShift: singleLine(payload.locationShift, 80, 'locationShift'),
        markedBy: singleLine(payload.markedBy, 80, 'markedBy'),
        texts: {
            title: singleLine(texts.title, 80, 'texts.title', defaults.title),
            locationLabel: singleLine(texts.locationLabel, 30, 'texts.locationLabel', 'Локація / зміна'),
            markedByLabel: singleLine(texts.markedByLabel, 30, 'texts.markedByLabel', 'Хто відмічає'),
            monthlyInstruction: singleLine(
                texts.monthlyInstruction,
                80,
                'texts.monthlyInstruction',
                defaults.monthlyInstruction
            ),
            footerNote: singleLine(texts.footerNote, 120, 'texts.footerNote', defaults.footerNote)
        },
        fontPreset: normalizedFontPreset(payload.fontPreset)
    });
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function personIdentityKey(row) {
    const userId = Number(row.user_id);
    if (Number.isSafeInteger(userId) && userId > 0) return `user:${userId}`;
    const uniqueKey = String(row.unique_person_key || '').trim().toLowerCase();
    if (uniqueKey) return `person:${uniqueKey.replace(LEGACY_IDENTITY_SUFFIX_RE, '')}`;
    return `staff:${Number(row.id)}`;
}

function personDiscriminatorText(records) {
    return records
        .flatMap(row => [row.position, row.excel_department])
        .filter(Boolean)
        .map(value => String(value).replace(/\s+/g, ' ').trim())
        .join(' | ');
}

function categoryMatch(person, definition) {
    const matchingKeys = definition.professionKeys.filter(key => person.professionKeys.includes(key));
    if (!matchingKeys.length) return null;
    const requiresDiscriminator = matchingKeys.every(key => definition.discriminatorKeys.includes(key));
    const discriminatorMatched = Boolean(definition.discriminator?.test(person.discriminatorText));
    if (requiresDiscriminator && !discriminatorMatched) return null;
    return { definition, discriminatorMatched };
}

function selectedDefinitions(settings) {
    const selected = settings.categoryIds.map(id => CATEGORY_BY_ID.get(id));
    return selected.sort((left, right) => {
        if (settings.templateId === 'month_grid') {
            return left.monthlyPage - right.monthlyPage
                || left.monthlyOrder - right.monthlyOrder
                || left.id.localeCompare(right.id);
        }
        return left.dailyOrder - right.dailyOrder || left.id.localeCompare(right.id);
    });
}

function representativeRecord(records, primaryProfessionKey) {
    return [...records].sort((left, right) => {
        const leftLinked = Number(left.user_id) > 0 ? 1 : 0;
        const rightLinked = Number(right.user_id) > 0 ? 1 : 0;
        if (leftLinked !== rightLinked) return rightLinked - leftLinked;
        const leftPrimary = normalizeProfessionKey(left.role_type) === primaryProfessionKey ? 1 : 0;
        const rightPrimary = normalizeProfessionKey(right.role_type) === primaryProfessionKey ? 1 : 0;
        if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
        return Number(left.id) - Number(right.id);
    })[0];
}

function formatKyivTime(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return KYIV_TIME_FORMATTER.format(date);
}

function attendanceForIdentity(identity, canonicalRows, legacyRows, mode) {
    if (mode !== 'actual_times') return Object.freeze({ clockIn: null, clockOut: null, source: null });
    const staffIds = new Set(identity.staffIds);
    const canonical = canonicalRows.filter(row => staffIds.has(Number(row.staff_id)));
    const legacy = legacyRows.filter(row => staffIds.has(Number(row.staff_id)));
    const sourceRows = canonical.length ? canonical : legacy;
    const source = canonical.length ? 'hr_time_records' : (legacy.length ? 'staff_checkins' : null);
    const signatures = new Map();
    for (const row of sourceRows) {
        const clockIn = formatKyivTime(row.clock_in ?? row.check_in);
        const clockOut = formatKyivTime(row.clock_out ?? row.check_out);
        const signature = `${clockIn || ''}|${clockOut || ''}`;
        if (!signatures.has(signature)) signatures.set(signature, { clockIn, clockOut, staffIds: [] });
        signatures.get(signature).staffIds.push(Number(row.staff_id));
    }
    if (signatures.size > 1) {
        throw documentInputError(
            'Знайдено конфліктні attendance records для однієї фізичної особи',
            'HR_ATTENDANCE_DOCUMENT_ATTENDANCE_CONFLICT',
            { identityKey: identity.identityKey, records: [...signatures.values()] }
        );
    }
    const attendance = signatures.values().next().value || { clockIn: null, clockOut: null };
    return Object.freeze({ clockIn: attendance.clockIn, clockOut: attendance.clockOut, source });
}

function buildPeople(staffRows, assignmentRows) {
    const assignmentsByStaff = new Map();
    for (const row of assignmentRows) {
        const staffId = Number(row.staff_id);
        if (!assignmentsByStaff.has(staffId)) assignmentsByStaff.set(staffId, []);
        assignmentsByStaff.get(staffId).push(row);
    }
    const groups = new Map();
    for (const row of staffRows) {
        const key = personIdentityKey(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    return [...groups.entries()].map(([identityKey, records]) => {
        const staffIds = records.map(row => Number(row.id)).filter(Number.isSafeInteger).sort((a, b) => a - b);
        const approvedAssignments = staffIds.flatMap(id => assignmentsByStaff.get(id) || []);
        const normalizedPrimary = approvedAssignments.find(row => row.is_primary === true);
        const legacyPrimary = records.map(row => normalizeProfessionKey(row.role_type)).find(Boolean) || '';
        const primaryProfessionKey = normalizeProfessionKey(normalizedPrimary?.profession_key) || legacyPrimary;
        const professionKeys = new Set();
        for (const row of records) {
            const primary = normalizeProfessionKey(row.role_type);
            if (primary) professionKeys.add(primary);
            for (const key of normalizeSecondaryProfessions(parseJsonArray(row.secondary_professions), primary)) {
                if (key) professionKeys.add(key);
            }
        }
        for (const row of approvedAssignments) {
            const key = normalizeProfessionKey(row.profession_key);
            if (key) professionKeys.add(key);
        }
        const representative = representativeRecord(records, primaryProfessionKey);
        const name = singleLine(representative.display_name || representative.name, 200, 'employeeName');
        return {
            identityKey,
            staffIds,
            name,
            professionKeys: [...professionKeys].sort(),
            primaryProfessionKey,
            discriminatorText: personDiscriminatorText(records)
        };
    });
}

function rosterDateValue(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
}

function isStaffRowEligibleForAttendanceDocument(row = {}, rosterDate) {
    if (row.is_active === false) return false;
    if (String(row.hr_pool_status || 'core') !== 'core') return false;
    if (row.is_freelance === true) return false;
    const terminationDate = rosterDateValue(row.termination_date);
    return !terminationDate || !rosterDate || terminationDate > rosterDate;
}

function buildHrAttendanceDocumentSnapshotFromRows(settingsInput, rows = {}, options = {}) {
    const settings = settingsInput?.templateId ? settingsInput : normalizeDocumentRequest(settingsInput);
    const scheduledIds = new Set((rows.shiftRows || []).map(row => Number(row.staff_id)));
    const eligibleStaffRows = (rows.staffRows || [])
        .filter(row => isStaffRowEligibleForAttendanceDocument(row, settings.rosterDate));
    let people = buildPeople(eligibleStaffRows, rows.assignmentRows || []);
    if (settings.rosterMode === 'scheduled_on_date') {
        people = people.filter(person => person.staffIds.some(id => scheduledIds.has(id)));
    }

    const definitions = selectedDefinitions(settings);
    const categoryPeople = new Map(definitions.map(definition => [definition.id, []]));
    for (const person of people) {
        const matches = definitions
            .map(definition => categoryMatch(person, definition))
            .filter(Boolean)
            .sort((left, right) => {
                if (left.discriminatorMatched !== right.discriminatorMatched) return left.discriminatorMatched ? -1 : 1;
                const leftPrimary = left.definition.professionKeys.includes(person.primaryProfessionKey) ? 1 : 0;
                const rightPrimary = right.definition.professionKeys.includes(person.primaryProfessionKey) ? 1 : 0;
                if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
                return left.definition.dailyOrder - right.definition.dailyOrder
                    || left.definition.id.localeCompare(right.definition.id);
            });
        if (!matches.length) continue;
        const owner = matches[0].definition;
        categoryPeople.get(owner.id).push({
            ...person,
            attendance: attendanceForIdentity(
                person,
                rows.attendanceRows || [],
                rows.legacyAttendanceRows || [],
                settings.dailyMode
            )
        });
    }

    const categories = definitions
        .map(definition => {
            const employees = categoryPeople.get(definition.id)
                .sort((left, right) => UKRAINIAN_NAME_COLLATOR.compare(left.name, right.name)
                    || left.staffIds[0] - right.staffIds[0]);
            return {
                id: definition.id,
                label: definition.label,
                dailyOrder: definition.dailyOrder,
                monthlyPage: definition.monthlyPage,
                monthlyOrder: definition.monthlyOrder,
                count: employees.length,
                employees
            };
        })
        .filter(item => settings.allowEmpty || item.count > 0);

    const employeeCount = categories.reduce((sum, item) => sum + item.count, 0);
    if (!employeeCount && !settings.allowEmpty) {
        throw documentInputError(
            'Для вибраних категорій немає eligible працівників',
            'HR_ATTENDANCE_DOCUMENT_EMPTY_ROSTER'
        );
    }
    const generatedAt = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const monthParts = settings.month ? settings.month.split('-').map(Number) : null;
    const daysInMonth = monthParts ? new Date(Date.UTC(monthParts[0], monthParts[1], 0)).getUTCDate() : null;

    return deepFreeze({
        contractVersion: CONTRACT_VERSION,
        generatedAt: generatedAt.toISOString(),
        templateId: settings.templateId,
        settings,
        rosterDate: settings.rosterDate,
        daysInMonth,
        categoryCount: categories.length,
        employeeCount,
        categories
    });
}

async function buildHrAttendanceDocumentSnapshot(db, payload, options = {}) {
    const settings = normalizeDocumentRequest(payload);
    const staffResult = await db.query(
        `SELECT staff.id, staff.name, staff.display_name, staff.role_type,
                COALESCE(staff.secondary_professions, '[]'::jsonb) AS secondary_professions,
                staff.position, staff.excel_department, staff.unique_person_key,
                staff.is_active, COALESCE(staff.hr_pool_status, 'core') AS hr_pool_status,
                COALESCE(staff.is_freelance, false) AS is_freelance, staff.termination_date,
                employee_profiles.user_id
         FROM staff
         LEFT JOIN employee_profiles
           ON employee_profiles.staff_id = staff.id
          AND employee_profiles.is_active = true
         WHERE ${scheduleableStaffWhere('staff', { dateExpression: '$1' })}
         ORDER BY staff.id`,
        [settings.rosterDate]
    );
    const staffRows = staffResult.rows || [];
    const staffIds = staffRows.map(row => Number(row.id)).filter(Number.isSafeInteger);
    if (!staffIds.length) {
        return buildHrAttendanceDocumentSnapshotFromRows(settings, { staffRows: [] }, options);
    }

    const assignmentResult = await db.query(
        `SELECT staff_id, profession_key, is_primary, status, admission_status
         FROM staff_role_assignments
         WHERE staff_id = ANY($1::int[])
           AND status = 'active'
           AND admission_status = 'approved'
         ORDER BY staff_id, is_primary DESC, profession_key`,
        [staffIds]
    );
    let shiftRows = [];
    if (settings.rosterMode === 'scheduled_on_date') {
        const shiftResult = await db.query(
            `SELECT staff_id, shift_type, planned_start, planned_end
             FROM hr_shifts
             WHERE staff_id = ANY($1::int[])
               AND shift_date = $2::date
               AND COALESCE(shift_type, 'regular') <> 'remote'
             ORDER BY staff_id, id`,
            [staffIds, settings.documentDate]
        );
        shiftRows = shiftResult.rows || [];
    }

    let attendanceRows = [];
    let legacyAttendanceRows = [];
    if (settings.templateId === 'arrival_inout' && settings.dailyMode === 'actual_times') {
        const attendanceResult = await db.query(
            `SELECT staff_id, clock_in, clock_out
             FROM hr_time_records
             WHERE staff_id = ANY($1::int[])
               AND record_date = $2::date
             ORDER BY staff_id, id`,
            [staffIds, settings.documentDate]
        );
        const legacyResult = await db.query(
            `SELECT staff_id,
                    check_in AT TIME ZONE 'Europe/Kyiv' AS check_in,
                    check_out AT TIME ZONE 'Europe/Kyiv' AS check_out
             FROM staff_checkins
             WHERE staff_id = ANY($1::int[])
               AND date = $2::date
             ORDER BY staff_id, id`,
            [staffIds, settings.documentDate]
        );
        attendanceRows = attendanceResult.rows || [];
        legacyAttendanceRows = legacyResult.rows || [];
    }

    return buildHrAttendanceDocumentSnapshotFromRows(settings, {
        staffRows,
        assignmentRows: assignmentResult.rows || [],
        shiftRows,
        attendanceRows,
        legacyAttendanceRows
    }, options);
}

function listHrAttendanceDocumentCategories() {
    return PRINT_CATEGORY_DEFINITIONS.map(item => ({
        id: item.id,
        label: item.label,
        professionKeys: [...item.professionKeys],
        dailyOrder: item.dailyOrder,
        monthlyPage: item.monthlyPage,
        monthlyOrder: item.monthlyOrder
    }));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
    return value;
}

module.exports = {
    CONTRACT_VERSION,
    DAILY_MODES,
    DOCUMENT_TEXT_DEFAULTS,
    DOCUMENT_TEMPLATES,
    FONT_PRESET,
    LEGACY_DOCUMENT_TEXT_DEFAULTS,
    MONTH_GRID_NUMERIC_LEGEND,
    PRINT_CATEGORY_DEFINITIONS,
    ROSTER_MODES,
    buildHrAttendanceDocumentSnapshot,
    buildHrAttendanceDocumentSnapshotFromRows,
    documentInputError,
    isStaffRowEligibleForAttendanceDocument,
    listHrAttendanceDocumentCategories,
    mapLegacyDocumentDefaultTexts,
    normalizeDocumentRequest
};
