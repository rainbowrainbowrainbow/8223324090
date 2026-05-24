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
const { authenticateToken, requireRole, requireMinRole } = require('../middleware/auth');
const { getCustomerCommunicationContext } = require('../services/customerCommunicationHub');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const {
    DEFAULT_BUSINESS_CONTEXT,
    businessContextFromRequest,
    requireBusinessContext,
    pushBusinessContextCondition
} = require('../services/businessContext');

const log = createLogger('Customers');

// All customer routes require authentication
router.use(authenticateToken);
router.use(requireRole('admin', 'reception'));
// v40: Validate :id param is numeric
router.param('id', (req, res, next, val) => { if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' }); next(); });

// v30.4: Predefined tag templates
const PREDEFINED_TAGS = [
    { tag: 'VIP', color: '#F59E0B' },
    { tag: 'Проблемний', color: '#EF4444' },
    { tag: 'Корпорат', color: '#3B82F6' },
    { tag: 'Рекомендація', color: '#10B981' },
    { tag: 'Постійний', color: '#8B5CF6' }
];

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

function normalizeCustomerPayload(body = {}) {
    const name = cleanText(body.name);
    const childBirthday = cleanText(body.childBirthday ?? body.child_birthday);
    if (childBirthday && !/^\d{4}-\d{2}-\d{2}$/.test(childBirthday)) {
        return { error: 'Дата народження має бути у форматі YYYY-MM-DD' };
    }
    return {
        name,
        phone: cleanText(body.phone),
        instagram: cleanText(body.instagram)?.replace(/^@+/, '') || null,
        childName: cleanText(body.childName ?? body.child_name),
        childBirthday: childBirthday || null,
        source: cleanText(body.source),
        notes: cleanText(body.notes),
        socialIdentities: normalizeSocialIdentities(
            body.socialIdentities ?? body.social_identities,
            { instagram: body.instagram }
        )
    };
}

function requestBusinessContext(req) {
    return businessContextFromRequest(req);
}

function ensureBusinessContext(req, res) {
    const businessContext = requestBusinessContext(req);
    if (!requireBusinessContext(req, res, businessContext)) return null;
    return businessContext;
}

function customerContextCondition(params, businessContext, alias = '') {
    return pushBusinessContextCondition(params, businessContext || DEFAULT_BUSINESS_CONTEXT, alias);
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

async function insertCustomerPg(input) {
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
        return await pool.query(
            `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source, notes, social_identities)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING *`,
            params
        );
    } catch (err) {
        if (!isCustomerSocialIdentitiesStorageError(err)) throw err;
        log.warn('customers.social_identities unavailable during create; retrying legacy customer insert', { error: err.message });
        return pool.query(
            `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            params.slice(0, 8)
        );
    }
}

async function updateCustomerPg(id, input) {
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
        return await pool.query(
            `UPDATE customers SET name=$1, phone=$2, instagram=$3, child_name=$4,
             child_birthday=$5, source=$6, notes=$7, social_identities=$8::jsonb, updated_at=NOW()
             WHERE id=$9 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $10 RETURNING *`,
            params
        );
    } catch (err) {
        if (!isCustomerSocialIdentitiesStorageError(err)) throw err;
        log.warn('customers.social_identities unavailable during update; retrying legacy customer update', { error: err.message });
        return pool.query(
            `UPDATE customers SET name=$1, phone=$2, instagram=$3, child_name=$4,
             child_birthday=$5, source=$6, notes=$7, updated_at=NOW()
             WHERE id=$8 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $9 RETURNING *`,
            [...params.slice(0, 7), parseInt(id), input.businessContext || DEFAULT_BUSINESS_CONTEXT]
        );
    }
}

function scopedBookingAggregateSql(user, params, alias = 'b') {
    const businessContext = arguments.length >= 4 ? arguments[3] : DEFAULT_BUSINESS_CONTEXT;
    params.push(businessContext || DEFAULT_BUSINESS_CONTEXT);
    const businessRef = `$${params.length}`;
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
              AND COALESCE(${alias}.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = ${businessRef}
              ${visibility.sql}
            GROUP BY ${alias}.customer_id
        `
    };
}

// Autocomplete search (for booking form dropdown)
router.get('/search', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json([]);


        // PostgreSQL: live aggregation from bookings
        const pattern = `%${q}%`;
        const params = [pattern];
        const bookingAgg = scopedBookingAggregateSql(req.user, params, 'b', businessContext);
        const socialIdentitySearch = await canSearchCustomerSocialIdentities()
            ? ' OR c.social_identities::text ILIKE $1'
            : '';
        const contextSql = customerContextCondition(params, businessContext, 'c');
        const result = await pool.query(
            `SELECT c.id, c.name, c.phone, c.instagram, c.child_name, c.total_bookings,
                    COALESCE(b_agg.booking_count, 0) AS real_total_bookings,
                    COALESCE(b_agg.booking_spent, 0) AS real_total_spent,
                    b_agg.real_last_visit
             FROM customers c
             LEFT JOIN (${bookingAgg.sql}) b_agg ON b_agg.customer_id = c.id
             WHERE ${contextSql}
               AND (c.name ILIKE $1 OR c.phone ILIKE $1 OR c.instagram ILIKE $1${socialIdentitySearch})
             ORDER BY b_agg.real_last_visit DESC NULLS LAST
             LIMIT 20`,
            params
        );
        res.json(result.rows.map(mapCustomerRow));
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

        res.json({ customers: withScores, segments, total: withScores.length });
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
        res.json({
            success: true,
            segments: {
                active: parseInt(row.active) || 0,
                sleeping: parseInt(row.sleeping) || 0,
                new: parseInt(row.new) || 0,
                vip: parseInt(row.vip) || 0
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
        const params = [];
        const contextSql = customerContextCondition(params, businessContext, 'c');

        // PostgreSQL: compare month-day to find upcoming birthdays (handles year wrap)
        const result = await pool.query(`
            SELECT c.id, c.name AS parent_name, c.phone,
                   c.child_name, c.child_birthday,
                   CASE
                       WHEN TO_CHAR(c.child_birthday, 'MM-DD') >= TO_CHAR(CURRENT_DATE, 'MM-DD')
                       THEN (TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                       ELSE (TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text || '-' || TO_CHAR(c.child_birthday, 'MM-DD'), 'YYYY-MM-DD') - CURRENT_DATE)
                   END AS days_until_birthday
            FROM customers c
            WHERE c.child_birthday IS NOT NULL
              AND ${contextSql}
            ORDER BY days_until_birthday ASC
        `, params);

        const filtered = result.rows
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
router.get('/export', exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        let customerRows;
        const params = [];
        const contextSql = customerContextCondition(params, businessContext);
        const result = await pool.query(`SELECT * FROM customers WHERE ${contextSql} ORDER BY name LIMIT 5000`, params);
        customerRows = result.rows;

        // Get cert counts from PostgreSQL
        const certResult = await pool.query(
            'SELECT customer_id, COUNT(*) AS cnt FROM certificates GROUP BY customer_id'
        );
        const certMap = {};
        for (const r of certResult.rows) certMap[r.customer_id] = parseInt(r.cnt);

        const BOM = '\uFEFF';
        const header = [
            'ID', "Ім'я", 'Телефон', 'Instagram', 'Соц. ідентичності', "Ім'я дитини",
            'ДН дитини', 'Джерело', 'Нотатки', 'Бронювань',
            'Витрачено (грн)', 'Перший візит', 'Останній візит',
            'Сертифікатів', 'Створено'
        ].join(';');

        const rows = customerRows.map(r => [
            r.id,
            escapeCsv(r.name),
            escapeCsv(r.phone || ''),
            escapeCsv(r.instagram || ''),
            escapeCsv(formatSocialIdentities(r.social_identities, { instagram: r.instagram })),
            escapeCsv(r.child_name || ''),
            r.child_birthday ? formatDate(r.child_birthday) : '',
            escapeCsv(r.source || ''),
            escapeCsv(r.notes || ''),
            r.total_bookings || 0,
            r.total_spent || 0,
            r.first_visit ? formatDate(r.first_visit) : '',
            r.last_visit ? formatDate(r.last_visit) : '',
            certMap[r.id] || 0,
            r.created_at ? formatDate(r.created_at) : ''
        ].join(';'));

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
router.get('/export-xlsx', exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        let customerRows;
        const params = [];
        const contextSql = customerContextCondition(params, businessContext);
        const result = await pool.query(`SELECT * FROM customers WHERE ${contextSql} ORDER BY name LIMIT 5000`, params);
        customerRows = result.rows;

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
            { header: "Ім'я дитини", key: 'childName', width: 18 },
            { header: 'ДН дитини', key: 'childBday', width: 14 },
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

        for (const r of customerRows) {
            sheet.addRow({
                id: r.id,
                name: r.name || '',
                phone: r.phone || '',
                instagram: r.instagram || '',
                socialIdentities: formatSocialIdentities(r.social_identities, { instagram: r.instagram }),
                childName: r.child_name || '',
                childBday: r.child_birthday || '',
                source: r.source || '',
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
        const totalParams = [];
        const totalContextSql = customerContextCondition(totalParams, businessContext);
        const totalResult = await pool.query(`SELECT COUNT(*) FROM customers WHERE ${totalContextSql}`, totalParams);
        const sourceResult = await pool.query(
            `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
             FROM customers WHERE ${totalContextSql} GROUP BY source ORDER BY count DESC`,
            totalParams
        );
        const topResult = await pool.query(
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
            , totalParams);
        const recentResult = await pool.query(
            `SELECT c.id, c.name,
                    COALESCE(b.cnt, 0) AS total_bookings,
                    COALESCE(b.spent, 0) AS total_spent,
                    c.created_at
             FROM customers c
             LEFT JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent
                 FROM bookings WHERE status != 'cancelled' AND COALESCE(business_context, 'event_genix') = $1 GROUP BY customer_id
             ) b ON b.customer_id = c.id
             WHERE ${totalContextSql}
             ORDER BY c.created_at DESC LIMIT 5`
            , totalParams);
        const avgResult = await pool.query(
            `SELECT ROUND(AVG(b.cnt), 1) AS avg_bookings,
                    ROUND(AVG(b.spent), 0) AS avg_spent
             FROM customers c
             INNER JOIN (
                 SELECT customer_id, COUNT(*) AS cnt, COALESCE(SUM(price),0) AS spent
                 FROM bookings WHERE status != 'cancelled' AND COALESCE(business_context, 'event_genix') = $1 GROUP BY customer_id
             ) b ON b.customer_id = c.id
             WHERE ${totalContextSql}`
            , totalParams);

        res.json({
            total: parseInt(totalResult.rows[0].count),
            bySource: sourceResult.rows.map(r => ({ source: r.source, count: parseInt(r.count) })),
            topBySpent: topResult.rows.map(mapCustomerRow),
            recentCustomers: recentResult.rows.map(mapCustomerRow),
            averages: avgResult.rows[0] || { avg_bookings: 0, avg_spent: 0 }
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
        const result = await pool.query(
            `SELECT tag, color, COUNT(*) AS count
             FROM customer_tags ct
             JOIN customers c ON c.id = ct.customer_id
             WHERE ct.customer_id IS NOT NULL
               AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
             GROUP BY tag, color ORDER BY count DESC`,
            [businessContext]
        );
        res.json({ success: true, tags: result.rows, predefined: PREDEFINED_TAGS });
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

router.get('/ltv', async (req, res) => {
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
        const [avgResult, distResult, recentResult] = await Promise.all([
            pool.query('SELECT AVG(rating)::numeric(3,1) AS avg_score, COUNT(*) AS total FROM event_reviews'),
            pool.query('SELECT rating, COUNT(*) AS count FROM event_reviews GROUP BY rating ORDER BY rating'),
            pool.query('SELECT * FROM event_reviews ORDER BY created_at DESC LIMIT 20')
        ]);
        res.json({
            success: true,
            avgScore: parseFloat(avgResult.rows[0]?.avg_score) || 0,
            totalReviews: parseInt(avgResult.rows[0]?.total) || 0,
            distribution: distResult.rows.map(r => ({ rating: r.rating, count: parseInt(r.count) })),
            recent: recentResult.rows
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

router.get('/export-vcf', exportLimiter, async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(
            "SELECT * FROM customers WHERE COALESCE(business_context, 'event_genix') = $1 ORDER BY name LIMIT 5000",
            [businessContext]
        );
        const vcards = result.rows.map(r => {
            const lines = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${(r.name || '').replace(/[;\n]/g, ' ')}`,
            ];
            if (r.phone) lines.push(`TEL;TYPE=CELL:${r.phone}`);
            if (r.instagram) lines.push(`X-INSTAGRAM:${r.instagram}`);
            if (r.child_name) lines.push(`NOTE:Дитина: ${r.child_name}${r.notes ? ' | ' + r.notes.replace(/\n/g, ' ') : ''}`);
            else if (r.notes) lines.push(`NOTE:${r.notes.replace(/\n/g, ' ')}`);
            if (r.child_birthday) {
                const d = new Date(r.child_birthday);
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
            params.push(filters.source);
            conditions.push(`c.source = $${params.length}`);
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

        // v38.4.0: Batch INSERT instead of N+1 loop
        const rows = result.rows.map(customer => {
            const message = template
                .replace(/\{name\}/g, customer.name || '')
                .replace(/\{childName\}/g, customer.child_name || '')
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
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
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


        // PostgreSQL
        const conditions = [];
        const params = [];
        conditions.push(customerContextCondition(params, businessContext, 'c'));

        if (search) {
            params.push(`%${search}%`);
            const socialIdentitySearch = await canSearchCustomerSocialIdentities()
                ? ` OR c.social_identities::text ILIKE $${params.length}`
                : '';
            conditions.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.instagram ILIKE $${params.length} OR c.child_name ILIKE $${params.length}${socialIdentitySearch})`);
        }
        if (source) { params.push(source); conditions.push(`c.source = $${params.length}`); }
        if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { params.push(dateFrom); conditions.push(`c.last_visit >= $${params.length}::date`); }
        if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) { params.push(dateTo); conditions.push(`c.last_visit <= $${params.length}::date`); }
        if (tag) { params.push(tag); conditions.push(`c.id IN (SELECT customer_id FROM customer_tags WHERE tag = $${params.length})`); }

        const bookingAgg = scopedBookingAggregateSql(req.user, params, 'b', businessContext);
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
                const tagsResult = await pool.query(
                    'SELECT id, customer_id, tag, color FROM customer_tags WHERE customer_id = ANY($1)',
                    [customerIds]
                );
                for (const t of tagsResult.rows) {
                    if (!tagsMap[t.customer_id]) tagsMap[t.customer_id] = [];
                    tagsMap[t.customer_id].push({ id: t.id, tag: t.tag, color: t.color });
                }
            } catch { /* tags table may not exist yet */ }
        }

        res.json({
            customers: result.rows.map(r => {
                // v32.1: Override denormalized fields with real booking aggregates
                r.total_bookings = parseInt(r.real_total_bookings) || r.total_bookings || 0;
                r.total_spent = parseInt(r.real_total_spent) || r.total_spent || 0;
                if (r.real_last_visit) r.last_visit = r.real_last_visit;
                if (r.real_first_visit) r.first_visit = r.real_first_visit;
                const c = mapCustomerRow(r);
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
        customer = mapCustomerRow(result.rows[0]);

        // Bookings + certificates from PostgreSQL
        const bookingParams = [numId, businessContext];
        const bookingVisibility = getVisibleBookingScope(req.user, bookingParams, 'b');
        const bookings = await pool.query(
            `SELECT id, date, time, program_name, program_code, label, price, status, room, duration
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
            programCode: b.program_code, label: b.label, price: b.price,
            status: b.status, room: b.room, duration: b.duration
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
            const tags = await pool.query('SELECT id, tag, color FROM customer_tags WHERE customer_id = $1', [numId]);
            customer.tags = tags.rows;
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


        const result = await insertCustomerPg(input);
        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        if (isCustomerDuplicateError(err)) return sendCustomerDuplicateResponse(res);
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


        const result = await updateCustomerPg(id, input);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Клієнта не знайдено' });
        res.json(mapCustomerRow(result.rows[0]));
    } catch (err) {
        if (isCustomerDuplicateError(err)) return sendCustomerDuplicateResponse(res);
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
        childName: row.child_name || null,
        childBirthday: row.child_birthday || null,
        socialIdentities: normalizeSocialIdentities(row.social_identities, { instagram: row.instagram }),
        source: row.source || null,
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
