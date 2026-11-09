'use strict';

const { normalizeProfessionKey, normalizeSecondaryProfessions, professionCatalogInventory } = require('./professions');

function invalidStaffField(field, message) {
    return Object.assign(new Error(message), { statusCode: 400, code: 'STAFF_CREATE_INVALID_FIELD', field });
}

function normalizeStaffCreateText(value, field, maxLength, required = false) {
    const text = typeof value === 'string' ? value.trim() : '';
    if ((value != null && typeof value !== 'string') || text.includes('\u0000')) {
        throw invalidStaffField(field, `Перевірте формат поля ${field}`);
    }
    if (required && !text) throw invalidStaffField(field, `Заповніть поле ${field}`);
    if (Array.from(text).length > maxLength) {
        throw invalidStaffField(field, `Поле ${field} має містити до ${maxLength} символів`);
    }
    return text || null;
}

function normalizeStaffHireDate(value) {
    const raw = normalizeStaffCreateText(value, 'Дата найму', 10);
    if (!raw) return null;
    const parsed = new Date(raw + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith('0000')
        || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
        throw invalidStaffField('hireDate', 'Вкажіть дійсну дату найму у форматі YYYY-MM-DD');
    }
    return raw;
}

function normalizeStaffCreateFields(input) {
    return {
        name: normalizeStaffCreateText(input.name, 'Ім’я та прізвище', 100, true),
        department: normalizeStaffCreateText(input.department, 'Відділ', 50, true),
        position: normalizeStaffCreateText(input.position, 'Посада', 100, true),
        phone: normalizeStaffCreateText(input.phone, 'Телефон', 30),
        hireDate: normalizeStaffHireDate(input.hireDate)
    };
}

async function validateNewStaffProfessions(db, primaryProfession, secondaryProfessions) {
    const primary = normalizeProfessionKey(primaryProfession);
    const secondary = normalizeSecondaryProfessions(secondaryProfessions, primary);
    const keys = [primary, ...secondary].filter(Boolean);
    if (keys.length) {
        const { rows } = await db.query(
            'SELECT key, is_active FROM hr_professions WHERE key = ANY($1::text[])',
            [keys]
        );
        const active = new Map(rows.map(row => [row.key, row.is_active !== false]));
        const virtual = new Set(professionCatalogInventory().virtual);
        const invalid = keys.find(key => active.has(key) ? !active.get(key) : !virtual.has(key));
        if (invalid) throw invalidStaffField('profession', `Професія ${invalid} недоступна`);
    }
    return { primary, secondary };
}

function normalizeDistinctStaffIds(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some(id => !Number.isSafeInteger(id) || id < 1)) {
        throw invalidStaffField('distinctStaffIds', 'Некоректні номери карток для перевірки збігу');
    }
    return [...new Set(value)].sort((a, b) => a - b);
}

async function requireDistinctStaffConfirmation(client, { name, phone, distinctStaffIds = [] }) {
    const normalizedName = name.replace(/\s+/g, ' ');
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    const keys = [`name:${normalizedName.toLowerCase()}`];
    if (normalizedPhone.length >= 7) keys.push(`phone:${normalizedPhone}`);
    for (const key of keys) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['park-staff-identity:' + key]);
    }
    const { rows } = await client.query(
        `SELECT id, name, department, position, COALESCE(is_active, true) AS is_active
         FROM staff
         WHERE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) = lower($1)
            OR (length($2) >= 7 AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2)
         ORDER BY id
         LIMIT 100`, [normalizedName, normalizedPhone]
    );
    if (rows.length && rows.some(row => !distinctStaffIds.includes(Number(row.id)))) {
        throw Object.assign(new Error('Знайдено схожі картки. Перевірте їх перед створенням іншої людини.'), {
            statusCode: 409,
            code: 'STAFF_POSSIBLE_DUPLICATE',
            candidates: rows
        });
    }
}

async function insertStaffRecord(db, {
    name, department, position, phone, hireDate, primaryProfession, secondaryProfessions,
    color, telegramUsername, address, structureNodeId, hourlyRate = 0, rateUnit = 'hour'
}) {
    const secondary = normalizeSecondaryProfessions(secondaryProfessions, primaryProfession);
    const { rows } = await db.query(
        `INSERT INTO staff (name, department, position, phone, hire_date, role_type, secondary_professions,
            color, telegram_username, address, company_structure_node_id, hourly_rate, rate_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [name, department, position, phone || null, hireDate || null, primaryProfession || null, JSON.stringify(secondary),
            color || null, telegramUsername || null, address || null, structureNodeId || null, hourlyRate, rateUnit]
    );
    return rows[0];
}

module.exports = {
    insertStaffRecord, normalizeStaffCreateFields, normalizeStaffHireDate, normalizeStaffCreateText,
    validateNewStaffProfessions, normalizeDistinctStaffIds, requireDistinctStaffConfirmation
};
