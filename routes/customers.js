/**
 * routes/customers.js — CRM Customer CRUD + search + filters + RFM + export
 * v15.1: Phase 2 — filters, RFM analytics, CSV export, certificate link
 * v20.9.12: legacy remote customers path retired; customers use Postgres.
 * v30.4.0: Tags, duplicates, merge, LTV, journey, communications, NPS, vCard, bulk
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { exportLimiter } = require('../middleware/rateLimit');
const { authenticateToken, canUseAction, requireAction, requireRole, requireMinRole } = require('../middleware/auth');
const { getCustomerCommunicationContext } = require('../services/customerCommunicationHub');
const { buildCustomerSearchQuery } = require('../services/customerSearchQuery');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { installRevenueResponseShaper } = require('../services/revenueAccessPolicy');
const { syncBirthdayTagsForCustomer } = require('../services/customerBirthdayTags');
const {
    CustomerChildrenError,
    normalizeChildInput,
    validateChildBirthday,
    replaceCustomerChildren,
    listCustomerChildren,
    buildCustomerChildrenProjection,
    buildLegacyChildSnapshot,
    customerChildrenNameDisplay,
    customerChildrenBirthdayDisplay,
    firstCustomerChild,
    mapCustomerChildRow,
    isCustomerChildrenStorageMissing
} = require('../services/customerChildren');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest,
    requireBusinessContext,
    pushBusinessContextCondition,
    pushBusinessScopeCondition,
    resolveBusinessScope,
    requireBusinessScope,
    requireWritableBusinessScope
} = require('../services/businessContext');
const {
    normalizeCustomerSource,
    getCustomerSourceLabel,
    customerSourceSqlExpression
} = require('../services/customerSource');

const log = createLogger('Customers');

// All customer routes require authentication
router.use(authenticateToken);
router.use(requireRole('admin', 'reception'));
router.use((req, res, next) => installRevenueResponseShaper(
    req,
    res,
    next,
    canUseAction(req.user, 'view_revenue')
));
// v40: Validate :id param is numeric
router.param('id', (req, res, next, val) => { if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' }); next(); });
const requireDataExport = requireAction('export_data');
function requireChildrenReviewExport(req, res, next) {
    if (String(req.query?.format || '').toLowerCase() !== 'csv') return next();
    return requireDataExport(req, res, next);
}


// v30.4: Predefined tag templates
const PREDEFINED_TAGS = [
    { tag: 'VIP', color: '#F59E0B' },
    { tag: 'Проблемний', color: '#EF4444' },
    { tag: 'Корпорат', color: '#3B82F6' },
    { tag: 'Рекомендація', color: '#10B981' },
    { tag: 'Постійний', color: '#8B5CF6' }
];
const CUSTOMER_TAG_MAX_LENGTH = 60;
const CUSTOMER_TAG_MAX_COUNT = 20;

function customerTagColor(tag, color) {
    return cleanText(color) || PREDEFINED_TAGS.find(item => item.tag === tag)?.color || '#6B7280';
}

function normalizeCustomerTagsPayload(tags) {
    if (!Array.isArray(tags)) return [];
    const byTag = new Map();
    tags.forEach(item => {
        const tag = cleanText(typeof item === 'string' ? item : item?.tag)?.slice(0, CUSTOMER_TAG_MAX_LENGTH);
        if (!tag) return;
        byTag.set(tag, {
            tag,
            color: customerTagColor(tag, typeof item === 'object' ? item?.color : null)
        });
    });
    return [...byTag.values()].slice(0, CUSTOMER_TAG_MAX_COUNT);
}

function cleanText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

const SOCIAL_IDENTITY_CHANNELS = new Set(['telegram', 'instagram', 'facebook', 'viber', 'tiktok', 'phone', 'email', 'site', 'other']);

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeSocialIdentities(value, fallback = {}) {
    const rawItems = parseJsonArray(value);
    const items = [];
    const seen = new Set();

    for (const item of rawItems) {
        if (!item || typeof item !== 'object') continue;
        const channelRaw = cleanText(item.channel || item.type || item.provider);
        const channel = channelRaw && SOCIAL_IDENTITY_CHANNELS.has(channelRaw.toLowerCase())
            ? channelRaw.toLowerCase()
            : 'other';
        const handle = cleanText(item.handle || item.username || item.value || item.phone || item.email);
        const externalId = cleanText(item.externalId || item.external_id);
        const url = cleanText(item.url || item.href);
        if (!handle && !externalId && !url) continue;
        const normalizedHandle = channel === 'instagram' && handle ? handle.replace(/^@+/, '') : handle;
        const key = `${channel}:${String(normalizedHandle || externalId || url).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
            channel,
            handle: normalizedHandle,
            externalId,
            url,
            notes: cleanText(item.notes),
            source: cleanText(item.source) || 'operator'
        });
        if (items.length >= 12) break;
    }

    const legacyInstagram = cleanText(fallback.instagram)?.replace(/^@+/, '');
    if (legacyInstagram && !seen.has(`instagram:${legacyInstagram.toLowerCase()}`)) {
        items.unshift({
            channel: 'instagram',
            handle: legacyInstagram,
            externalId: null,
            url: null,
            notes: null,
            source: 'legacy_primary'
        });
    }

    return items;
}

function formatSocialIdentities(value, fallback = {}) {
    return normalizeSocialIdentities(value, fallback)
        .map(identity => {
            const label = identity.channel === 'instagram' && identity.handle
                ? `@${identity.handle}`
                : (identity.handle || identity.externalId || identity.url || '');
            return [identity.channel, label].filter(Boolean).join(': ');
        })
        .filter(Boolean)
        .join(' | ');
}

function normalizeCustomerChildrenPayload(body = {}) {
    const childrenProvided = Object.prototype.hasOwnProperty.call(body, 'children');
    const legacyChildName = cleanText(body.childName ?? body.child_name);
    const rawLegacyBirthday = cleanText(body.childBirthday ?? body.child_birthday);
    let legacyBirthday = null;
    let children = [];

    try {
        legacyBirthday = validateChildBirthday(rawLegacyBirthday, 'childBirthday');
        if (childrenProvided) {
            if (!Array.isArray(body.children)) return { error: 'children must be an array' };
            children = body.children
                .map((child, index) => normalizeChildInput(child, index, { requireName: true }))
                .filter(Boolean);
        }
    } catch (err) {
        if (err instanceof CustomerChildrenError) {
            return { error: err.message, code: err.code, details: err.details };
        }
        throw err;
    }

    const canonicalSnapshot = buildLegacyChildSnapshot(children);
    const legacySnapshot = buildLegacyChildSnapshot([], {
        childName: legacyChildName,
        childBirthday: legacyBirthday
    });
    return {
        childrenProvided,
        children: childrenProvided
            ? children
            : buildCustomerChildrenProjection({
                childName: legacyChildName,
                childBirthday: legacyBirthday
            }, []),
        childNameSnapshot: childrenProvided ? canonicalSnapshot.childName : legacySnapshot.childName,
        childBirthdaySnapshot: childrenProvided ? canonicalSnapshot.childBirthday : legacySnapshot.childBirthday
    };
}

function normalizeCustomerPayload(body = {}) {
    const name = cleanText(body.name);
    const childBirthday = cleanText(body.childBirthday ?? body.child_birthday);
    const tagsProvided = Object.prototype.hasOwnProperty.call(body, 'tags');
    const childrenMeta = normalizeCustomerChildrenPayload(body);
    if (childrenMeta.error) return childrenMeta;
    if (childBirthday && !/^\d{4}-\d{2}-\d{2}$/.test(childBirthday)) {
        return { error: 'Дата народження має бути у форматі YYYY-MM-DD' };
    }
    return {
        name,
        phone: cleanText(body.phone),
        instagram: cleanText(body.instagram)?.replace(/^@+/, '') || null,
        childName: childrenMeta.childNameSnapshot,
        childBirthday: childrenMeta.childBirthdaySnapshot,
        childrenProvided: childrenMeta.childrenProvided,
        children: childrenMeta.children,
        source: normalizeCustomerSource(body.source),
        notes: cleanText(body.notes),
        socialIdentities: normalizeSocialIdentities(
            body.socialIdentities ?? body.social_identities,
            { instagram: body.instagram }
        ),
        tagsProvided,
        tags: tagsProvided ? normalizeCustomerTagsPayload(body.tags) : []
    };
}

async function saveCustomerChildrenFromCustomerApi(customerId, input, businessContext, sourceAction, client) {
    if (input.childrenProvided) {
        return replaceCustomerChildren(
            customerId,
            input.children,
            businessContext,
            {
                sourceKind: 'customer_api',
                source: sourceAction,
                copyRule: 'explicit_children_payload',
                requireName: true,
                replaceAllForCustomer: true
            },
            { client }
        );
    }

    const existingChildren = await listCustomerChildren(customerId, businessContext, { client });
    if (existingChildren.some(child => child.sourceKind === 'customer_api')) {
        return existingChildren;
    }

    return replaceCustomerChildren(
        customerId,
        input.children,
        businessContext,
        {
            sourceKind: 'legacy_customer_child',
            source: sourceAction,
            copyRule: 'legacy_customer_fields_payload',
            requireName: false,
            replaceAllForCustomer: false
        },
        { client }
    );
}

function requestBusinessContext(req) {
    return businessContextFromRequest(req);
}

function ensureBusinessContext(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    if (scope.mode !== 'single') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            requireWritableBusinessScope(req, res, scope);
        } else {
            res.status(400).json({
                success: false,
                error: 'This endpoint requires one active business context',
                code: 'single_business_required'
            });
        }
        return null;
    }
    const businessContext = requestBusinessContext(req);
    if (!requireBusinessContext(req, res, businessContext)) return null;
    return businessContext;
}

function ensureBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function customerContextCondition(params, businessContext, alias = '') {
    return pushBusinessContextCondition(params, businessContext || DEFAULT_BUSINESS_CONTEXT, alias);
}

function customerScopeCondition(params, businessScope, alias = '') {
    return pushBusinessScopeCondition(params, businessScope || DEFAULT_BUSINESS_CONTEXT, alias);
}

function parseCustomerVisitBound(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

let customerSocialIdentitiesColumnReady = false;

function isMissingCustomerSocialIdentitiesColumnError(err) {
    const message = [
        err?.message,
        err?.details,
        err?.hint,
        err?.code
    ].filter(Boolean).join(' ');
    return err?.code === '42703'
        || (/social_identities/i.test(message) && /(column|does not exist|could not find)/i.test(message));
}

function isCustomerSocialIdentitiesStorageError(err) {
    if (isMissingCustomerSocialIdentitiesColumnError(err)) return true;
    const message = [
        err?.message,
        err?.details,
        err?.hint,
        err?.code
    ].filter(Boolean).join(' ');
    return /social_identities/i.test(message)
        && /(jsonb|json|type|cast|malformed|invalid input|expression)/i.test(message);
}

function isCustomerDuplicateError(err) {
    const message = [
        err?.message,
        err?.details,
        err?.hint,
        err?.code
    ].filter(Boolean).join(' ');
    return err?.code === '23505'
        || /duplicate key|unique constraint|already exists|violates unique|duplicate value/i.test(message);
}

function sendCustomerDuplicateResponse(res) {
    return res.status(409).json({
        success: false,
        code: 'customer_duplicate',
        error: 'Клієнт з таким телефоном або Instagram вже існує'
    });
}

function customerWritePayload(input, options = {}) {
    const payload = {
        business_context: input.businessContext || DEFAULT_BUSINESS_CONTEXT,
        name: input.name,
        phone: input.phone,
        instagram: input.instagram,
        child_name: input.childName,
        child_birthday: input.childBirthday,
        source: input.source,
        notes: input.notes,
        social_identities: input.socialIdentities
    };
    if (options.updatedAt) payload.updated_at = new Date().toISOString();
    return payload;
}

function omitCustomerSocialIdentities(payload) {
    const legacyPayload = { ...payload };
    delete legacyPayload.social_identities;
    return legacyPayload;
}

async function ensureCustomerSocialIdentitiesColumn() {
    if (customerSocialIdentitiesColumnReady) return true;
    try {
        await pool.query(`
            ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS social_identities JSONB NOT NULL DEFAULT '[]'::jsonb
        `);
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'customers_social_identities_array_check'
                ) THEN
                    ALTER TABLE customers
                    ADD CONSTRAINT customers_social_identities_array_check
                    CHECK (jsonb_typeof(social_identities) = 'array');
                END IF;
            END $$;
        `);
        customerSocialIdentitiesColumnReady = true;
        return true;
    } catch (err) {
        log.warn('Unable to ensure customers.social_identities column before write', { error: err.message });
        return false;
    }
}

async function canSearchCustomerSocialIdentities() {
    return await ensureCustomerSocialIdentitiesColumn();
}

async function insertCustomerPg(input, queryable = pool) {
    const params = [
        input.businessContext || DEFAULT_BUSINESS_CONTEXT,
        input.name,
        input.phone,
        input.instagram,
        input.childName,
        input.childBirthday,
        input.source,
        input.notes,
        JSON.stringify(input.socialIdentities)
    ];

    try {
        await ensureCustomerSocialIdentitiesColumn();
        return await queryable.query(
            `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source, notes, social_identities)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING *`,
            params
        );
    } catch (err) {
        if (!isCustomerSocialIdentitiesStorageError(err)) throw err;
        log.warn('customers.social_identities unavailable during create; retrying legacy customer insert', { error: err.message });
        return queryable.query(
            `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            params.slice(0, 8)
        );
    }
}

async function updateCustomerPg(id, input, queryable = pool) {
    const params = [
        input.name,
        input.phone,
        input.instagram,
        input.childName,
        input.childBirthday,
        input.source,
        input.notes,
        JSON.stringify(input.socialIdentities),
        parseInt(id),
        input.businessContext || DEFAULT_BUSINESS_CONTEXT
    ];

    try {
        await ensureCustomerSocialIdentitiesColumn();
        return await queryable.query(
            `UPDATE customers SET name=$1, phone=$2, instagram=$3, child_name=$4,
             child_birthday=$5, source=$6, notes=$7, social_identities=$8::jsonb, updated_at=NOW()
             WHERE id=$9 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $10 RETURNING *`,
            params
        );
    } catch (err) {
        if (!isCustomerSocialIdentitiesStorageError(err)) throw err;
        log.warn('customers.social_identities unavailable during update; retrying legacy customer update', { error: err.message });
        return queryable.query(
            `UPDATE customers SET name=$1, phone=$2, instagram=$3, child_name=$4,
             child_birthday=$5, source=$6, notes=$7, updated_at=NOW()
             WHERE id=$8 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $9 RETURNING *`,
            [...params.slice(0, 7), parseInt(id), input.businessContext || DEFAULT_BUSINESS_CONTEXT]
        );
    }
}

let customerTagColumnCapabilities = null;
let birthdayTagSchemaWarningLogged = false;

async function getCustomerTagColumnCapabilities(queryable = pool) {
    if (customerTagColumnCapabilities) return customerTagColumnCapabilities;
    try {
        const result = await queryable.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'customer_tags'
               AND column_name IN ('source', 'system_key', 'updated_at')`
        );
        const columns = new Set(result.rows.map(row => row.column_name));
        customerTagColumnCapabilities = {
            hasSource: columns.has('source'),
            hasSystemKey: columns.has('system_key'),
            hasUpdatedAt: columns.has('updated_at')
        };
    } catch (err) {
        log.warn('Unable to inspect customer_tags columns; treating tags as manual-only', { error: err.message });
        customerTagColumnCapabilities = { hasSource: false, hasSystemKey: false, hasUpdatedAt: false };
    }
    return customerTagColumnCapabilities;
}

function manualCustomerTagCondition(caps, qualifier = '') {
    const conditions = [];
    const q = qualifier ? `${qualifier}.` : '';
    if (caps?.hasSource) conditions.push(`COALESCE(${q}source, 'manual') = 'manual'`);
    if (caps?.hasSystemKey) conditions.push(`${q}system_key IS NULL`);
    return conditions.length ? conditions.join(' AND ') : 'TRUE';
}

async function syncManualCustomerTags(queryable, customerId, tags, userId) {
    if (!Array.isArray(tags)) return;
    const caps = await getCustomerTagColumnCapabilities(queryable);
    const manualOnly = manualCustomerTagCondition(caps);
    const normalizedTags = normalizeCustomerTagsPayload(tags);
    const tagNames = normalizedTags.map(item => item.tag);
    await queryable.query(
        `DELETE FROM customer_tags
         WHERE customer_id = $1
           AND ${manualOnly}
           AND NOT (tag = ANY($2::text[]))`,
        [customerId, tagNames]
    );
    for (const item of normalizedTags) {
        const columns = ['customer_id', 'tag', 'color', 'created_by'];
        const values = ['$1', '$2', '$3', '$4'];
        const params = [customerId, item.tag, item.color, userId || null];
        if (caps.hasSource) {
            columns.push('source');
            values.push(`$${values.length + 1}`);
            params.push('manual');
        }
        await queryable.query(
            `INSERT INTO customer_tags (${columns.join(', ')})
             VALUES (${values.join(', ')})
             ON CONFLICT (customer_id, tag) DO UPDATE SET color = EXCLUDED.color
             WHERE ${manualCustomerTagCondition(caps, 'customer_tags')}`,
            params
        );
    }
}

async function syncBirthdayTagsAfterCustomerSave(queryable, customerId, userId) {
    const caps = await getCustomerTagColumnCapabilities(queryable);
    if (!caps.hasSource || !caps.hasSystemKey || !caps.hasUpdatedAt) {
        if (!birthdayTagSchemaWarningLogged) {
            birthdayTagSchemaWarningLogged = true;
            log.warn('Skipping birthday system tag sync until customer_tags system columns are available', {
                customerId,
                hasSource: caps.hasSource,
                hasSystemKey: caps.hasSystemKey,
                hasUpdatedAt: caps.hasUpdatedAt
            });
        }
        return { skipped: true, reason: 'customer_tags_system_columns_missing' };
    }
    return syncBirthdayTagsForCustomer(queryable, customerId, { userId });
}

function customerTagSelectFields(caps, qualifier = '') {
    const q = qualifier ? `${qualifier}.` : '';
    return [
        `${q}id`,
        `${q}customer_id`,
        `${q}tag`,
        `${q}color`,
        caps?.hasSource ? `${q}source` : `'manual' AS source`,
        caps?.hasSystemKey ? `${q}system_key` : `NULL AS system_key`
    ].join(', ');
}

function mapCustomerTagRow(row) {
    return {
        id: row.id,
        customer_id: row.customer_id,
        customerId: row.customer_id,
        tag: row.tag,
        color: row.color,
        source: row.source || 'manual',
        systemKey: row.system_key || null
    };
}

async function getCustomerTagsPg(queryable, customerId) {
    const caps = await getCustomerTagColumnCapabilities(queryable);
    const result = await queryable.query(
        `SELECT ${customerTagSelectFields(caps)}
         FROM customer_tags
         WHERE customer_id = $1
         ORDER BY tag ASC`,
        [customerId]
    );
    return result.rows.map(mapCustomerTagRow);
}

function scopedBookingAggregateSql(user, params, alias = 'b') {
    const businessScope = arguments.length >= 4 ? arguments[3] : DEFAULT_BUSINESS_CONTEXT;
    const businessSql = customerScopeCondition(params, businessScope, alias);
    const visibility = getVisibleBookingScope(user, params, alias);
    return {
        visibility,
        sql: `
            SELECT ${alias}.customer_id,
                   COUNT(*) AS booking_count,
                   COALESCE(SUM(${alias}.price), 0) AS booking_spent,
                   MIN(${alias}.date) AS real_first_visit,
                   MAX(${alias}.date) AS real_last_visit
            FROM bookings ${alias}
            WHERE ${alias}.status != 'cancelled'
              AND ${businessSql}
              ${visibility.sql}
            GROUP BY ${alias}.customer_id
        `
    };
}

async function loadCustomerChildrenMap(customerIds = [], businessContext = null, options = {}) {
    const ids = Array.from(new Set((Array.isArray(customerIds) ? customerIds : [])
        .map(id => Number.parseInt(id, 10))
        .filter(id => Number.isInteger(id) && id > 0)));
    if (!ids.length) return new Map();

    const params = [ids];
    const contextSql = businessContext
        ? `AND business_context = $${params.push(businessContext)}`
        : '';

    try {
        const result = await (options.queryable || pool).query(
            `SELECT id, business_context, customer_id, lead_id, booking_id, name, birthday,
                    age_snapshot, note, source_kind, source_payload, sort_order,
                    dietary_tags, dietary_note, created_at, updated_at
             FROM customer_children
             WHERE customer_id = ANY($1::int[])
               ${contextSql}
             ORDER BY customer_id ASC, sort_order ASC, id ASC`,
            params
        );
        const map = new Map();
        for (const row of result.rows || []) {
            const key = Number(row.customer_id);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        }
        return map;
    } catch (err) {
        if (isCustomerChildrenStorageMissing(err)) return new Map();
        throw err;
    }
}

function applyCustomerChildrenProjection(customer, childRows = []) {
    const projection = buildCustomerChildrenProjection(customer, childRows);
    const primary = firstCustomerChild(projection);
    customer.children = projection;
    customer.childName = primary?.name || customer.childName || null;
    customer.childBirthday = primary?.birthday || customer.childBirthday || null;
    customer.childNameDisplay = customerChildrenNameDisplay(projection) || customer.childName || null;
    customer.childBirthdayDisplay = customerChildrenBirthdayDisplay(projection) || customer.childBirthday || null;
    return customer;
}

function customerChildReviewActiveSql(alias = 'cc') {
    return `COALESCE(${alias}.source_payload #>> '{manual_review,superseded}', 'false') <> 'true'`;
}

function customerChildReviewCandidateSql(alias = 'cc') {
    return `(
        ${alias}.source_payload->>'needs_review' = 'true'
        OR ${alias}.source_payload #>> '{manual_review,needs_review}' = 'true'
        OR ${alias}.source_payload->>'age_snapshot_from_name' = 'true'
        OR ${alias}.source_payload->>'birthday_rejected' = 'true'
        OR (
            ${alias}.source_kind = 'legacy_customer_child'
            AND ${alias}.birthday IS NULL
        )
        OR COALESCE(${alias}.source_payload->'source_columns'->>'child_name', ${alias}.name, '') ~ '[,;\\n\\r]'
    )`;
}

function customerChildReviewIssueCodesSql(alias = 'cc') {
    return `ARRAY_REMOVE(ARRAY[
        CASE
            WHEN ${alias}.source_payload->>'needs_review' = 'true'
              OR ${alias}.source_payload #>> '{manual_review,needs_review}' = 'true'
            THEN 'needs_review'
        END,
        CASE WHEN ${alias}.source_payload->>'age_snapshot_from_name' = 'true' THEN 'suspected_age_in_name' END,
        CASE WHEN ${alias}.source_payload->>'birthday_rejected' = 'true' THEN 'birthday_rejected' END,
        CASE
            WHEN ${alias}.source_kind = 'legacy_customer_child' AND ${alias}.birthday IS NULL
            THEN 'birthday_missing'
        END,
        CASE
            WHEN COALESCE(${alias}.source_payload->'source_columns'->>'child_name', ${alias}.name, '') ~ '[,;\\n\\r]'
            THEN 'suspected_multi_child_text'
        END
    ], NULL)`;
}

function mapCustomerChildReviewSource(row = {}) {
    const child = mapCustomerChildRow(row);
    const sourceColumns = child.sourcePayload?.source_columns || child.sourcePayload?.sourceColumns || {};
    return {
        ...child,
        issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
        originalText: sourceColumns.child_name ?? child.sourcePayload?.child_name ?? child.name ?? null,
        originalBirthday: sourceColumns.child_birthday ?? child.sourcePayload?.child_birthday ?? child.birthday ?? null,
        originalSourceTable: child.sourcePayload?.source_table || null,
        copyRule: child.sourcePayload?.copy_rule || null
    };
}

function groupCustomerChildReviewRows(rows = []) {
    const grouped = new Map();
    for (const row of rows) {
        const customerId = Number(row.customer_id);
        if (!grouped.has(customerId)) {
            grouped.set(customerId, {
                customerId,
                businessContext: row.customer_business_context || row.business_context || DEFAULT_BUSINESS_CONTEXT,
                name: row.customer_name || null,
                phone: row.customer_phone || null,
                instagram: row.customer_instagram || null,
                childName: row.customer_child_name || null,
                childBirthday: row.customer_child_birthday || null,
                sources: []
            });
        }
        grouped.get(customerId).sources.push(mapCustomerChildReviewSource(row));
    }
    return Array.from(grouped.values()).map(item => ({
        ...item,
        issueCodes: Array.from(new Set(item.sources.flatMap(source => source.issueCodes || []))),
        sourceChildIds: item.sources.map(source => source.id).filter(Boolean)
    }));
}

function csvCell(value) {
    const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function customerChildrenReviewCsv(items = []) {
    const headers = [
        'customer_id',
        'business_context',
        'customer_name',
        'phone',
        'instagram',
        'source_child_id',
        'issue_codes',
        'original_text',
        'original_birthday',
        'current_name',
        'current_birthday',
        'age_snapshot',
        'source_kind',
        'source_payload_json'
    ];
    const rows = [];
    for (const item of items) {
        for (const source of item.sources || []) {
            rows.push([
                item.customerId,
                item.businessContext,
                item.name,
                item.phone,
                item.instagram,
                source.id,
                source.issueCodes || [],
                source.originalText,
                source.originalBirthday,
                source.name,
                source.birthday,
                source.ageSnapshot,
                source.sourceKind,
                JSON.stringify(source.sourcePayload || {})
            ]);
        }
    }
    return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

function customerChildrenSearchSql(patternRef, alias = 'c') {
    return `EXISTS (
        SELECT 1
        FROM customer_children cc_search
        WHERE cc_search.customer_id = ${alias}.id
          AND cc_search.business_context = COALESCE(${alias}.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
          AND cc_search.name ILIKE ${patternRef}
    )`;
}

async function queryUpcomingBirthdayRows(businessContext, days) {
    const params = [];
    const contextSql = customerContextCondition(params, businessContext, 'c');
    const birthdaySourceSql = `
        WITH birthday_sources AS (
            SELECT c.id, c.name AS parent_name, c.phone,
                   cc.name AS child_name, cc.birthday AS child_birthday
              FROM customers c
              JOIN customer_children cc
                ON cc.customer_id = c.id
               AND cc.business_context = COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
             WHERE cc.birthday IS NOT NULL
               AND ${contextSql}
            UNION ALL
            SELECT c.id, c.name AS parent_name, c.phone,
                   c.child_name, c.child_birthday
              FROM customers c
             WHERE c.child_birthday IS NOT NULL
               AND ${contextSql}
               AND NOT EXISTS (
                   SELECT 1
                     FROM customer_children cc_existing
                    WHERE cc_existing.customer_id = c.id
                      AND cc_existing.business_context = COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
                      AND cc_existing.birthday IS NOT NULL
               )
        )
        SELECT *,
               CASE
                   WHEN TO_CHAR(child_birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
                   THEN (TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || TO_CHAR(child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                   ELSE (TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text || '-' || TO_CHAR(child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
               END AS days_until_birthday
          FROM birthday_sources
         ORDER BY days_until_birthday ASC, parent_name ASC, child_name ASC
    `;

    try {
        const result = await pool.query(birthdaySourceSql, params);
        return result.rows;
    } catch (err) {
        if (!isCustomerChildrenStorageMissing(err)) throw err;
    }

    const legacyParams = [];
    const legacyContextSql = customerContextCondition(legacyParams, businessContext, 'c');
    const legacyResult = await pool.query(`
        SELECT c.id, c.name AS parent_name, c.phone,
               c.child_name, c.child_birthday,
               CASE
                   WHEN TO_CHAR(c.child_birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
                   THEN (TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                   ELSE (TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
               END AS days_until_birthday
        FROM customers c
        WHERE c.child_birthday IS NOT NULL
          AND ${legacyContextSql}
        ORDER BY days_until_birthday ASC
    `, legacyParams);
    return legacyResult.rows;
}

// Children manual review: list/export ambiguous legacy child rows without changing data.
router.get('/children-review', requireRole('manager', 'admin'), requireChildrenReviewExport, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;

        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const result = await pool.query(
            `SELECT
                    c.id AS customer_id,
                    COALESCE(c.business_context, $1) AS customer_business_context,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    c.instagram AS customer_instagram,
                    c.child_name AS customer_child_name,
                    c.child_birthday AS customer_child_birthday,
                    cc.id,
                    cc.business_context,
                    cc.customer_id,
                    cc.lead_id,
                    cc.booking_id,
                    cc.name,
                    cc.birthday,
                    cc.age_snapshot,
                    cc.note,
                    cc.source_kind,
                    cc.source_payload,
                    cc.sort_order,
                    cc.dietary_tags,
                    cc.dietary_note,
                    cc.created_at,
                    cc.updated_at,
                    ${customerChildReviewIssueCodesSql('cc')} AS issue_codes
             FROM customer_children cc
             JOIN customers c
               ON c.id = cc.customer_id
              AND COALESCE(c.business_context, $1) = cc.business_context
             WHERE cc.business_context = $1
               AND ${customerChildReviewActiveSql('cc')}
               AND ${customerChildReviewCandidateSql('cc')}
             ORDER BY c.id ASC, cc.sort_order ASC, cc.id ASC
             LIMIT $2`,
            [businessContext, limit]
        );

        const items = groupCustomerChildReviewRows(result.rows);
        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="customer_children_review_${new Date().toISOString().slice(0, 10)}.csv"`);
            return res.send(customerChildrenReviewCsv(items));
        }

        res.json({
            success: true,
            businessContext,
            count: items.length,
            sourceRows: result.rows.length,
            items
        });
    } catch (err) {
        log.error('Customer children review list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/children-review/:customerId/resolve', requireRole('manager', 'admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const customerId = parseInt(req.params.customerId, 10);
        if (!Number.isInteger(customerId) || customerId <= 0) {
            return res.status(400).json({ error: 'Invalid customer ID' });
        }

        let children;
        try {
            if (!Array.isArray(req.body?.children)) {
                return res.status(400).json({ error: 'children must be an array' });
            }
            children = req.body.children
                .map((child, index) => normalizeChildInput(child, index, { requireName: true }))
                .filter(Boolean);
        } catch (err) {
            if (err instanceof CustomerChildrenError) {
                return res.status(err.status || 400).json({ error: err.message, code: err.code, details: err.details });
            }
            throw err;
        }

        if (!children.length) {
            return res.status(400).json({ error: 'At least one child is required' });
        }

        const sourceChildIds = Array.isArray(req.body?.sourceChildIds)
            ? Array.from(new Set(req.body.sourceChildIds
                .map(value => Number(value))
                .filter(value => Number.isInteger(value) && value > 0)))
            : [];
        const reviewNote = cleanText(req.body?.reviewNote || req.body?.note);
        const reviewedAt = new Date().toISOString();
        const reviewedBy = req.user?.id || null;

        await client.query('BEGIN');

        const customerResult = await client.query(
            `SELECT *
             FROM customers
             WHERE id = $1
               AND COALESCE(business_context, $2) = $2
             FOR UPDATE`,
            [customerId, businessContext]
        );
        if (!customerResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клієнта не знайдено' });
        }

        const sourceParams = [customerId, businessContext];
        let sourceFilter = `AND ${customerChildReviewActiveSql('cc')} AND ${customerChildReviewCandidateSql('cc')}`;
        if (sourceChildIds.length) {
            sourceParams.push(sourceChildIds);
            sourceFilter = `AND cc.id = ANY($3::bigint[]) AND ${customerChildReviewActiveSql('cc')} AND ${customerChildReviewCandidateSql('cc')}`;
        }
        const sourceResult = await client.query(
            `SELECT id, business_context, customer_id, lead_id, booking_id, name, birthday,
                    age_snapshot, note, source_kind, source_payload, sort_order,
                    dietary_tags, dietary_note, created_at, updated_at,
                    ${customerChildReviewIssueCodesSql('cc')} AS issue_codes
             FROM customer_children cc
             WHERE cc.customer_id = $1
               AND cc.business_context = $2
               ${sourceFilter}
             ORDER BY cc.sort_order ASC, cc.id ASC
             FOR UPDATE`,
            sourceParams
        );

        if (!sourceResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Немає активних записів дітей для ручної ревізії' });
        }

        const resolvedSourceIds = sourceResult.rows.map(row => Number(row.id));
        const supersedePayload = {
            status: 'superseded',
            superseded: true,
            superseded_at: reviewedAt,
            superseded_by: reviewedBy,
            reason: 'manual_review_replaced'
        };
        await client.query(
            `UPDATE customer_children
             SET source_payload = jsonb_set(
                     source_payload,
                     '{manual_review}',
                     COALESCE(source_payload->'manual_review', '{}'::jsonb) || $3::jsonb,
                     true
                 ),
                 updated_at = NOW()
             WHERE customer_id = $1
               AND business_context = $2
               AND source_kind = 'manual_review'
               AND ${customerChildReviewActiveSql('customer_children')}`,
            [customerId, businessContext, JSON.stringify(supersedePayload)]
        );

        const sourceReviewPayload = {
            status: 'resolved',
            superseded: true,
            resolved_at: reviewedAt,
            resolved_by: reviewedBy,
            replacement_count: children.length,
            review_note: reviewNote,
            original_preserved: true
        };
        await client.query(
            `UPDATE customer_children
             SET source_payload = jsonb_set(
                     source_payload,
                     '{manual_review}',
                     COALESCE(source_payload->'manual_review', '{}'::jsonb) || $3::jsonb,
                     true
                 ),
                 updated_at = NOW()
             WHERE id = ANY($1::bigint[])
               AND business_context = $2`,
            [resolvedSourceIds, businessContext, JSON.stringify(sourceReviewPayload)]
        );

        for (const [index, child] of children.entries()) {
            await client.query(
                `INSERT INTO customer_children (
                    business_context, customer_id, lead_id, booking_id, name, birthday, age_snapshot, note,
                    source_kind, source_payload, sort_order, dietary_tags, dietary_note
                 )
                 VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, 'manual_review', $7::jsonb, $8, $9::text[], $10)`,
                [
                    businessContext,
                    customerId,
                    child.name,
                    child.birthday,
                    child.ageSnapshot,
                    child.note,
                    JSON.stringify({
                        source: 'customer_children_manual_review',
                        copy_rule: 'manual_review_resolution',
                        reviewed_at: reviewedAt,
                        reviewed_by: reviewedBy,
                        review_note: reviewNote,
                        source_child_ids: resolvedSourceIds,
                        input_index: index,
                        original_preserved_in_source_rows: true
                    }),
                    100 + index,
                    child.dietaryTags,
                    child.dietaryNote
                ]
            );
        }

        await syncBirthdayTagsAfterCustomerSave(client, customerId, reviewedBy);
        const savedChildren = await listCustomerChildren(customerId, businessContext, { client });
        const customer = applyCustomerChildrenProjection(mapCustomerRow(customerResult.rows[0]), savedChildren);
        await client.query('COMMIT');

        res.json({
            success: true,
            customer,
            resolvedSourceChildIds: resolvedSourceIds,
            children: customer.children || []
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err instanceof CustomerChildrenError) {
            return res.status(err.status || 400).json({ error: err.message, code: err.code, details: err.details });
        }
        log.error('Customer children review resolve error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Autocomplete search (for booking form dropdown)
router.get('/search', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json([]);

        const searchQuery = buildCustomerSearchQuery({
            query: q,
            businessContext,
            user: req.user,
            includeSocialIdentities: await canSearchCustomerSocialIdentities()
        });
        if (!searchQuery) return res.json([]);

        const result = await pool.query(searchQuery.sql, searchQuery.params);
        const childrenMap = await loadCustomerChildrenMap(result.rows.map(row => row.id), businessContext);
        res.json(result.rows.map(row => applyCustomerChildrenProjection(
            mapCustomerRow(row),
            childrenMap.get(Number(row.id)) || []
        )));
    } catch (err) {
        log.error('Customer search error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v15.1: RFM analytics
router.get('/rfm', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        let rows;
        // v32.1: JOIN bookings for real totals
        const params = [];
        const bookingAgg = scopedBookingAggregateSql(req.user, params, 'b', businessContext);
        const contextSql = customerContextCondition(params, businessContext, 'c');
        const result = await pool.query(`
            SELECT c.id, c.name, c.phone, c.instagram, c.child_name,
                   COALESCE(b.cnt, 0) AS total_bookings,
                   COALESCE(b.spent, 0) AS total_spent,
                   b.first_visit, b.last_visit,
                   c.created_at, c.updated_at
            FROM customers c
            LEFT JOIN (
                SELECT customer_id, booking_count AS cnt, booking_spent AS spent,
                       real_first_visit AS first_visit, real_last_visit AS last_visit
                FROM (${bookingAgg.sql}) scoped_bookings
            ) b ON b.customer_id = c.id
            WHERE ${contextSql}
            ORDER BY b.last_visit DESC NULLS LAST
        `, params);
        rows = result.rows;

        const today = new Date();
        const customers = rows.map(row => {
            const c = mapCustomerRow(row);
            let recencyDays = null;
            if (c.lastVisit) {
                const lastDate = new Date(c.lastVisit);
                recencyDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
            }
            const frequency = c.totalBookings || 0;
            const monetary = c.totalSpent || 0;
            return { ...c, recencyDays, frequency, monetary };
        });

        const withScores = calculateRFMScores(customers);
        const segments = { champions: 0, loyal: 0, potential: 0, atRisk: 0, lost: 0 };
        for (const c of withScores) {
            if (c.rfmSegment === 'champion') segments.champions++;
            else if (c.rfmSegment === 'loyal') segments.loyal++;
            else if (c.rfmSegment === 'potential') segments.potential++;
            else if (c.rfmSegment === 'at_risk') segments.atRisk++;
            else segments.lost++;
        }

        const payload = { customers: withScores, total: withScores.length };
        if (canUseAction(req.user, 'view_revenue')) {
            payload.segments = segments;
        }

        res.json(payload);
    } catch (err) {
        log.error('RFM analytics error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v32.1: Customer segments (simplified from RFM)
router.get('/segments', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const now = new Date();
        const threeMonthsAgo = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const params = [threeMonthsAgo, oneMonthAgo];
        const bookingAgg = scopedBookingAggregateSql(req.user, params, 'b', businessContext);
        const contextSql = customerContextCondition(params, businessContext, 'c');

        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE b.last_visit >= $1) AS active,
                COUNT(*) FILTER (WHERE b.last_visit < $1 OR b.last_visit IS NULL) AS sleeping,
                COUNT(*) FILTER (WHERE c.created_at >= $2::timestamp) AS new,
                COUNT(*) FILTER (WHERE COALESCE(b.spent, 0) >= 10000) AS vip
            FROM customers c
            LEFT JOIN (
                SELECT customer_id, real_last_visit AS last_visit, booking_spent AS spent
                FROM (${bookingAgg.sql}) scoped_bookings
            ) b ON b.customer_id = c.id
            WHERE ${contextSql}
        `, params);

        const row = result.rows[0];
        const canViewRevenue = canUseAction(req.user, 'view_revenue');
        res.json({
            success: true,
            segments: {
                active: parseInt(row.active) || 0,
                sleeping: parseInt(row.sleeping) || 0,
                new: parseInt(row.new) || 0,
                ...(canViewRevenue ? { vip: parseInt(row.vip) || 0 } : {})
            }
        });
    } catch (err) {
        log.error('Customer segments error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v32.1: Upcoming birthdays (next N days)
router.get('/birthdays', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
        const rows = await queryUpcomingBirthdayRows(businessContext, days);

        const filtered = rows
            .filter(r => parseInt(r.days_until_birthday) >= 0 && parseInt(r.days_until_birthday) <= days)
            .map(r => ({
                id: r.id,
                parentName: r.parent_name,
                phone: r.phone,
                childName: r.child_name,
                childBirthday: r.child_birthday,
                daysUntilBirthday: parseInt(r.days_until_birthday)
            }));

        res.json({ success: true, birthdays: filtered });
    } catch (err) {
        log.error('Birthdays error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v15.1: CSV export — v19.14: rate limited
router.get('/export', requireAction('export_data'), requireAction('view_revenue'), exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        let customerRows;
        const params = [];
        const contextSql = customerContextCondition(params, businessContext);
        const result = await pool.query(`SELECT * FROM customers WHERE ${contextSql} ORDER BY name LIMIT 5000`, params);
        customerRows = result.rows;
        const childrenMap = await loadCustomerChildrenMap(customerRows.map(row => row.id), businessContext);
        const projectedCustomers = customerRows.map(row => applyCustomerChildrenProjection(
            mapCustomerRow(row),
            childrenMap.get(Number(row.id)) || []
        ));

        // Get cert counts from PostgreSQL
        const certResult = await pool.query(
            'SELECT customer_id, COUNT(*) AS cnt FROM certificates GROUP BY customer_id'
        );
        const certMap = {};
        for (const r of certResult.rows) certMap[r.customer_id] = parseInt(r.cnt);

        const BOM = '\uFEFF';
        const header = [
            'ID', "Ім'я", 'Телефон', 'Instagram', 'Соц. ідентичності', 'Діти',
            'ДН дітей', 'Джерело', 'Нотатки', 'Бронювань',
            'Витрачено (грн)', 'Перший візит', 'Останній візит',
            'Сертифікатів', 'Створено'
        ].join(';');

        const rows = customerRows.map((r, index) => {
            const projected = projectedCustomers[index] || {};
            return [
                r.id,
                escapeCsv(r.name),
                escapeCsv(r.phone || ''),
                escapeCsv(r.instagram || ''),
                escapeCsv(formatSocialIdentities(r.social_identities, { instagram: r.instagram })),
                escapeCsv(projected.childNameDisplay || ''),
                escapeCsv(projected.childBirthdayDisplay || ''),
                escapeCsv(getCustomerSourceLabel(r.source)),
                escapeCsv(r.notes || ''),
                r.total_bookings || 0,
                r.total_spent || 0,
                r.first_visit ? formatDate(r.first_visit) : '',
                r.last_visit ? formatDate(r.last_visit) : '',
                certMap[r.id] || 0,
                r.created_at ? formatDate(r.created_at) : ''
            ].join(';');
        });

        const csv = BOM + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csv);
    } catch (err) {
        log.error('Customer export error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v17.0: Excel export — v19.14: rate limited
router.get('/export-xlsx', requireAction('export_data'), requireAction('view_revenue'), exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        let customerRows;
        const params = [];
        const contextSql = customerContextCondition(params, businessContext);
        const result = await pool.query(`SELECT * FROM customers WHERE ${contextSql} ORDER BY name LIMIT 5000`, params);
        customerRows = result.rows;
        const childrenMap = await loadCustomerChildrenMap(customerRows.map(row => row.id), businessContext);
        const projectedCustomers = customerRows.map(row => applyCustomerChildrenProjection(
            mapCustomerRow(row),
            childrenMap.get(Number(row.id)) || []
        ));

        const certResult = await pool.query(
            'SELECT customer_id, COUNT(*) AS cnt FROM certificates GROUP BY customer_id'
        );
        const certMap = {};
        for (const r of certResult.rows) certMap[r.customer_id] = parseInt(r.cnt);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Event Genix';
        const sheet = workbook.addWorksheet('Клієнти');

        sheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: "Ім'я", key: 'name', width: 22 },
            { header: 'Телефон', key: 'phone', width: 16 },
            { header: 'Instagram', key: 'instagram', width: 18 },
            { header: 'Соц. ідентичності', key: 'socialIdentities', width: 28 },
            { header: 'Діти', key: 'childName', width: 28 },
            { header: 'ДН дітей', key: 'childBday', width: 24 },
            { header: 'Джерело', key: 'source', width: 14 },
            { header: 'Бронювань', key: 'bookings', width: 12 },
            { header: 'Витрачено (₴)', key: 'spent', width: 14 },
            { header: 'Перший візит', key: 'firstVisit', width: 14 },
            { header: 'Останній візит', key: 'lastVisit', width: 14 },
            { header: 'Сертифікатів', key: 'certs', width: 12 },
            { header: 'Нотатки', key: 'notes', width: 24 }
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

        for (const [index, r] of customerRows.entries()) {
            const projected = projectedCustomers[index] || {};
            sheet.addRow({
                id: r.id,
                name: r.name || '',
                phone: r.phone || '',
                instagram: r.instagram || '',
                socialIdentities: formatSocialIdentities(r.social_identities, { instagram: r.instagram }),
                childName: projected.childNameDisplay || '',
                childBday: projected.childBirthdayDisplay || '',
                source: getCustomerSourceLabel(r.source),
                bookings: r.total_bookings || 0,
                spent: r.total_spent || 0,
                firstVisit: r.first_visit || '',
                lastVisit: r.last_visit || '',
                certs: certMap[r.id] || 0,
                notes: r.notes || ''
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        log.error('Customer export-xlsx error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v15.1: Stats overview
router.get('/stats', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;

        // PostgreSQL: JOIN bookings for real stats
        const canViewRevenue = canUseAction(req.user, 'view_revenue');
        const totalParams = [];
        const totalContextSql = customerContextCondition(totalParams, businessContext);
        const totalResult = await pool.query(`SELECT COUNT(*) FROM customers WHERE ${totalContextSql}`, totalParams);
        const sourceExpr = customerSourceSqlExpression('source');
        const sourceResult = await pool.query(
            `SELECT ${sourceExpr} AS source, COUNT(*) AS count
             FROM customers WHERE ${totalContextSql} GROUP BY ${sourceExpr} ORDER BY count DESC`,
            totalParams
        );
        const topResult = canViewRevenue ? await pool.query(
            `SELECT c.id, c.name,
                    COALESCE(b.cnt, 0) AS total_bookings,
                    COALESCE(b.spent, 0) AS total_spent,
                    b.last_visit
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent, MAX(date) AS last_visit
                 FROM bookings WHERE status != 'cancelled' AND COALESCE(business_context, 'event_genix') = $1 GROUP BY customer_id
             ) b ON b.customer_id = c.id
             WHERE ${totalContextSql}
             ORDER BY COALESCE(b.spent, 0) DESC LIMIT 5`
            , totalParams) : { rows: [] };
        const recentSpendProjection = canViewRevenue
            ? 'COALESCE(b.spent, 0) AS total_spent,'
            : '';
        const recentSpendAggregation = canViewRevenue
            ? ', COALESCE(SUM(price),0) AS spent'
            : '';
        const recentResult = await pool.query(
            `SELECT c.id, c.name,
                    COALESCE(b.cnt, 0) AS total_bookings,
                    ${recentSpendProjection}
                    c.created_at
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id, COUNT(*) AS cnt${recentSpendAggregation}
                 FROM bookings WHERE status != 'cancelled' AND COALESCE(business_context, 'event_genix') = $1 GROUP BY customer_id
             ) b ON b.customer_id = c.id
             WHERE ${totalContextSql}
             ORDER BY c.created_at DESC LIMIT 5`
            , totalParams);
        const avgSpendProjection = canViewRevenue
            ? ', ROUND(AVG(b.spent), 0) AS avg_spent'
            : '';
        const avgSpendAggregation = canViewRevenue
            ? ', COALESCE(SUM(price),0) AS spent'
            : '';
        const avgResult = await pool.query(
            `SELECT ROUND(AVG(b.cnt), 1) AS avg_bookings${avgSpendProjection}
             FROM customers c
             INNER JOIN (
                 SELECT customer_id, COUNT(*) AS cnt${avgSpendAggregation}
                 FROM bookings WHERE status != 'cancelled' AND COALESCE(business_context, 'event_genix') = $1 GROUP BY customer_id
             ) b ON b.customer_id = c.id
             WHERE ${totalContextSql}`
            , totalParams);

        res.json({
            total: parseInt(totalResult.rows[0].count),
            bySource: sourceResult.rows.map(r => ({ source: r.source, count: parseInt(r.count) })),
            topBySpent: topResult.rows.map(mapCustomerRow),
            recentCustomers: recentResult.rows.map(mapCustomerRow),
            averages: avgResult.rows[0] || {
                avg_bookings: 0,
                ...(canViewRevenue ? { avg_spent: 0 } : {})
            }
        });
    } catch (err) {
        log.error('Customer stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: TAGS
// ==========================================

// List all unique tags (for filter dropdown)
router.get('/tags', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const caps = await getCustomerTagColumnCapabilities(pool);
        const result = await pool.query(
            `SELECT tag, color, COUNT(*) AS count
             FROM customer_tags ct
             JOIN customers c ON c.id = ct.customer_id
             WHERE ct.customer_id IS NOT NULL
               AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
             GROUP BY tag, color ORDER BY count DESC`,
            [businessContext]
        );
        res.json({
            success: true,
            tags: result.rows,
            predefined: PREDEFINED_TAGS,
            capabilities: {
                source: caps.hasSource,
                systemKey: caps.hasSystemKey,
                updatedAt: caps.hasUpdatedAt,
                systemTags: caps.hasSource && caps.hasSystemKey && caps.hasUpdatedAt
            }
        });
    } catch (err) {
        log.error('GET /tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add tag to customer
router.post('/:id/tags', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const customerId = parseInt(req.params.id);
        const { tag, color } = req.body;
        if (!tag || !tag.trim()) return res.status(400).json({ error: 'Тег обовʼязковий' });
        const customer = await pool.query(
            `SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2 LIMIT 1`,
            [customerId, businessContext]
        );
        if (!customer.rows.length) return res.status(404).json({ error: 'РљР»С–С”РЅС‚Р° РЅРµ Р·РЅР°Р№РґРµРЅРѕ' });
        const tagColor = color || PREDEFINED_TAGS.find(p => p.tag === tag.trim())?.color || '#6B7280';
        const result = await pool.query(
            `INSERT INTO customer_tags (customer_id, tag, color, created_by)
             VALUES ($1, $2, $3, $4) ON CONFLICT (customer_id, tag) DO NOTHING RETURNING *`,
            [customerId, tag.trim(), tagColor, req.user?.id || null]
        );
        if (result.rows.length === 0) return res.json({ success: true, message: 'Тег вже існує' });
        res.json({ success: true, tag: result.rows[0] });
    } catch (err) {
        log.error('POST /:id/tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove tag from customer
router.delete('/:id/tags/:tagId', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        await pool.query(
            `DELETE FROM customer_tags ct
             USING customers c
             WHERE ct.id = $1
               AND ct.customer_id = $2
               AND c.id = ct.customer_id
               AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3`,
            [parseInt(req.params.tagId), parseInt(req.params.id), businessContext]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /:id/tags error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: DUPLICATES + MERGE
// ==========================================

router.get('/duplicates', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(`
            SELECT c1.id AS id1, c1.name AS name1, c1.phone AS phone1, c1.instagram AS ig1,
                   c1.total_bookings AS bookings1, c1.total_spent AS spent1,
                   c2.id AS id2, c2.name AS name2, c2.phone AS phone2, c2.instagram AS ig2,
                   c2.total_bookings AS bookings2, c2.total_spent AS spent2,
                   CASE
                     WHEN c1.phone IS NOT NULL AND c1.phone != '' AND LOWER(TRIM(c1.phone)) = LOWER(TRIM(c2.phone)) THEN 'phone'
                     WHEN c1.instagram IS NOT NULL AND c1.instagram != '' AND LOWER(TRIM(c1.instagram)) = LOWER(TRIM(c2.instagram)) THEN 'instagram'
                   END AS match_type
            FROM customers c1
            JOIN customers c2 ON c1.id < c2.id
            WHERE COALESCE(c1.business_context, 'event_genix') = $1
              AND COALESCE(c2.business_context, 'event_genix') = $1
              AND (
                (c1.phone IS NOT NULL AND c1.phone != '' AND LOWER(TRIM(c1.phone)) = LOWER(TRIM(c2.phone)))
                OR (c1.instagram IS NOT NULL AND c1.instagram != '' AND LOWER(TRIM(c1.instagram)) = LOWER(TRIM(c2.instagram)))
              )
            ORDER BY c1.id
            LIMIT 100
        `, [businessContext]);
        res.json({ success: true, duplicates: result.rows, count: result.rows.length });
    } catch (err) {
        log.error('GET /duplicates error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:primaryId/merge', requireMinRole('manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const primaryId = parseInt(req.params.primaryId);
        const { duplicateId } = req.body;
        if (!duplicateId) return res.status(400).json({ error: 'duplicateId обовʼязковий' });
        const dupId = parseInt(duplicateId);
        if (primaryId === dupId) return res.status(400).json({ error: 'Не можна обʼєднати з собою' });

        await client.query('BEGIN');

        // Check both exist
        const [p, d] = await Promise.all([
            client.query("SELECT * FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2", [primaryId, businessContext]),
            client.query("SELECT * FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2", [dupId, businessContext])
        ]);
        if (p.rows.length === 0 || d.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клієнт не знайдений' });
        }
        const primary = p.rows[0];
        const dup = d.rows[0];

        // Move bookings, certificates, tags, communication logs
        await client.query("UPDATE bookings SET customer_id = $1 WHERE customer_id = $2 AND COALESCE(business_context, 'event_genix') = $3", [primaryId, dupId, businessContext]);
        await client.query('UPDATE certificates SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});
        await client.query('DELETE FROM customer_tags WHERE customer_id = $1 AND tag IN (SELECT tag FROM customer_tags WHERE customer_id = $2)', [dupId, primaryId]).catch(() => {});
        await client.query('UPDATE customer_tags SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});
        await client.query('UPDATE communication_log SET customer_id = $1 WHERE customer_id = $2', [primaryId, dupId]).catch(() => {});
        await client.query(
            `UPDATE customer_children
             SET customer_id = $1, updated_at = NOW()
             WHERE customer_id = $2
               AND business_context = $3`,
            [primaryId, dupId, businessContext]
        ).catch(() => {});

        // Merge missing fields
        const updates = [];
        const params = [];
        if (!primary.phone && dup.phone) { params.push(dup.phone); updates.push(`phone = $${params.length}`); }
        if (!primary.instagram && dup.instagram) { params.push(dup.instagram); updates.push(`instagram = $${params.length}`); }
        if (!primary.child_name && dup.child_name) { params.push(dup.child_name); updates.push(`child_name = $${params.length}`); }
        if (!primary.child_birthday && dup.child_birthday) { params.push(dup.child_birthday); updates.push(`child_birthday = $${params.length}`); }

        // Recalculate aggregates
        const aggResult = await client.query(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total,
                    MIN(date) AS first, MAX(date) AS last
             FROM bookings
             WHERE customer_id = $1
               AND linked_to IS NULL
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [primaryId, businessContext]
        );
        const agg = aggResult.rows[0];
        params.push(parseInt(agg.cnt)); updates.push(`total_bookings = $${params.length}`);
        params.push(parseInt(agg.total)); updates.push(`total_spent = $${params.length}`);
        if (agg.first) { params.push(agg.first); updates.push(`first_visit = $${params.length}`); }
        if (agg.last) { params.push(agg.last); updates.push(`last_visit = $${params.length}`); }

        if (updates.length > 0) {
            params.push(primaryId);
            params.push(businessContext);
            await client.query(
                `UPDATE customers SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE id = $${params.length - 1}
                   AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $${params.length}`,
                params
            );
        }

        // Delete duplicate
        await client.query(
            `DELETE FROM customers
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [dupId, businessContext]
        );
        await client.query('COMMIT');

        log.info(`Merged customer ${dupId} into ${primaryId} by ${req.user?.username}`);
        res.json({ success: true, primaryId, deletedId: dupId });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /:id/merge error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ==========================================
// v30.4: CUSTOMER JOURNEY FUNNEL
// ==========================================

router.get('/journey-stats', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE total_bookings = 0) AS prospects,
                COUNT(*) FILTER (WHERE total_bookings = 1) AS first_timers,
                COUNT(*) FILTER (WHERE total_bookings BETWEEN 2 AND 4) AS returning,
                COUNT(*) FILTER (WHERE total_bookings >= 5) AS loyal
            FROM customers
            WHERE COALESCE(business_context, 'event_genix') = $1
        `, [businessContext]);
        const leadsResult = await pool.query(
            "SELECT COUNT(*) AS cnt FROM leads WHERE status = 'new' AND COALESCE(business_context, 'event_genix') = $1",
            [businessContext]
        );
        const stats = result.rows[0];
        stats.leads = parseInt(leadsResult.rows[0].cnt);
        res.json({ success: true, stats });
    } catch (err) {
        log.error('GET /journey-stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: LTV
// ==========================================

router.get('/ltv', requireAction('view_revenue'), async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(`
            SELECT id, name, phone, total_bookings, total_spent, first_visit, last_visit
            FROM customers WHERE total_bookings > 0 AND COALESCE(business_context, 'event_genix') = $1
            ORDER BY total_spent DESC LIMIT 100
        `, [businessContext]);
        const customers = result.rows.map(r => {
            const c = mapCustomerRow(r);
            c.ltv = calculateLTV(r);
            return c;
        });
        res.json({ success: true, customers });
    } catch (err) {
        log.error('GET /ltv error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: NPS STATS
// ==========================================

router.get('/nps-stats', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const summaryParams = [];
        const distParams = [];
        const recentParams = [];
        const sentParams = [];
        const legacySummaryParams = [];
        const legacyDistParams = [];
        const legacyRecentParams = [];
        const summaryScopeSql = customerScopeCondition(summaryParams, businessScope, 'er');
        const distScopeSql = customerScopeCondition(distParams, businessScope, 'er');
        const recentScopeSql = customerScopeCondition(recentParams, businessScope, 'er');
        const sentScopeSql = customerScopeCondition(sentParams, businessScope, 'b');
        const legacySummaryScopeSql = customerScopeCondition(legacySummaryParams, businessScope, 'er');
        const legacyDistScopeSql = customerScopeCondition(legacyDistParams, businessScope, 'er');
        const legacyRecentScopeSql = customerScopeCondition(legacyRecentParams, businessScope, 'er');
        const [summaryResult, distResult, recentResult, sentResult, legacySummaryResult, legacyDistResult, legacyRecentResult] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS total_responses,
                        COUNT(*) FILTER (WHERE er.nps_score >= 9)::int AS promoters,
                        COUNT(*) FILTER (WHERE er.nps_score BETWEEN 7 AND 8)::int AS passives,
                        COUNT(*) FILTER (WHERE er.nps_score BETWEEN 0 AND 6)::int AS detractors
                 FROM event_reviews er
                 WHERE ${summaryScopeSql}
                   AND er.nps_score IS NOT NULL`,
                summaryParams
            ),
            pool.query(
                `SELECT er.nps_score::int AS score, COUNT(*)::int AS count
                 FROM event_reviews er
                 WHERE ${distScopeSql}
                   AND er.nps_score IS NOT NULL
                 GROUP BY er.nps_score
                 ORDER BY er.nps_score`,
                distParams
            ),
            pool.query(
                `SELECT er.id, er.booking_id, er.customer_id, er.customer_name, er.telegram_chat_id,
                        er.nps_score, er.comment, er.created_at, b.program_name, b.date
                 FROM event_reviews er
                 LEFT JOIN bookings b ON b.id = er.booking_id
                    AND COALESCE(b.business_context, 'event_genix') = COALESCE(er.business_context, 'event_genix')
                 WHERE ${recentScopeSql}
                   AND er.nps_score IS NOT NULL
                 ORDER BY er.created_at DESC
                 LIMIT 20`,
                recentParams
            ),
            pool.query(
                `SELECT COUNT(*)::int AS sent_count
                 FROM bookings b
                 WHERE ${sentScopeSql}
                   AND b.nps_sent_at IS NOT NULL`,
                sentParams
            ),
            pool.query(
                `SELECT COUNT(er.rating)::int AS total,
                        COALESCE(AVG(er.rating), 0)::numeric(3,1) AS avg_rating
                 FROM event_reviews er
                 WHERE ${legacySummaryScopeSql}
                   AND er.rating IS NOT NULL`,
                legacySummaryParams
            ),
            pool.query(
                `SELECT er.rating::int AS rating, COUNT(*)::int AS count
                 FROM event_reviews er
                 WHERE ${legacyDistScopeSql}
                   AND er.rating IS NOT NULL
                 GROUP BY er.rating
                 ORDER BY er.rating`,
                legacyDistParams
            ),
            pool.query(
                `SELECT er.id, er.booking_id, er.customer_id, er.customer_name, er.telegram_chat_id,
                        er.rating, er.comment, er.created_at, b.program_name, b.date
                 FROM event_reviews er
                 LEFT JOIN bookings b ON b.id = er.booking_id
                    AND COALESCE(b.business_context, 'event_genix') = COALESCE(er.business_context, 'event_genix')
                 WHERE ${legacyRecentScopeSql}
                   AND er.rating IS NOT NULL
                 ORDER BY er.created_at DESC
                 LIMIT 20`,
                legacyRecentParams
            )
        ]);

        const summary = summaryResult.rows[0] || {};
        const totalResponses = parseInt(summary.total_responses, 10) || 0;
        const promoters = parseInt(summary.promoters, 10) || 0;
        const passives = parseInt(summary.passives, 10) || 0;
        const detractors = parseInt(summary.detractors, 10) || 0;
        const percent = value => totalResponses > 0 ? Math.round((value / totalResponses) * 1000) / 10 : 0;
        const promoterPercent = percent(promoters);
        const passivePercent = percent(passives);
        const detractorPercent = percent(detractors);
        const npsScore = totalResponses > 0 ? Math.round(promoterPercent - detractorPercent) : 0;
        const sentCount = parseInt(sentResult.rows[0]?.sent_count, 10) || 0;
        const responseCount = totalResponses;
        const responseRate = sentCount > 0 ? Math.round((responseCount / sentCount) * 10000) / 10000 : 0;
        const distByScore = new Map(distResult.rows.map(row => [parseInt(row.score, 10), parseInt(row.count, 10) || 0]));
        const distribution = Array.from({ length: 11 }, (_, score) => ({
            score,
            count: distByScore.get(score) || 0
        }));
        const recentResponses = recentResult.rows.map(row => ({
            ...row,
            customerName: row.customer_name,
            npsScore: row.nps_score,
            createdAt: row.created_at,
            programName: row.program_name
        }));
        const legacySummary = legacySummaryResult.rows[0] || {};
        const legacyDistByRating = new Map(legacyDistResult.rows.map(row => [parseInt(row.rating, 10), parseInt(row.count, 10) || 0]));
        const legacyRecent = legacyRecentResult.rows.map(row => ({
            ...row,
            customerName: row.customer_name,
            createdAt: row.created_at,
            programName: row.program_name
        }));
        const legacyReviews = {
            total: parseInt(legacySummary.total, 10) || 0,
            avgRating: parseFloat(legacySummary.avg_rating) || 0,
            distribution: [1, 2, 3, 4, 5].map(rating => ({
                rating,
                count: legacyDistByRating.get(rating) || 0
            })),
            recent: legacyRecent
        };
        res.json({
            success: true,
            npsScore,
            totalResponses,
            promoters,
            passives,
            detractors,
            promoterPercent,
            passivePercent,
            detractorPercent,
            distribution,
            recentResponses,
            sentCount,
            responseCount,
            responseRate,
            legacyReviews,
            avgNps: npsScore,
            totalReviews: totalResponses,
            recent: recentResponses,
            recentReviews: recentResponses,
            businessScope: {
                mode: businessScope.mode,
                activeContext: businessScope.activeContext,
                selectedContexts: businessScope.selectedContexts
            }
        });
    } catch (err) {
        log.error('GET /nps-stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: COMMUNICATIONS
// ==========================================

router.get('/:id/communication-context', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const customerId = parseInt(req.params.id, 10);
        const exists = await pool.query(
            "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
            [customerId, businessContext]
        );
        if (!exists.rows.length) {
            return res.status(404).json({ success: false, error: 'Customer not found in this business context' });
        }
        const context = await getCustomerCommunicationContext(customerId, { businessContext });
        if (!context) {
            return res.status(404).json({ success: false, error: 'Клієнта не знайдено' });
        }
        res.json({ success: true, context });
    } catch (err) {
        log.error('GET /:id/communication-context error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження комунікаційного контексту' });
    }
});

router.get('/:id/communications', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const customerId = parseInt(req.params.id);
        const result = await pool.query(
            `SELECT cl.*, u.name AS created_by_name
             FROM communication_log cl
             JOIN customers c ON c.id = cl.customer_id AND COALESCE(c.business_context, 'event_genix') = $2
             LEFT JOIN users u ON cl.created_by = u.id
             WHERE cl.customer_id = $1
             ORDER BY cl.created_at DESC LIMIT 100`, [customerId, businessContext]
        );
        res.json({ success: true, communications: result.rows });
    } catch (err) {
        log.error('GET /:id/communications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/communications', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const customerId = parseInt(req.params.id);
        const { type, direction, summary } = req.body;
        if (!type) return res.status(400).json({ error: 'Тип обовʼязковий' });
        const exists = await pool.query(
            "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
            [customerId, businessContext]
        );
        if (!exists.rows.length) return res.status(404).json({ error: 'Customer not found in this business context' });
        const result = await pool.query(
            `INSERT INTO communication_log (customer_id, type, direction, summary, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [customerId, type, direction || 'internal', summary || '', req.user?.id || null]
        );
        res.json({ success: true, communication: result.rows[0] });
    } catch (err) {
        log.error('POST /:id/communications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: VCARD EXPORT
// ==========================================

router.get('/export-vcf', requireAction('export_data'), exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(
            "SELECT * FROM customers WHERE COALESCE(business_context, 'event_genix') = $1 ORDER BY name LIMIT 5000",
            [businessContext]
        );
        const childrenMap = await loadCustomerChildrenMap(result.rows.map(row => row.id), businessContext);
        const vcards = result.rows.map(r => {
            const projected = applyCustomerChildrenProjection(
                mapCustomerRow(r),
                childrenMap.get(Number(r.id)) || []
            );
            const lines = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${(r.name || '').replace(/[;\n]/g, ' ')}`,
            ];
            if (r.phone) lines.push(`TEL;TYPE=CELL:${r.phone}`);
            if (r.instagram) lines.push(`X-INSTAGRAM:${r.instagram}`);
            if (projected.childNameDisplay) {
                const birthdayText = projected.childBirthdayDisplay ? `; ДН: ${projected.childBirthdayDisplay}` : '';
                lines.push(`NOTE:Діти: ${projected.childNameDisplay}${birthdayText}${r.notes ? ' | ' + r.notes.replace(/\n/g, ' ') : ''}`);
            }
            else if (r.notes) lines.push(`NOTE:${r.notes.replace(/\n/g, ' ')}`);
            if (projected.childBirthday) {
                const d = new Date(projected.childBirthday);
                lines.push(`BDAY:${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
            }
            lines.push('END:VCARD');
            return lines.join('\r\n');
        });
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0,10)}.vcf"`);
        res.send(vcards.join('\r\n'));
    } catch (err) {
        log.error('GET /export-vcf error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/import-vcf', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { vcfData } = req.body;
        if (!vcfData) return res.status(400).json({ error: 'vcfData обовʼязковий' });
        const cards = vcfData.split('END:VCARD').filter(c => c.includes('BEGIN:VCARD'));
        let created = 0, updated = 0, skipped = 0;
        for (const card of cards) {
            const lines = card.split(/\r?\n/);
            const get = (prefix) => {
                const line = lines.find(l => l.startsWith(prefix));
                return line ? line.substring(prefix.length).trim() : null;
            };
            const name = get('FN:');
            if (!name) { skipped++; continue; }
            const phone = get('TEL;TYPE=CELL:') || get('TEL:');
            const instagram = get('X-INSTAGRAM:');
            const note = get('NOTE:');
            const bday = get('BDAY:');
            let childBirthday = null;
            if (bday && bday.length === 8) {
                childBirthday = `${bday.slice(0,4)}-${bday.slice(4,6)}-${bday.slice(6,8)}`;
            }
            // Try to find by phone
            if (phone) {
                const existing = await pool.query(
                    "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                    [phone, businessContext]
                );
                if (existing.rows.length > 0) {
                    await pool.query(
                        "UPDATE customers SET name = $1, instagram = COALESCE($2, instagram), updated_at = NOW() WHERE id = $3 AND COALESCE(business_context, 'event_genix') = $4",
                        [name, instagram, existing.rows[0].id, businessContext]
                    );
                    updated++;
                    continue;
                }
            }
            await pool.query(
                'INSERT INTO customers (business_context, name, phone, instagram, child_birthday, notes) VALUES ($1, $2, $3, $4, $5, $6)',
                [businessContext, name, phone, instagram, childBirthday, note]
            );
            created++;
        }
        res.json({ success: true, created, updated, skipped });
    } catch (err) {
        log.error('POST /import-vcf error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.4: BULK MESSAGING
// ==========================================

router.post('/bulk-message', requireMinRole('manager'), async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { filters, template, dryRun } = req.body;
        if (!template) return res.status(400).json({ error: 'Шаблон повідомлення обовʼязковий' });

        // Build filter query
        const conditions = [];
        const params = [];
        conditions.push(customerContextCondition(params, businessContext, 'c'));
        if (filters?.tags?.length) {
            params.push(filters.tags);
            conditions.push(`c.id IN (SELECT customer_id FROM customer_tags WHERE tag = ANY($${params.length}))`);
        }
        if (filters?.minVisits) {
            params.push(parseInt(filters.minVisits));
            conditions.push(`c.total_bookings >= $${params.length}`);
        }
        if (filters?.source) {
            params.push(normalizeCustomerSource(filters.source, { unknownAsNull: false }));
            conditions.push(`${customerSourceSqlExpression('c.source')} = $${params.length}`);
        }
        const where = 'WHERE ' + conditions.join(' AND ');

        // Get matching customers
        const result = await pool.query(
            `SELECT c.id, c.name, c.phone, c.child_name, c.instagram
             FROM customers c ${where}
             ORDER BY c.name`, params
        );

        if (dryRun) {
            return res.json({ success: true, dryRun: true, recipientCount: result.rows.length });
        }

        const childrenMap = await loadCustomerChildrenMap(result.rows.map(row => row.id), businessContext);
        const customers = result.rows.map(row => applyCustomerChildrenProjection(
            mapCustomerRow(row),
            childrenMap.get(Number(row.id)) || []
        ));

        // v38.4.0: Batch INSERT instead of N+1 loop
        const rows = customers.map(customer => {
            const message = template
                .replace(/\{name\}/g, customer.name || '')
                .replace(/\{childName\}/g, customer.childNameDisplay || customer.childName || '')
                .replace(/\{childBirthday\}/g, customer.childBirthdayDisplay || customer.childBirthday || '')
                .replace(/\{phone\}/g, customer.phone || '');
            return { id: customer.id, message };
        });
        if (rows.length > 0) {
            const values = rows.map((r, i) => `($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`).join(',');
            const params = rows.flatMap(r => [r.id, 'bulk_message', r.message, req.user?.id || null]);
            await pool.query(
                `INSERT INTO communication_log (customer_id, type, summary, created_by) VALUES ${values}`,
                params
            );
        }
        const sent = rows.length;

        log.info(`Bulk message sent to ${sent} customers by ${req.user?.username}`);
        res.json({ success: true, sent });
    } catch (err) {
        log.error('POST /bulk-message error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List customers (with pagination, search, and filters)
router.get('/', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const source = (req.query.source || '').trim();
        const minVisits = parseCustomerVisitBound(req.query.minVisits);
        const maxVisits = parseCustomerVisitBound(req.query.maxVisits);
        const dateFrom = (req.query.dateFrom || '').trim();
        const dateTo = (req.query.dateTo || '').trim();
        const sortBy = (req.query.sortBy || 'updated_at').trim();
        const tag = (req.query.tag || '').trim();

        if (sortBy === 'total_spent' && !canUseAction(req.user, 'view_revenue')) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }


        // PostgreSQL
        const conditions = [];
        const params = [];
        conditions.push(customerScopeCondition(params, businessScope, 'c'));

        if (search) {
            params.push(`%${search}%`);
            const socialIdentitySearch = await canSearchCustomerSocialIdentities()
                ? ` OR c.social_identities::text ILIKE $${params.length}`
                : '';
            const patternRef = `$${params.length}`;
            conditions.push(`(c.name ILIKE ${patternRef} OR c.phone ILIKE ${patternRef} OR c.instagram ILIKE ${patternRef} OR c.child_name ILIKE ${patternRef} OR ${customerChildrenSearchSql(patternRef, 'c')}${socialIdentitySearch})`);
        }
        if (source) {
            const normalizedSource = normalizeCustomerSource(source, { unknownAsNull: false });
            params.push(normalizedSource);
            conditions.push(`${customerSourceSqlExpression('c.source')} = $${params.length}`);
        }
        if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { params.push(dateFrom); conditions.push(`c.last_visit >= $${params.length}::date`); }
        if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { params.push(dateTo); conditions.push(`c.last_visit <= $${params.length}::date`); }
        if (tag) { params.push(tag); conditions.push(`c.id IN (SELECT customer_id FROM customer_tags WHERE tag = $${params.length})`); }

        const bookingAgg = scopedBookingAggregateSql(req.user, params, 'b', businessScope);
        const visitCountExpr = 'COALESCE(b_agg.booking_count, c.total_bookings, 0)';
        if (minVisits !== null) { params.push(minVisits); conditions.push(`${visitCountExpr} >= $${params.length}`); }
        if (maxVisits !== null) { params.push(maxVisits); conditions.push(`${visitCountExpr} <= $${params.length}`); }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const allowedSorts = {
            'updated_at': 'c.updated_at DESC', 'name': 'c.name ASC',
            'total_bookings': `${visitCountExpr} DESC`, 'total_spent': 'COALESCE(b_agg.booking_spent, c.total_spent, 0) DESC',
            'last_visit': 'COALESCE(b_agg.real_last_visit, c.last_visit) DESC NULLS LAST', 'created_at': 'c.created_at DESC'
        };
        const orderBy = allowedSorts[sortBy] || allowedSorts.updated_at;

        const countResult = await pool.query(
            `SELECT COUNT(*)
             FROM customers c
             LEFT JOIN (${bookingAgg.sql}) b_agg ON b_agg.customer_id = c.id
             ${where}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        const dataParams = [...params, limit, offset];
        // v32.1: JOIN bookings to compute real totalBookings/totalSpent/LTV
        const result = await pool.query(
            `SELECT c.*,
                    COALESCE(b_agg.booking_count, 0) AS real_total_bookings,
                    COALESCE(b_agg.booking_spent, 0) AS real_total_spent,
                    b_agg.real_last_visit,
                    b_agg.real_first_visit
             FROM customers c
             LEFT JOIN (${bookingAgg.sql}) b_agg ON b_agg.customer_id = c.id
             ${where}
             ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        // v30.4: Attach tags to each customer
        const customerIds = result.rows.map(r => r.id);
        let tagsMap = {};
        if (customerIds.length > 0) {
            try {
                const tagCaps = await getCustomerTagColumnCapabilities(pool);
                const tagsResult = await pool.query(
                    `SELECT ${customerTagSelectFields(tagCaps)}
                     FROM customer_tags
                     WHERE customer_id = ANY($1)`,
                    [customerIds]
                );
                for (const t of tagsResult.rows) {
                    if (!tagsMap[t.customer_id]) tagsMap[t.customer_id] = [];
                    tagsMap[t.customer_id].push(mapCustomerTagRow(t));
                }
            } catch { /* tags table may not exist yet */ }
        }

        const childrenMap = await loadCustomerChildrenMap(result.rows.map(r => r.id));
        res.json({
            customers: result.rows.map(r => {
                // v32.1: Override denormalized fields with real booking aggregates
                r.total_bookings = parseInt(r.real_total_bookings) || r.total_bookings || 0;
                r.total_spent = parseInt(r.real_total_spent) || r.total_spent || 0;
                if (r.real_last_visit) r.last_visit = r.real_last_visit;
                if (r.real_first_visit) r.first_visit = r.real_first_visit;
                const c = applyCustomerChildrenProjection(
                    mapCustomerRow(r),
                    childrenMap.get(Number(r.id)) || []
                );
                c.tags = tagsMap[r.id] || [];
                c.ltv = calculateLTV(r);
                return c;
            }),
            total, page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        log.error('Customer list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
function mapCompactBookingLeadContext(row = {}) {
    const leadId = Number.parseInt(row.id ?? row.lead_id, 10);
    if (!Number.isInteger(leadId) || leadId <= 0) return null;
    const parsedChildrenCount = Number.parseInt(row.children_count, 10);
    const childrenCount = Number.isInteger(parsedChildrenCount) && parsedChildrenCount > 0
        ? parsedChildrenCount
        : null;
    return {
        leadId,
        childrenCount,
        eventDate: row.event_date || null,
        source: row.source || null
    };
}

function resolveCustomerBookingLeadContext(rows = []) {
    const uniqueRows = [];
    const seenLeadIds = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const context = mapCompactBookingLeadContext(row);
        if (!context || seenLeadIds.has(context.leadId)) continue;
        seenLeadIds.add(context.leadId);
        uniqueRows.push(context);
    }
    return {
        leadContext: uniqueRows.length === 1 ? uniqueRows[0] : null,
        leadContextAmbiguous: uniqueRows.length > 1
    };
}


// Get customer by ID (with booking history + certificates)
router.get('/:id', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const numId = parseInt(id);

        let customer;
        const result = await pool.query(
            `SELECT * FROM customers WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [numId, businessContext]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Клієнта не знайдено' });
        customer = applyCustomerChildrenProjection(
            mapCustomerRow(result.rows[0]),
            await listCustomerChildren(numId, businessContext)
        );
        customer.leadContext = null;
        customer.leadContextAmbiguous = false;

        try {
            const bookingLeadContextResult = await pool.query(
                `WITH durable_lead_ids AS (
                    SELECT lcl.lead_id
                    FROM lead_customer_links lcl
                    WHERE lcl.customer_id = $1
                      AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                    UNION
                    SELECT c.lead_id
                    FROM customers c
                    WHERE c.id = $1
                      AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                      AND c.lead_id IS NOT NULL
                 )
                 SELECT l.id,
                        COALESCE(NULLIF(lep.children_count, 0), NULLIF(l.children_count, 0)) AS children_count,
                        COALESCE(lep.preferred_date, l.event_date) AS event_date,
                        COALESCE(NULLIF(l.source, ''), NULLIF(l.source_channel, '')) AS source
                 FROM durable_lead_ids dli
                 JOIN leads l ON l.id = dli.lead_id
                 LEFT JOIN lead_event_preferences lep
                   ON lep.lead_id = l.id
                  AND COALESCE(lep.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                 WHERE COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                 ORDER BY l.updated_at DESC NULLS LAST, l.id DESC
                 LIMIT 2`,
                [numId, businessContext]
            );
            Object.assign(customer, resolveCustomerBookingLeadContext(bookingLeadContextResult.rows));
        } catch (err) {
            log.warn('Customer booking lead context lookup failed', { customerId: numId, error: err?.message });
        }


        try {
            const linkedLeadsResult = await pool.query(
                `SELECT l.id, l.pipeline_stage, l.status, l.client_name, l.phone, l.created_at,
                        lcl.link_type, lcl.source AS link_source, lcl.created_at AS linked_at
                 FROM lead_customer_links lcl
                 JOIN leads l ON l.id = lcl.lead_id
                 WHERE lcl.customer_id = $1
                   AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                   AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                 ORDER BY lcl.updated_at DESC NULLS LAST, lcl.id DESC
                 LIMIT 20`,
                [numId, businessContext]
            );
            customer.leadLinks = linkedLeadsResult.rows.map(row => ({
                id: row.id,
                pipelineStage: row.pipeline_stage || null,
                status: row.status || null,
                clientName: row.client_name || null,
                phone: row.phone || null,
                linkType: row.link_type || null,
                linkSource: row.link_source || null,
                linkedAt: row.linked_at || null,
                createdAt: row.created_at || null
            }));
            const primaryLead = linkedLeadsResult.rows[0] || null;
            if (primaryLead) {
                customer.leadId = primaryLead.id;
                customer.leadPipelineStage = primaryLead.pipeline_stage || null;
                customer.leadStatus = primaryLead.status || null;
            }
        } catch {
            customer.leadLinks = [];
        }

        if (!customer.leadPipelineStage && customer.leadId) {
            try {
                const leadResult = await pool.query(
                    `SELECT id, pipeline_stage, status
                     FROM leads
                     WHERE id = $1
                       AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                     LIMIT 1`,
                    [customer.leadId, businessContext]
                );
                const lead = leadResult.rows[0] || null;
                customer.leadPipelineStage = lead?.pipeline_stage || null;
                customer.leadStatus = lead?.status || null;
            } catch {
                customer.leadPipelineStage = null;
                customer.leadStatus = null;
            }
        }

        // Bookings + certificates from PostgreSQL
        const bookingParams = [numId, businessContext];
        const bookingVisibility = getVisibleBookingScope(req.user, bookingParams, 'b');
        const bookings = await pool.query(
            `SELECT id, date, time, program_name, program_code, label, category, price, status, room, duration,
                    banquet_guests, banquet_adults, banquet_tables, banquet_menu
             FROM bookings b
             WHERE b.customer_id = $1
               AND COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
               AND b.linked_to IS NULL
               ${bookingVisibility.sql}
             ORDER BY b.date DESC LIMIT 50`,
            bookingParams
        );
        customer.bookings = bookings.rows.map(b => ({
            id: b.id, date: b.date, time: b.time, programName: b.program_name,
            programCode: b.program_code, label: b.label, category: b.category, price: b.price,
            status: b.status, room: b.room, duration: b.duration,
            banquetGuests: b.banquet_guests, banquetAdults: b.banquet_adults,
            banquetTables: b.banquet_tables, banquetMenu: b.banquet_menu
        }));

        try {
            const certs = await pool.query(
                `SELECT id, cert_code, display_value, type_text, status, valid_until, issued_at
                 FROM certificates WHERE customer_id = $1 ORDER BY issued_at DESC`, [numId]
            );
            customer.certificates = certs.rows.map(c => ({
                id: c.id, certCode: c.cert_code, displayValue: c.display_value,
                typeText: c.type_text, status: c.status, validUntil: c.valid_until, issuedAt: c.issued_at
            }));
        } catch { customer.certificates = []; }

        // v30.4: Tags
        try {
            customer.tags = await getCustomerTagsPg(pool, numId);
        } catch { customer.tags = []; }

        // v33.8.0 Integration 5: Reviews + average_rating
        try {
            const reviewParams = [numId, businessContext];
            const reviewVisibility = getVisibleBookingScope(req.user, reviewParams, 'b');
            const reviews = await pool.query(
                `SELECT er.rating, er.comment, er.created_at, b.date, b.program_name
                 FROM event_reviews er
                 LEFT JOIN bookings b ON b.id = er.booking_id
                 WHERE er.customer_id = $1
                   AND (er.booking_id IS NULL OR COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2)
                   AND (er.booking_id IS NULL OR ${reviewVisibility.condition})
                 ORDER BY er.created_at DESC LIMIT 10`,
                reviewParams
            );
            customer.reviews = reviews.rows.map(r => ({
                rating: r.rating, comment: r.comment, createdAt: r.created_at,
                date: r.date, programName: r.program_name
            }));
        } catch { customer.reviews = []; }

        // v30.4: LTV
        if (customer.totalBookings > 0) {
            const raw = { total_bookings: customer.totalBookings, total_spent: customer.totalSpent,
                          first_visit: customer.firstVisit, last_visit: customer.lastVisit };
            customer.ltv = calculateLTV(raw);
        } else {
            customer.ltv = 0;
        }

        res.json(customer);
    } catch (err) {
        log.error('Customer get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create customer
router.post('/', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const input = normalizeCustomerPayload(req.body);
        if (input.error) return res.status(400).json({ error: input.error });
        input.businessContext = businessContext;
        const { name } = input;
        if (!name) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }


        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await insertCustomerPg(input, client);
            const savedChildren = await saveCustomerChildrenFromCustomerApi(
                result.rows[0].id,
                input,
                businessContext,
                'customers.create',
                client
            );
            if (input.tagsProvided) {
                await syncManualCustomerTags(client, result.rows[0].id, input.tags, req.user?.id || null);
            }
            await syncBirthdayTagsAfterCustomerSave(client, result.rows[0].id, req.user?.id || null);
            const customer = applyCustomerChildrenProjection(mapCustomerRow(result.rows[0]), savedChildren);
            customer.tags = await getCustomerTagsPg(client, customer.id);
            await client.query('COMMIT');
            res.json(customer);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        if (isCustomerDuplicateError(err)) return sendCustomerDuplicateResponse(res);
        if (err instanceof CustomerChildrenError) {
            return res.status(err.status || 400).json({ error: err.message, code: err.code, details: err.details });
        }
        log.error('Customer create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update customer
router.put('/:id', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const input = normalizeCustomerPayload(req.body);
        if (input.error) return res.status(400).json({ error: input.error });
        input.businessContext = businessContext;
        const { name } = input;
        if (!name) {
            return res.status(400).json({ error: "Ім'я клієнта обов'язкове" });
        }


        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await updateCustomerPg(id, input, client);
            let savedChildren = [];
            if (result.rows.length > 0) {
                savedChildren = await saveCustomerChildrenFromCustomerApi(
                    result.rows[0].id,
                    input,
                    businessContext,
                    'customers.update',
                    client
                );
            }
            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Клієнта не знайдено' });
            }
            if (input.tagsProvided) {
                await syncManualCustomerTags(client, result.rows[0].id, input.tags, req.user?.id || null);
            }
            await syncBirthdayTagsAfterCustomerSave(client, result.rows[0].id, req.user?.id || null);
            const customer = applyCustomerChildrenProjection(mapCustomerRow(result.rows[0]), savedChildren);
            customer.tags = await getCustomerTagsPg(client, customer.id);
            await client.query('COMMIT');
            res.json(customer);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        if (isCustomerDuplicateError(err)) return sendCustomerDuplicateResponse(res);
        if (err instanceof CustomerChildrenError) {
            return res.status(err.status || 400).json({ error: err.message, code: err.code, details: err.details });
        }
        log.error('Customer update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete customer (transactional)
router.delete('/:id', requireMinRole('manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { id } = req.params;
        const numId = parseInt(id);

        await client.query('BEGIN');

        // Unlink bookings and certificates within transaction
        await client.query(
            `UPDATE bookings SET customer_id = NULL
             WHERE customer_id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
            [numId, businessContext]
        );
        try {
            await client.query('UPDATE certificates SET customer_id = NULL WHERE customer_id = $1', [numId]);
        } catch { /* certificates may not have customer_id yet */ }
        await client.query(
            `DELETE FROM customer_children
             WHERE customer_id = $1 AND business_context = $2`,
            [numId, businessContext]
        );
        await client.query(
            `DELETE FROM lead_customer_links
             WHERE customer_id = $1 AND business_context = $2`,
            [numId, businessContext]
        );

        const result = await client.query(
            `DELETE FROM customers
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             RETURNING id`,
            [numId, businessContext]
        );
        if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Клієнта не знайдено' }); }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Customer delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});


// Row mapper (snake_case → camelCase)
function mapCustomerRow(row) {
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        name: row.name,
        phone: row.phone || null,
        instagram: row.instagram || null,
        leadId: row.lead_id || null,
        leadPipelineStage: row.lead_pipeline_stage || null,
        leadStatus: row.lead_status || null,
        childName: row.child_name || null,
        childBirthday: row.child_birthday || null,
        socialIdentities: normalizeSocialIdentities(row.social_identities, { instagram: row.instagram }),
        source: normalizeCustomerSource(row.source, { unknownAsNull: false }),
        sourceLabel: getCustomerSourceLabel(row.source),
        notes: row.notes || null,
        // v33.3: Prefer live aggregation from bookings JOIN when available
        totalBookings: row.real_total_bookings != null ? parseInt(row.real_total_bookings) : (row.total_bookings || 0),
        totalSpent: row.real_total_spent != null ? parseInt(row.real_total_spent) : (row.total_spent || 0),
        firstVisit: row.real_first_visit || row.first_visit || null,
        lastVisit: row.real_last_visit || row.last_visit || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// v15.1: RFM score calculation
function calculateRFMScores(customers) {
    if (customers.length === 0) return [];
    const recencies = customers.filter(c => c.recencyDays !== null).map(c => c.recencyDays);
    const frequencies = customers.map(c => c.frequency);
    const monetaries = customers.map(c => c.monetary);

    return customers.map(c => {
        let rScore = 1;
        if (c.recencyDays !== null && recencies.length > 0) rScore = getPercentileScore(recencies, c.recencyDays, true);
        let fScore = 1;
        if (frequencies.length > 0) fScore = getPercentileScore(frequencies, c.frequency, false);
        let mScore = 1;
        if (monetaries.length > 0) mScore = getPercentileScore(monetaries, c.monetary, false);
        const rfmScore = rScore + fScore + mScore;
        const rfmSegment = getRFMSegment(rScore, fScore, mScore);
        return { ...c, rScore, fScore, mScore, rfmScore, rfmSegment };
    });
}

function getPercentileScore(arr, value, inverted) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = sorted.indexOf(value);
    const percentile = idx / Math.max(sorted.length - 1, 1);
    const score = inverted ? (1 - percentile) : percentile;
    if (score >= 0.8) return 5;
    if (score >= 0.6) return 4;
    if (score >= 0.4) return 3;
    if (score >= 0.2) return 2;
    return 1;
}

function getRFMSegment(r, f, m) {
    const avg = (r + f + m) / 3;
    if (r >= 4 && f >= 4) return 'champion';
    if (f >= 3 && m >= 3) return 'loyal';
    if (r >= 3 && f <= 2) return 'potential';
    if (r <= 2 && f >= 2) return 'at_risk';
    if (avg <= 2) return 'lost';
    return 'potential';
}

// v30.4: LTV calculation
function calculateLTV(row) {
    const bookings = row.total_bookings || 0;
    const spent = row.total_spent || 0;
    if (bookings === 0 || !row.first_visit) return 0;
    const firstDate = new Date(row.first_visit);
    const lastDate = row.last_visit ? new Date(row.last_visit) : new Date();
    const daysDiff = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
    const visitsPerYear = bookings / (daysDiff / 365);
    const avgSpend = spent / bookings;
    return Math.round(spent + (avgSpend * visitsPerYear * 2));
}

function escapeCsv(str) {
    if (!str) return '';
    const s = String(str);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

module.exports = router;
