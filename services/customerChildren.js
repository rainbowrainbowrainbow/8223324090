'use strict';

const { pool: defaultPool } = require('../db');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');

const MAX_CHILDREN_PER_CUSTOMER = 50;
const CHILD_SOURCE_KIND_MAX = 64;
const CHILD_NAME_MAX = 200;
const CHILD_NOTE_MAX = 1000;
const CHILD_DIETARY_TAG_MAX = 40;
const CHILD_DIETARY_TAGS_MAX = 20;
const CHILD_DIETARY_TAG_ALIASES = Object.freeze(new Map([
    ['allergy', 'other'],
    ['allergies', 'other'],
    ['arachis', 'peanuts'],
    ['bez_gluten', 'gluten'],
    ['bez_glutenu', 'gluten'],
    ['bez_gorihiv', 'nuts'],
    ['bez_laktozy', 'lactose'],
    ['bez_moloka', 'dairy'],
    ['bez_yayets', 'eggs'],
    ['dairy_free', 'dairy'],
    ['egg', 'eggs'],
    ['gluten_free', 'gluten'],
    ['gorihi', 'nuts'],
    ['lactose_free', 'lactose'],
    ['milk', 'dairy'],
    ['no_gluten', 'gluten'],
    ['no_lactose', 'lactose'],
    ['no_milk', 'dairy'],
    ['no_nuts', 'nuts'],
    ['peanut', 'peanuts'],
    ['sugar_free', 'sugar'],
    ['yaytsya', 'eggs']
]));
const LEGACY_CHILD_FIELD_POLICY = Object.freeze({
    canonicalTruth: 'customer_children',
    legacyFields: Object.freeze(['customers.child_name', 'customers.child_birthday']),
    mode: 'compatibility_snapshot_only',
    allowedWriters: Object.freeze({
        customerApi: 'routes/customers.js may write legacy snapshots only while calling replaceCustomerChildren in the same customer transaction.',
        leadSync: 'routes/leads.js may write child_name as a lead-owned snapshot only after syncing all lead celebrants to customer_children.',
        bookingCreate: 'routes/bookings.js may write legacy fields only when creating a new customer from a booking payload.',
        maysternyaWebhookCreate: 'services/maysternyaBookingWebhook.js may write legacy fields only when creating a new Maysternya customer.',
        customerMerge: 'routes/customers.js merge may fill empty legacy snapshot fields from the duplicate customer while moving customer_children rows.'
    }),
    rules: Object.freeze([
        'customer_children is the canonical multi-child truth.',
        'customers.child_name and customers.child_birthday are compatibility snapshots, not independent truth.',
        'New flows must not overwrite multiple canonical children with one legacy child.',
        'Birthday must be explicit YYYY-MM-DD; never infer birthday from age text or age_snapshot.'
    ])
});
const CUSTOMER_CHILD_DISPLAY_POLICY = Object.freeze({
    storageTruth: 'customer_children',
    surfaces: Object.freeze({
        legacyChildName: 'first_child_snapshot',
        legacyChildBirthday: 'first_explicit_birthday_snapshot',
        bulkMessageChildName: 'joined_compact_names',
        bulkMessageChildBirthday: 'joined_compact_birthdays',
        birthdayReminders: 'one_row_per_child_birthday',
        bookingCustomerBlock: 'joined_compact_names',
        banquetSummary: 'full_children_list_with_single_child_compat_celebrant',
        vcardNote: 'joined_compact_names_and_birthdays',
        vcardBday: 'first_explicit_birthday_only'
    }),
    labels: Object.freeze({
        childName: 'Діти',
        childBirthday: 'ДН дітей',
        singleCelebrant: 'Іменинник',
        multipleCelebrants: 'Діти клієнта'
    })
});

class CustomerChildrenError extends Error {
    constructor(message, { status = 400, code = 'CUSTOMER_CHILDREN_ERROR', details = null } = {}) {
        super(message);
        this.name = 'CustomerChildrenError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function cleanText(value, maxLength = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeDietaryTagValue(value, index = 0, options = {}) {
    const raw = typeof value === 'object' && value !== null
        ? value.tag ?? value.key ?? value.id ?? value.value ?? value.name
        : value;
    const text = cleanText(raw, CHILD_DIETARY_TAG_MAX * 2);
    if (!text) return null;

    const normalized = text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^#+/, '')
        .replace(/\+/g, '_plus_')
        .replace(/&/g, '_and_')
        .replace(/[\s./]+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .replace(/_+/g, '_')
        .replace(/^[_:-]+|[_:-]+$/g, '')
        .slice(0, CHILD_DIETARY_TAG_MAX);

    const tag = CHILD_DIETARY_TAG_ALIASES.get(normalized) || normalized;
    if (/^[a-z0-9][a-z0-9_:-]{0,39}$/.test(tag)) return tag;

    if (options.strict === false) return null;
    throw new CustomerChildrenError(`children[${index}].dietaryTags contains an invalid tag`, {
        code: 'VALIDATION_CHILD_DIETARY_TAG_INVALID',
        details: { field: `children[${index}].dietaryTags`, index }
    });
}

function parseDietaryTagList(value) {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return [value];
    const text = String(value).trim();
    if (!text) return [];
    if (/^\s*\[/.test(text)) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // Fall back to delimiter parsing below.
        }
    }
    return text.split(/[,;\n|]+/);
}

function normalizeDietaryTags(value, index = 0, options = {}) {
    const tags = [];
    for (const item of parseDietaryTagList(value)) {
        const tag = normalizeDietaryTagValue(item, index, options);
        if (!tag || tags.includes(tag)) continue;
        tags.push(tag);
        if (tags.length > CHILD_DIETARY_TAGS_MAX) {
            if (options.strict === false) return tags.slice(0, CHILD_DIETARY_TAGS_MAX);
            throw new CustomerChildrenError(`children[${index}].dietaryTags can contain at most ${CHILD_DIETARY_TAGS_MAX} tags`, {
                code: 'VALIDATION_CHILD_DIETARY_TAGS_TOO_MANY',
                details: { field: `children[${index}].dietaryTags`, index, max: CHILD_DIETARY_TAGS_MAX }
            });
        }
    }
    return tags;
}

function firstProvidedValue(...values) {
    for (const value of values) {
        if (value !== undefined) return value;
    }
    return undefined;
}

function customerChildHasData(child = {}) {
    const ageSnapshot = child.ageSnapshot ?? child.age_snapshot ?? null;
    const dietaryTags = child.dietaryTags ?? child.dietary_tags;
    const dietaryNote = child.dietaryNote ?? child.dietary_note;
    return Boolean(
        child.name
        || child.birthday
        || ageSnapshot !== null
        || child.note
        || (Array.isArray(dietaryTags) && dietaryTags.length)
        || dietaryNote
    );
}

function dateOnlyFromRow(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function validateChildBirthday(value, field = 'birthday') {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new CustomerChildrenError(`${field} must be YYYY-MM-DD`, {
            code: 'VALIDATION_BIRTHDAY_INVALID',
            details: { field }
        });
    }

    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw new CustomerChildrenError(`${field} must be a valid calendar date`, {
            code: 'VALIDATION_BIRTHDAY_INVALID',
            details: { field }
        });
    }
    return text;
}

function normalizeAgeSnapshot(value, field = 'ageSnapshot') {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
        throw new CustomerChildrenError(`${field} must be an integer between 0 and 120`, {
            code: 'VALIDATION_AGE_INVALID',
            details: { field }
        });
    }
    return parsed;
}

function jsonObject(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function normalizeChildInput(input = {}, index = 0, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new CustomerChildrenError('child must be an object', {
            code: 'VALIDATION_CHILD_INVALID',
            details: { index }
        });
    }

    const name = cleanText(input.name ?? input.childName ?? input.child_name, CHILD_NAME_MAX);
    const birthday = validateChildBirthday(
        input.birthday ?? input.birthDate ?? input.birth_date ?? input.childBirthday ?? input.child_birthday,
        `children[${index}].birthday`
    );
    const ageSnapshot = normalizeAgeSnapshot(
        input.ageSnapshot ?? input.age_snapshot ?? input.age ?? input.childAge ?? input.child_age,
        `children[${index}].ageSnapshot`
    );
    const note = cleanText(input.note ?? input.notes, CHILD_NOTE_MAX);
    const dietaryTags = normalizeDietaryTags(firstProvidedValue(
        input.dietaryTags,
        input.dietary_tags,
        input.dietaryTag,
        input.dietary_tag,
        input.allergyTags,
        input.allergy_tags,
        input.allergens,
        input.allergies
    ), index);
    const dietaryNote = cleanText(firstProvidedValue(
        input.dietaryNote,
        input.dietary_note,
        input.dietaryNotes,
        input.dietary_notes,
        input.foodNote,
        input.food_note,
        input.allergyNote,
        input.allergy_note
    ), CHILD_NOTE_MAX);

    if (!customerChildHasData({ name, birthday, ageSnapshot, note, dietaryTags, dietaryNote })) return null;
    if (options.requireName && !name) {
        throw new CustomerChildrenError(`children[${index}].name is required`, {
            code: 'VALIDATION_CHILD_NAME_REQUIRED',
            details: { field: `children[${index}].name`, index }
        });
    }
    return { name, birthday, ageSnapshot, note, dietaryTags, dietaryNote };
}

function isCustomerChildrenStorageMissing(err) {
    const message = String(err?.message || '');
    return ['42P01', '42703'].includes(String(err?.code || ''))
        || (/customer_children/i.test(message) && /(does not exist|undefined|column)/i.test(message));
}

function queryable(options = {}) {
    return options.client || options.db || options.pool || defaultPool;
}

function positiveIntegerOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function withTransaction(options, callback) {
    if (options.client && typeof options.client.query === 'function') {
        return callback(options.client);
    }

    if (options.db && typeof options.db.query === 'function' && typeof options.db.connect !== 'function') {
        return callback(options.db);
    }

    const pool = options.pool || options.db || defaultPool;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function mapCustomerChildRow(row = {}) {
    const sourcePayload = jsonObject(row.source_payload ?? row.sourcePayload);
    const manualReview = jsonObject(sourcePayload.manual_review ?? sourcePayload.manualReview, null);
    const dietaryTags = normalizeDietaryTags(row.dietary_tags ?? row.dietaryTags, 0, { strict: false });
    const superseded = manualReview?.superseded === true || manualReview?.status === 'superseded';
    const needsReview = sourcePayload.needs_review === true
        || sourcePayload.needsReview === true
        || manualReview?.needs_review === true
        || manualReview?.needsReview === true
        || sourcePayload.age_snapshot_from_name === true
        || sourcePayload.birthday_rejected === true;
    return {
        id: row.id ?? null,
        businessContext: row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT,
        customerId: row.customer_id ?? row.customerId ?? null,
        leadId: row.lead_id ?? row.leadId ?? null,
        bookingId: row.booking_id ?? row.bookingId ?? null,
        name: row.name || null,
        birthday: dateOnlyFromRow(row.birthday),
        ageSnapshot: row.age_snapshot ?? row.ageSnapshot ?? null,
        note: row.note || null,
        dietaryTags,
        dietaryNote: cleanText(row.dietary_note ?? row.dietaryNote, CHILD_NOTE_MAX),
        sourceKind: row.source_kind || row.sourceKind || 'unknown',
        sourcePayload,
        manualReview,
        needsReview,
        superseded,
        sortOrder: row.sort_order ?? row.sortOrder ?? 0,
        createdAt: row.created_at || row.createdAt || null,
        updatedAt: row.updated_at || row.updatedAt || null
    };
}

async function listCustomerChildren(customerId, businessContext = DEFAULT_BUSINESS_CONTEXT, options = {}) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new CustomerChildrenError('customerId must be a positive integer', {
            code: 'VALIDATION_CUSTOMER_ID_INVALID',
            details: { field: 'customerId' }
        });
    }

    const ctx = normalizeBusinessContext(businessContext);
    try {
        const result = await queryable(options).query(
            `SELECT id, business_context, customer_id, lead_id, booking_id, name, birthday,
                    age_snapshot, note, source_kind, source_payload, sort_order,
                    dietary_tags, dietary_note, created_at, updated_at
             FROM customer_children
             WHERE customer_id = $1
               AND business_context = $2
             ORDER BY sort_order ASC, id ASC`,
            [id, ctx]
        );
        return (result.rows || []).map(mapCustomerChildRow);
    } catch (err) {
        if (isCustomerChildrenStorageMissing(err)) return [];
        throw err;
    }
}

async function replaceCustomerChildren(
    customerId,
    children,
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    source = {},
    options = {}
) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new CustomerChildrenError('customerId must be a positive integer', {
            code: 'VALIDATION_CUSTOMER_ID_INVALID',
            details: { field: 'customerId' }
        });
    }

    const ctx = normalizeBusinessContext(businessContext);
    const sourceKind = cleanText(source.sourceKind || source.kind || 'manual', CHILD_SOURCE_KIND_MAX) || 'manual';
    const requireName = source.requireName === true;
    const sourceLeadId = positiveIntegerOrNull(source.sourceLeadId ?? source.leadId ?? source.lead_id);
    const sourceBookingId = positiveIntegerOrNull(source.sourceBookingId ?? source.bookingId ?? source.booking_id);
    const sortOrderBase = Number.isInteger(Number(source.sortOrderBase)) ? Number(source.sortOrderBase) : 0;
    const normalized = (Array.isArray(children) ? children : [])
        .slice(0, MAX_CHILDREN_PER_CUSTOMER)
        .map((child, index) => normalizeChildInput(child, index, { requireName }))
        .filter(Boolean);
    const sourcePayloadBase = jsonObject(source.sourcePayload || source.payload, {});

    return withTransaction(options, async client => {
        if (source.replaceAllForCustomer === true) {
            await client.query(
                `DELETE FROM customer_children
                 WHERE customer_id = $1
                   AND business_context = $2`,
                [id, ctx]
            );
        } else if (sourceLeadId) {
            await client.query(
                `DELETE FROM customer_children
                 WHERE customer_id = $1
                   AND business_context = $2
                   AND source_kind = $3
                   AND lead_id = $4`,
                [id, ctx, sourceKind, sourceLeadId]
            );
        } else {
            await client.query(
                `DELETE FROM customer_children
                 WHERE customer_id = $1
                   AND business_context = $2
                   AND source_kind = $3`,
                [id, ctx, sourceKind]
            );
        }

        for (const [index, child] of normalized.entries()) {
            await client.query(
                `INSERT INTO customer_children (
                    business_context, customer_id, lead_id, booking_id, name, birthday, age_snapshot, note,
                    source_kind, source_payload, sort_order, dietary_tags, dietary_note
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::text[], $13)`,
                [
                    ctx,
                    id,
                    sourceLeadId,
                    sourceBookingId,
                    child.name,
                    child.birthday,
                    child.ageSnapshot,
                    child.note,
                    sourceKind,
                    JSON.stringify({
                        ...sourcePayloadBase,
                        source: source.source || sourceKind,
                        source_lead_id: sourceLeadId,
                        source_booking_id: sourceBookingId,
                        input_index: index,
                        copy_rule: source.copyRule || 'replace_customer_children'
                    }),
                    sortOrderBase + index,
                    child.dietaryTags,
                    child.dietaryNote
                ]
            );
        }

        return listCustomerChildren(id, ctx, { client });
    });
}

function buildLegacyChildProjection(customerRow = {}) {
    const name = cleanText(customerRow.childName ?? customerRow.child_name, CHILD_NAME_MAX);
    const birthday = dateOnlyFromRow(customerRow.childBirthday ?? customerRow.child_birthday);
    if (!name && !birthday) return [];

    return [{
        id: null,
        businessContext: customerRow.businessContext || customerRow.business_context || DEFAULT_BUSINESS_CONTEXT,
        customerId: customerRow.id ?? customerRow.customerId ?? customerRow.customer_id ?? null,
        leadId: customerRow.leadId ?? customerRow.lead_id ?? null,
        bookingId: null,
        name,
        birthday,
        ageSnapshot: null,
        note: null,
        dietaryTags: [],
        dietaryNote: null,
        sourceKind: 'legacy_customer_fields',
        sourcePayload: {
            source_table: 'customers',
            child_name: name,
            child_birthday: birthday,
            fallback_projection: true
        },
        sortOrder: 0,
        createdAt: null,
        updatedAt: null,
        legacy: true
    }];
}

function buildCustomerChildrenProjection(customerRow = {}, canonicalRows = []) {
    const rows = Array.isArray(canonicalRows) ? canonicalRows : [];
    const projection = rows
        .map(mapCustomerChildRow)
        .filter(child => !child.superseded)
        .filter(customerChildHasData)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || ((a.id || 0) - (b.id || 0)));

    return projection.length ? projection : buildLegacyChildProjection(customerRow);
}

function buildLegacyChildSnapshot(children = [], fallback = {}) {
    const rows = Array.isArray(children) ? children : [];
    const first = rows.find(child => {
        if (!child || typeof child !== 'object') return false;
        return cleanText(child.name ?? child.childName ?? child.child_name, CHILD_NAME_MAX)
            || dateOnlyFromRow(child.birthday ?? child.birthDate ?? child.birth_date ?? child.childBirthday ?? child.child_birthday);
    }) || null;

    const name = first
        ? cleanText(first.name ?? first.childName ?? first.child_name, CHILD_NAME_MAX)
        : cleanText(fallback.childName ?? fallback.child_name, CHILD_NAME_MAX);
    const birthday = first
        ? dateOnlyFromRow(first.birthday ?? first.birthDate ?? first.birth_date ?? first.childBirthday ?? first.child_birthday)
        : dateOnlyFromRow(fallback.childBirthday ?? fallback.child_birthday);

    return {
        childName: name || null,
        childBirthday: birthday || null
    };
}

function customerChildrenNameDisplay(children = [], options = {}) {
    const limit = Number.isInteger(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 8;
    const names = (Array.isArray(children) ? children : [])
        .map(child => cleanText(child?.name, CHILD_NAME_MAX))
        .filter(Boolean);
    if (!names.length) return null;
    const visible = names.slice(0, limit);
    const suffix = names.length > visible.length ? ` +${names.length - visible.length}` : '';
    return `${visible.join(', ')}${suffix}`;
}

function customerChildrenBirthdayDisplay(children = [], options = {}) {
    const limit = Number.isInteger(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 8;
    const birthdays = (Array.isArray(children) ? children : [])
        .map(child => dateOnlyFromRow(child?.birthday ?? child?.childBirthday ?? child?.child_birthday))
        .filter(Boolean);
    if (!birthdays.length) return null;
    const visible = birthdays.slice(0, limit);
    const suffix = birthdays.length > visible.length ? ` +${birthdays.length - visible.length}` : '';
    return `${visible.join(', ')}${suffix}`;
}

function customerChildLineDisplay(child = {}) {
    const name = cleanText(child?.name ?? child?.childName ?? child?.child_name, CHILD_NAME_MAX);
    const birthday = dateOnlyFromRow(child?.birthday ?? child?.birthDate ?? child?.birth_date ?? child?.childBirthday ?? child?.child_birthday);
    if (name && birthday) return `${name} (${birthday})`;
    return name || birthday || null;
}

function customerChildrenFullDisplay(children = [], options = {}) {
    const limit = Number.isInteger(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 12;
    const rows = (Array.isArray(children) ? children : [])
        .map(customerChildLineDisplay)
        .filter(Boolean);
    if (!rows.length) return null;
    const visible = rows.slice(0, limit);
    const suffix = rows.length > visible.length ? ` +${rows.length - visible.length}` : '';
    return `${visible.join(', ')}${suffix}`;
}

function firstCustomerChild(children = []) {
    return (Array.isArray(children) ? children : []).find(child =>
        child && customerChildHasData(child)
    ) || null;
}

module.exports = {
    CustomerChildrenError,
    LEGACY_CHILD_FIELD_POLICY,
    CUSTOMER_CHILD_DISPLAY_POLICY,
    validateChildBirthday,
    normalizeChildInput,
    normalizeDietaryTags,
    listCustomerChildren,
    replaceCustomerChildren,
    buildCustomerChildrenProjection,
    buildLegacyChildSnapshot,
    customerChildrenNameDisplay,
    customerChildrenBirthdayDisplay,
    customerChildrenFullDisplay,
    customerChildLineDisplay,
    firstCustomerChild,
    mapCustomerChildRow,
    isCustomerChildrenStorageMissing
};
