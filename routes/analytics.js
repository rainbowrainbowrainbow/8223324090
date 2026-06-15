/**
 * routes/analytics.js — Unified Analytics API (v16.1)
 *
 * Cross-module dashboard: bookings + finance + HR + CRM.
 * Period comparison, KPIs, trends.
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const { requireRole } = require('../middleware/auth');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const {
    resolveBusinessScope,
    requireBusinessScope,
    pushBusinessScopeCondition
} = require('../services/businessContext');
const log = createLogger('Analytics');
const SALES_LEAD_TYPE_SQL = "COALESCE(l.lead_type, 'quality') = 'quality'";

function leadTypeStatsFromRows(rows = []) {
    const stats = { quality: 0, spam: 0, collaboration: 0, informational: 0, low_quality: 0 };
    for (const row of rows || []) {
        const type = row.lead_type || 'quality';
        if (Object.prototype.hasOwnProperty.call(stats, type)) {
            stats[type] = parseInt(row.count, 10) || 0;
        }
    }
    return stats;
}

// RBAC: Analytics - manager-up, aligned with middleware/js/sidebar page access.
router.use(requireRole('manager'));

// ==========================================
// CACHE (5-minute TTL)
// ==========================================

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    return null;
}
function setCache(key, data) {
    cache.set(key, { data, ts: Date.now() });
    if (cache.size > 50) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) cache.delete(oldest[0]);
    }
}

function actorScopedCacheKey(req, prefix, ...parts) {
    const user = req.user || {};
    return [
        prefix,
        `actor=${user.id || user.userId || 'anon'}`,
        `role=${user.role || ''}`,
        `name=${user.username || user.name || ''}`,
        ...parts
    ].join(':');
}

function businessScopeCachePart(scope) {
    const contexts = Array.isArray(scope?.selectedContexts) && scope.selectedContexts.length
        ? scope.selectedContexts.join(',')
        : (scope?.activeContext || 'event_genix');
    return `business=${scope?.mode || 'single'}:${contexts}`;
}

function scopedAnalyticsCacheKey(req, prefix, scope, ...parts) {
    return actorScopedCacheKey(req, prefix, businessScopeCachePart(scope), ...parts);
}

function analyticsBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function scopedParams(scope, alias = '', baseParams = []) {
    const params = [...baseParams];
    const businessCondition = pushBusinessScopeCondition(params, scope, alias);
    return { params, businessCondition };
}

function businessScopeMeta(scope) {
    return {
        mode: scope.mode,
        activeContext: scope.activeContext,
        selectedContexts: scope.selectedContexts,
        readOnly: scope.readOnly
    };
}

// ==========================================
// HELPERS
// ==========================================

function isValidDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(str); }

function getDateRange(period) {
    // Use Intl to get Kyiv date parts without locale-dependent string parsing
    const kyivParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    const now = new Date(parseInt(kyivParts[0]), parseInt(kyivParts[1]) - 1, parseInt(kyivParts[2]));
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const dow = now.getDay() || 7;
    const fmt = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    switch (period) {
        case 'day': { const dd = fmt(y, m, d); return { from: dd, to: dd }; }
        case 'week': {
            const mon = new Date(y, m, d - (dow - 1));
            const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
            return { from: fmt(mon.getFullYear(), mon.getMonth(), mon.getDate()), to: fmt(sun.getFullYear(), sun.getMonth(), sun.getDate()) };
        }
        case 'quarter': {
            const qs = Math.floor(m / 3) * 3;
            return { from: fmt(y, qs, 1), to: fmt(y, qs + 2, new Date(y, qs + 3, 0).getDate()) };
        }
        case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
        default: return { from: fmt(y, m, 1), to: fmt(y, m, new Date(y, m + 1, 0).getDate()) };
    }
}

function getRequestDateRange(query = {}) {
    let from = query.from, to = query.to;
    if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
        const range = getDateRange(query.period || 'month');
        from = range.from; to = range.to;
    }
    return { from, to };
}

function getPrevRange(from, to) {
    const f = new Date(from + 'T00:00:00'), t = new Date(to + 'T00:00:00');
    const days = Math.round((t - f) / 86400000) + 1;
    const pt = new Date(f); pt.setDate(pt.getDate() - 1);
    const pf = new Date(pt); pf.setDate(pf.getDate() - days + 1);
    return { from: pf.toISOString().split('T')[0], to: pt.toISOString().split('T')[0] };
}

function growthPct(curr, prev) {
    if (!prev || prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function getCurrentKyivMonth() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    return `${year}-${month}`;
}

function getMonthRange(monthValue) {
    const month = String(monthValue || getCurrentKyivMonth()).trim();
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) {
        const err = new Error('month must be YYYY-MM');
        err.statusCode = 400;
        throw err;
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) {
        const err = new Error('month must be YYYY-MM');
        err.statusCode = 400;
        throw err;
    }
    const mm = String(monthNumber).padStart(2, '0');
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return {
        month: `${year}-${mm}`,
        from: `${year}-${mm}-01`,
        to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
    };
}

function normalizeFilter(value, maxLength = 120) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

const PRODUCT_SALES_PROGRAM_KEY_SQL = "CASE WHEN b.pinata_mode = 'client' THEN 'client_pinata_service' ELSE COALESCE(NULLIF(b.program_id, ''), 'custom:' || COALESCE(NULLIF(b.program_code, ''), NULLIF(b.program_name, ''), b.id)) END";
const PRODUCT_SALES_PROGRAM_ID_SQL = "CASE WHEN b.pinata_mode = 'client' THEN 'client_pinata_service' ELSE NULLIF(b.program_id, '') END";
const PRODUCT_SALES_CODE_SQL = "CASE WHEN b.pinata_mode = 'client' THEN 'SERV' ELSE COALESCE(NULLIF(b.program_code, ''), p.code, '') END";
const PRODUCT_SALES_NAME_SQL = "CASE WHEN b.pinata_mode = 'client' THEN 'Клієнтська піньята (послуга)' ELSE COALESCE(NULLIF(b.program_name, ''), p.name, NULLIF(b.label, ''), 'Невказана програма') END";
const PRODUCT_SALES_CATEGORY_SQL = "CASE WHEN b.pinata_mode = 'client' THEN 'custom' ELSE COALESCE(NULLIF(b.category, ''), p.category, 'custom') END";

function buildProductSalesWhere({ from, to, category, programId }, user, businessScope) {
    const params = [from, to];
    const where = [
        'b.date::date >= $1::date',
        'b.date::date <= $2::date',
        "b.status = 'confirmed'",
        "NULLIF(b.linked_to, '') IS NULL"
    ];
    where.push(pushBusinessScopeCondition(params, businessScope, 'b'));

    if (category) {
        params.push(category);
        where.push(`${PRODUCT_SALES_CATEGORY_SQL} = $${params.length}`);
    }

    if (programId) {
        params.push(programId);
        where.push(`${PRODUCT_SALES_PROGRAM_KEY_SQL} = $${params.length}`);
    }

    const visibility = getVisibleBookingScope(user, params, 'b');
    if (visibility.condition !== 'TRUE') {
        where.push(visibility.condition);
    }

    return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function normalizeProductSalesRow(row) {
    return {
        programKey: row.program_key,
        programId: row.program_id || '',
        code: row.code || '',
        name: row.name || 'Невказана програма',
        category: row.category || 'custom',
        count: Number(row.count) || 0,
        revenue: Number(row.revenue) || 0,
        avgPrice: Number(row.avg_price) || 0
    };
}

function normalizeProductSalesDetail(row) {
    const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || '').slice(0, 10);
    return {
        id: row.id,
        date,
        time: row.time || '',
        programKey: row.program_key,
        programId: row.program_id || '',
        code: row.code || '',
        name: row.name || 'Невказана програма',
        category: row.category || 'custom',
        groupName: row.group_name || '',
        customerName: row.customer_name || '',
        customerPhone: row.customer_phone || '',
        room: row.room || '',
        kidsCount: Number(row.kids_count) || 0,
        price: Number(row.price) || 0,
        createdBy: row.created_by || ''
    };
}

async function loadProductSalesData(query = {}, user = null, businessScope = null) {
    const range = getMonthRange(query.month);
    const category = normalizeFilter(query.category, 50);
    const programId = normalizeFilter(query.programId, 120);
    const { whereSql, params } = buildProductSalesWhere({
        from: range.from,
        to: range.to,
        category,
        programId
    }, user, businessScope || { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] });

    const [summaryResult, detailResult] = await Promise.all([
        pool.query(`
            SELECT
                ${PRODUCT_SALES_PROGRAM_KEY_SQL} AS program_key,
                ${PRODUCT_SALES_PROGRAM_ID_SQL} AS program_id,
                ${PRODUCT_SALES_CODE_SQL} AS code,
                ${PRODUCT_SALES_NAME_SQL} AS name,
                ${PRODUCT_SALES_CATEGORY_SQL} AS category,
                COUNT(*)::int AS count,
                COALESCE(SUM(COALESCE(b.price, 0)), 0)::int AS revenue,
                ROUND(COALESCE(AVG(NULLIF(COALESCE(b.price, 0), 0)), 0))::int AS avg_price
            FROM bookings b
            LEFT JOIN products p ON p.id = NULLIF(b.program_id, '')
            ${whereSql}
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY count DESC, revenue DESC, name
        `, params),
        pool.query(`
            SELECT
                b.id,
                b.date,
                b.time,
                ${PRODUCT_SALES_PROGRAM_KEY_SQL} AS program_key,
                ${PRODUCT_SALES_PROGRAM_ID_SQL} AS program_id,
                ${PRODUCT_SALES_CODE_SQL} AS code,
                ${PRODUCT_SALES_NAME_SQL} AS name,
                ${PRODUCT_SALES_CATEGORY_SQL} AS category,
                b.group_name,
                c.name AS customer_name,
                c.phone AS customer_phone,
                b.room,
                COALESCE(b.kids_count, 0)::int AS kids_count,
                COALESCE(b.price, 0)::int AS price,
                COALESCE(b.created_by, '') AS created_by
            FROM bookings b
            LEFT JOIN products p ON p.id = NULLIF(b.program_id, '')
            LEFT JOIN customers c ON c.id = b.customer_id
                AND COALESCE(c.business_context, 'event_genix') = COALESCE(b.business_context, 'event_genix')
            ${whereSql}
            ORDER BY b.date::date, b.time, b.id
        `, params)
    ]);

    const summary = summaryResult.rows.map(normalizeProductSalesRow);
    const details = detailResult.rows.map(normalizeProductSalesDetail);
    const totals = summary.reduce((acc, row) => {
        acc.count += row.count;
        acc.revenue += row.revenue;
        return acc;
    }, { count: 0, revenue: 0 });
    totals.programCount = summary.length;
    totals.avgPrice = totals.count > 0 ? Math.round(totals.revenue / totals.count) : 0;

    return {
        success: true,
        period: range,
        filters: { category: category || '', programId: programId || '' },
        businessScope: businessScope ? businessScopeMeta(businessScope) : null,
        totals,
        summary,
        details
    };
}

function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

const PRODUCT_SALES_CATEGORY_LABELS = {
    quest: 'Квести',
    animation: 'Анімації',
    show: 'Шоу',
    masterclass: 'Майстер-класи',
    photo: 'Фото',
    pinata: 'Піньяти',
    banquet: 'Банкети',
    custom: 'Інше'
};

function productSalesCategoryLabel(category) {
    return PRODUCT_SALES_CATEGORY_LABELS[category] || category || 'Інше';
}

function productSalesPartyName(row) {
    return [row.groupName, row.customerName || row.customerPhone]
        .filter(Boolean)
        .join(' / ');
}

function formatExportFilename({ month, category, programId }, format) {
    const suffix = [month, category, programId]
        .filter(Boolean)
        .map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, '_'))
        .join('_');
    return `product_sales_${suffix || 'report'}.${format}`;
}

function buildProductSalesCsv(data) {
    const detailHeaders = ['Дата', 'Час', 'Програма', 'Код', 'Категорія', 'Клієнт/група', 'Кімната', 'Дітей', 'Сума', 'ID бронювання', 'Створив'];
    const lines = [
        detailHeaders.map(csvCell).join(';'),
        ...data.details.map(row => [
            row.date, row.time, row.name, row.code, productSalesCategoryLabel(row.category), productSalesPartyName(row), row.room,
            row.kidsCount, row.price, row.id, row.createdBy
        ].map(csvCell).join(';'))
    ];
    return `\uFEFF${lines.join('\n')}`;
}

function styleProductSalesSheet(sheet, moneyColumns = []) {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 24;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length }
    };
    sheet.eachRow((row, rowNumber) => {
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            if (rowNumber > 1) {
                cell.alignment = { vertical: 'middle', wrapText: true };
            }
        });
    });
    moneyColumns.forEach(key => {
        sheet.getColumn(key).numFmt = '#,##0';
    });
}

async function buildProductSalesWorkbook(data) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Event Genix';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Підсумок');
    summarySheet.columns = [
        { header: 'Програма', key: 'name', width: 32 },
        { header: 'Код', key: 'code', width: 14 },
        { header: 'Категорія', key: 'categoryName', width: 16 },
        { header: 'Кількість', key: 'count', width: 12 },
        { header: 'Виручка', key: 'revenue', width: 14 },
        { header: 'Середній чек', key: 'avgPrice', width: 14 }
    ];
    summarySheet.addRows(data.summary.map(row => ({ ...row, categoryName: productSalesCategoryLabel(row.category) })));

    const detailSheet = workbook.addWorksheet('Виписка');
    detailSheet.columns = [
        { header: 'Дата', key: 'date', width: 13 },
        { header: 'Час', key: 'time', width: 10 },
        { header: 'Програма', key: 'name', width: 32 },
        { header: 'Код', key: 'code', width: 14 },
        { header: 'Категорія', key: 'categoryName', width: 16 },
        { header: 'Клієнт/група', key: 'partyName', width: 28 },
        { header: 'Кімната', key: 'room', width: 16 },
        { header: 'Дітей', key: 'kidsCount', width: 10 },
        { header: 'Сума', key: 'price', width: 12 },
        { header: 'ID бронювання', key: 'id', width: 18 },
        { header: 'Створив', key: 'createdBy', width: 16 }
    ];
    detailSheet.addRows(data.details.map(row => ({
        ...row,
        categoryName: productSalesCategoryLabel(row.category),
        partyName: productSalesPartyName(row)
    })));

    styleProductSalesSheet(summarySheet, ['revenue', 'avgPrice']);
    styleProductSalesSheet(detailSheet, ['price']);

    return workbook;
}

// Role check
router.use((req, res, next) => {
    if (req.user && req.user.role === 'viewer') {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
});

// ==========================================
// GET /api/analytics/overview — Unified KPI dashboard
// ==========================================

router.get('/overview', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        const period = req.query.period || 'month';
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(period);
            from = range.from; to = range.to;
        }
        const prev = getPrevRange(from, to);

        const cacheKey = scopedAnalyticsCacheKey(req, 'overview', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: bookingsCurrParams, businessCondition: bookingsCurrBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const bookingsCurrScope = getVisibleBookingScope(req.user, bookingsCurrParams, 'b');
        const { params: bookingsPrevParams, businessCondition: bookingsPrevBusiness } = scopedParams(businessScope, 'b', [prev.from, prev.to]);
        const bookingsPrevScope = getVisibleBookingScope(req.user, bookingsPrevParams, 'b');
        const { params: financeCurrParams, businessCondition: financeCurrBusiness } = scopedParams(businessScope, '', [from, to]);
        const { params: financePrevParams, businessCondition: financePrevBusiness } = scopedParams(businessScope, '', [prev.from, prev.to]);
        const { params: customersCurrParams, businessCondition: customersCurrBusiness } = scopedParams(businessScope, '', [from, to]);
        const { params: customersPrevParams, businessCondition: customersPrevBusiness } = scopedParams(businessScope, '', [prev.from, prev.to]);
        const { params: hrCurrParams, businessCondition: hrCurrBusiness } = scopedParams(businessScope, '', [from, to]);

        // Run all queries in parallel
        const [
            bookingsCurr, bookingsPrev,
            financeCurr, financePrev,
            customersCurr, customersPrev,
            hrCurr
        ] = await Promise.all([
            // Bookings — current
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE b.status='confirmed')::int AS confirmed,
                    COUNT(*) FILTER (WHERE b.status='preliminary')::int AS preliminary,
                    COALESCE(ROUND(AVG(b.price)), 0)::int AS avg_check
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.linked_to IS NULL AND b.status != 'cancelled'
                AND ${bookingsCurrBusiness}
                ${bookingsCurrScope.sql}
            `, bookingsCurrParams),
            // Bookings — previous
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                    COUNT(*)::int AS total,
                    COALESCE(ROUND(AVG(b.price)), 0)::int AS avg_check
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.linked_to IS NULL AND b.status != 'cancelled'
                AND ${bookingsPrevBusiness}
                ${bookingsPrevScope.sql}
            `, bookingsPrevParams),
            // Finance — current
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense,
                    COUNT(*) FILTER (WHERE type='income')::int AS income_count,
                    COUNT(*) FILTER (WHERE type='expense')::int AS expense_count
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                  AND ${financeCurrBusiness}
            `, financeCurrParams),
            // Finance — previous
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                  AND ${financePrevBusiness}
            `, financePrevParams),
            // Customers — current period new
            pool.query(`
                SELECT COUNT(*)::int AS new_customers
                FROM customers WHERE created_at::date >= $1::date AND created_at::date <= $2::date
                  AND ${customersCurrBusiness}
            `, customersCurrParams),
            // Customers — previous period new
            pool.query(`
                SELECT COUNT(*)::int AS new_customers
                FROM customers WHERE created_at::date >= $1::date AND created_at::date <= $2::date
                  AND ${customersPrevBusiness}
            `, customersPrevParams),
            // HR — current period hours
            pool.query(`
                SELECT
                    COALESCE(SUM(total_worked_minutes), 0)::int AS total_minutes,
                    COUNT(DISTINCT staff_id)::int AS active_staff
                FROM hr_time_records WHERE record_date >= $1 AND record_date <= $2
                  AND ${hrCurrBusiness}
            `, hrCurrParams)
        ]);

        const bc = bookingsCurr.rows[0], bp = bookingsPrev.rows[0];
        const fc = financeCurr.rows[0], fp = financePrev.rows[0];
        const cc = customersCurr.rows[0], cp = customersPrev.rows[0];
        const hr = hrCurr.rows[0];

        const data = {
            period: { from, to, prev: { from: prev.from, to: prev.to } },
            businessScope: businessScopeMeta(businessScope),
            bookings: {
                revenue: bc.revenue, total: bc.total, confirmed: bc.confirmed,
                preliminary: bc.preliminary, avgCheck: bc.avg_check,
                revenueGrowth: growthPct(bc.revenue, bp.revenue),
                countGrowth: growthPct(bc.total, bp.total),
                avgGrowth: growthPct(bc.avg_check, bp.avg_check),
                prevRevenue: bp.revenue, prevCount: bp.total
            },
            finance: {
                income: fc.income, expense: fc.expense, profit: fc.income - fc.expense,
                incomeCount: fc.income_count, expenseCount: fc.expense_count,
                incomeGrowth: growthPct(fc.income, fp.income),
                expenseGrowth: growthPct(fc.expense, fp.expense),
                profitGrowth: growthPct(fc.income - fc.expense, fp.income - fp.expense),
                prevIncome: fp.income, prevExpense: fp.expense
            },
            customers: {
                newCustomers: cc.new_customers,
                newGrowth: growthPct(cc.new_customers, cp.new_customers),
                prevNew: cp.new_customers
            },
            hr: {
                totalHours: Math.round(hr.total_minutes / 60 * 10) / 10,
                activeStaff: hr.active_staff
            }
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/analytics/charts — Chart data for period
// ==========================================

router.get('/charts', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }

        const cacheKey = scopedAnalyticsCacheKey(req, 'charts', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: dailyBookingsParams, businessCondition: dailyBookingsBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const dailyBookingsScope = getVisibleBookingScope(req.user, dailyBookingsParams, 'b');
        const { params: dailyFinanceParams, businessCondition: dailyFinanceBusiness } = scopedParams(businessScope, '', [from, to]);
        const { params: topProgramsParams, businessCondition: topProgramsBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const topProgramsScope = getVisibleBookingScope(req.user, topProgramsParams, 'b');
        const { params: topCategoriesParams, businessCondition: topCategoriesBusiness } = scopedParams(businessScope, 'ft', [from, to]);
        const { params: weekdayLoadParams, businessCondition: weekdayLoadBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const weekdayLoadScope = getVisibleBookingScope(req.user, weekdayLoadParams, 'b');
        const { params: customerSegmentsParams, businessCondition: customerSegmentsBusiness } = scopedParams(businessScope, '', []);

        const [dailyBookings, dailyFinance, topPrograms, topCategories, weekdayLoad, customerSegments] = await Promise.all([
            // Daily bookings
            pool.query(`
                SELECT date, COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.linked_to IS NULL AND b.status = 'confirmed'
                AND ${dailyBookingsBusiness}
                ${dailyBookingsScope.sql}
                GROUP BY date ORDER BY date
            `, dailyBookingsParams),
            // Daily finance
            pool.query(`
                SELECT date,
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                  AND ${dailyFinanceBusiness}
                GROUP BY date ORDER BY date
            `, dailyFinanceParams),
            // Top programs
            pool.query(`
                SELECT
                    CASE WHEN pinata_mode = 'client' THEN 'Клієнтська піньята (послуга)' ELSE program_name END AS program_name,
                    CASE WHEN pinata_mode = 'client' THEN 'custom' ELSE category END AS category,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.linked_to IS NULL AND b.status = 'confirmed'
                AND ${topProgramsBusiness}
                ${topProgramsScope.sql}
                GROUP BY 1, 2
                ORDER BY revenue DESC LIMIT 10
            `, topProgramsParams),
            // Expense categories
            pool.query(`
                SELECT fc.name, fc.icon, fc.color,
                    COALESCE(SUM(ft.amount), 0)::int AS total
                FROM finance_transactions ft
                JOIN finance_categories fc ON ft.category_id = fc.id
                WHERE ft.date::date >= $1::date AND ft.date::date <= $2::date
                  AND ${topCategoriesBusiness}
                GROUP BY fc.id, fc.name, fc.icon, fc.color
                ORDER BY total DESC
            `, topCategoriesParams),
            // Day-of-week load
            pool.query(`
                SELECT EXTRACT(ISODOW FROM date::date)::int AS dow,
                    COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.linked_to IS NULL AND b.status = 'confirmed'
                AND ${weekdayLoadBusiness}
                ${weekdayLoadScope.sql}
                GROUP BY dow ORDER BY dow
            `, weekdayLoadParams),
            // Customer segments (RFM summary)
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE total_bookings >= 5)::int AS champions,
                    COUNT(*) FILTER (WHERE total_bookings >= 3 AND total_bookings < 5)::int AS loyal,
                    COUNT(*) FILTER (WHERE total_bookings >= 1 AND total_bookings < 3)::int AS potential,
                    COUNT(*) FILTER (WHERE total_bookings = 0)::int AS inactive,
                    COUNT(*)::int AS total
                FROM customers
                WHERE ${customerSegmentsBusiness}
            `, customerSegmentsParams)
        ]);

        const DOW_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

        const data = {
            period: { from, to },
            businessScope: businessScopeMeta(businessScope),
            dailyBookings: dailyBookings.rows.map(r => ({ date: r.date, count: r.count, revenue: r.revenue })),
            dailyFinance: dailyFinance.rows.map(r => ({ date: r.date, income: r.income, expense: r.expense })),
            topPrograms: topPrograms.rows.map(r => ({
                name: r.program_name, category: r.category, count: r.count, revenue: r.revenue
            })),
            financeCategories: topCategories.rows.map(r => ({
                name: r.name, icon: r.icon, color: r.color, total: r.total
            })),
            weekdayLoad: weekdayLoad.rows.map(r => ({
                dow: r.dow, name: DOW_NAMES[r.dow], count: r.count, revenue: r.revenue
            })),
            customerSegments: customerSegments.rows[0]
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /charts error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/analytics/comparison — Side-by-side period comparison
// ==========================================

router.get('/comparison', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const prev = getPrevRange(from, to);

        const cacheKey = scopedAnalyticsCacheKey(req, 'comparison', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const metrics = [
            { key: 'bookingRevenue', label: 'Виручка бронювань', bookingScoped: true },
            { key: 'bookingCount', label: 'Кількість бронювань', bookingScoped: true },
            { key: 'finIncome', label: 'Фінанси: доходи' },
            { key: 'finExpense', label: 'Фінанси: витрати' },
            { key: 'newCustomers', label: 'Нових клієнтів' },
            { key: 'hrHours', label: 'Робочих годин' }
        ];

        const runMetric = (metric, metricFrom, metricTo) => {
            if (metric.key === 'bookingRevenue') {
                const { params, businessCondition } = scopedParams(businessScope, 'b', [metricFrom, metricTo]);
                const visibility = getVisibleBookingScope(req.user, params, 'b');
                return pool.query(`
                    SELECT COALESCE(SUM(CASE WHEN b.status='confirmed' THEN b.price ELSE 0 END), 0)::int AS val
                    FROM bookings b
                    WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                      AND b.linked_to IS NULL AND b.status != 'cancelled'
                      AND ${businessCondition}
                      ${visibility.sql}
                `, params);
            }
            if (metric.key === 'bookingCount') {
                const { params, businessCondition } = scopedParams(businessScope, 'b', [metricFrom, metricTo]);
                const visibility = getVisibleBookingScope(req.user, params, 'b');
                return pool.query(`
                    SELECT COUNT(*)::int AS val
                    FROM bookings b
                    WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                      AND b.linked_to IS NULL AND b.status != 'cancelled'
                      AND ${businessCondition}
                      ${visibility.sql}
                `, params);
            }
            if (metric.key === 'finIncome' || metric.key === 'finExpense') {
                const { params, businessCondition } = scopedParams(businessScope, 'ft', [metricFrom, metricTo]);
                const type = metric.key === 'finIncome' ? 'income' : 'expense';
                return pool.query(`
                    SELECT COALESCE(SUM(CASE WHEN ft.type = '${type}' THEN ft.amount ELSE 0 END), 0)::int AS val
                    FROM finance_transactions ft
                    WHERE ft.date::date >= $1::date
                      AND ft.date::date <= $2::date
                      AND ${businessCondition}
                `, params);
            }
            if (metric.key === 'newCustomers') {
                const { params, businessCondition } = scopedParams(businessScope, 'c', [metricFrom, metricTo]);
                return pool.query(`
                    SELECT COUNT(*)::int AS val
                    FROM customers c
                    WHERE c.created_at::date >= $1::date
                      AND c.created_at::date <= $2::date
                      AND ${businessCondition}
                `, params);
            }
            if (metric.key === 'hrHours') {
                const { params, businessCondition } = scopedParams(businessScope, 'tr', [metricFrom, metricTo]);
                return pool.query(`
                    SELECT COALESCE(ROUND(SUM(tr.total_worked_minutes) / 60.0, 1), 0)::numeric AS val
                    FROM hr_time_records tr
                    WHERE tr.record_date >= $1
                      AND tr.record_date <= $2
                      AND ${businessCondition}
                `, params);
            }
            return pool.query(metric.sql, [metricFrom, metricTo]);
        };

        const results = await Promise.all(
            metrics.flatMap(m => [
                runMetric(m, from, to),
                runMetric(m, prev.from, prev.to)
            ])
        );

        const comparison = metrics.map((m, i) => {
            const curr = parseFloat(results[i * 2].rows[0].val) || 0;
            const prevVal = parseFloat(results[i * 2 + 1].rows[0].val) || 0;
            return {
                key: m.key, label: m.label,
                current: curr, previous: prevVal,
                growth: growthPct(curr, prevVal)
            };
        });

        const data = {
            current: { from, to },
            previous: { from: prev.from, to: prev.to },
            businessScope: businessScopeMeta(businessScope),
            metrics: comparison
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /comparison error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v20.7.0: Manager Conversion Analytics
// ==========================================

router.get('/conversion', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        const { period, year, month } = req.query;
        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);

        let fromDate, toDate;
        if (period === 'week') {
            const now = new Date();
            const dayOfWeek = now.getDay() || 7;
            const monday = new Date(now);
            monday.setDate(now.getDate() - (dayOfWeek - 1));
            fromDate = monday.toISOString().split('T')[0];
            toDate = now.toISOString().split('T')[0];
        } else {
            fromDate = `${y}-${String(m).padStart(2, '0')}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            toDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
        }

        const { params: bookingParams, businessCondition: bookingBusiness } = scopedParams(businessScope, 'b', [fromDate, toDate]);
        const bookingScope = getVisibleBookingScope(req.user, bookingParams, 'b');

        // Bookings per manager (created_by)
        const result = await pool.query(`
            SELECT
                b.created_by AS manager,
                COUNT(*)::int AS total_bookings,
                COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                COALESCE(ROUND(AVG(CASE WHEN b.status = 'confirmed' THEN b.price END)), 0)::int AS avg_check
            FROM bookings b
            WHERE b.date::date >= $1::date AND b.date::date <= $2::date
              AND b.created_by IS NOT NULL
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${bookingBusiness}
              ${bookingScope.sql}
            GROUP BY b.created_by
            ORDER BY revenue DESC
        `, bookingParams);

        // Leads per manager
        const { params: leadsParams, businessCondition: leadsBusiness } = scopedParams(businessScope, 'l', [fromDate, toDate]);
        const leadsResult = await pool.query(`
            SELECT
                u.name AS manager,
                u.username,
                COUNT(*)::int AS total_leads,
                COUNT(*) FILTER (WHERE l.status = 'booked')::int AS converted
            FROM leads l
            JOIN users u ON l.assigned_to = u.id
            WHERE l.created_at >= $1 AND l.created_at <= ($2::date + INTERVAL '1 day')
              AND ${SALES_LEAD_TYPE_SQL}
              AND ${leadsBusiness}
            GROUP BY u.name, u.username
        `, leadsParams).catch(() => ({ rows: [] }));

        // Combine data
        const leadsMap = {};
        for (const r of leadsResult.rows) {
            leadsMap[r.username] = { leads: r.total_leads, converted: r.converted };
        }

        const managers = result.rows.map(r => {
            const leadData = leadsMap[r.manager] || { leads: 0, converted: 0 };
            const totalLeads = Math.max(leadData.leads, r.total_bookings);
            return {
                name: r.manager,
                leads: totalLeads,
                booked: r.confirmed,
                conversion: totalLeads > 0 ? Math.round(r.confirmed / totalLeads * 100) : 0,
                avg_check: r.avg_check,
                revenue: r.revenue,
                total_bookings: r.total_bookings
            };
        });

        res.json({ success: true, managers, period: { from: fromDate, to: toDate }, businessScope: businessScopeMeta(businessScope) });
    } catch (err) {
        log.error('GET /conversion error', err);
        res.status(500).json({ success: false, error: 'Помилка аналітики конверсії' });
    }
});

// GET /api/analytics/deals-lifecycle — accepted vs closed leads for selected range
router.get('/deals-lifecycle', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        const { from, to } = getRequestDateRange(req.query);
        const cacheKey = scopedAnalyticsCacheKey(req, 'deals-lifecycle', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const acceptedPredicate = `(COALESCE(l.pipeline_stage, '') IN ('deposit_received', 'waiting') OR COALESCE(l.status, '') = 'booked')`;
        const closedPredicate = `(COALESCE(l.pipeline_stage, '') IN ('completed', 'closed') OR COALESCE(l.status, '') = 'completed')`;
        const dateExpr = `COALESCE(l.booked_at::date, l.event_date::date, l.created_at::date)`;

        const { params: totalsParams, businessCondition: totalsBusiness } = scopedParams(businessScope, 'l', [from, to]);
        const totals = await pool.query(`
            SELECT
                COUNT(DISTINCT l.id) FILTER (WHERE ${acceptedPredicate})::int AS accepted,
                COUNT(DISTINCT l.id) FILTER (WHERE ${closedPredicate})::int AS closed,
                COUNT(DISTINCT l.id) FILTER (WHERE COALESCE(l.pipeline_stage, '') = 'lost' OR COALESCE(l.status, '') = 'lost')::int AS lost,
                COUNT(DISTINCT l.id)::int AS total
            FROM leads l
            WHERE ${dateExpr} >= $1::date
              AND ${dateExpr} <= $2::date
              AND ${SALES_LEAD_TYPE_SQL}
              AND ${totalsBusiness}
        `, totalsParams);

        const { params: trendParams, businessCondition: trendBusiness } = scopedParams(businessScope, 'l', [from, to]);
        const trend = await pool.query(`
            WITH days AS (
                SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
            ),
            lead_days AS (
                SELECT
                    ${dateExpr} AS day,
                    l.id,
                    ${acceptedPredicate} AS accepted,
                    ${closedPredicate} AS closed
                FROM leads l
                WHERE ${dateExpr} >= $1::date
                  AND ${dateExpr} <= $2::date
                  AND ${SALES_LEAD_TYPE_SQL}
                  AND ${trendBusiness}
            )
            SELECT
                days.day::text AS date,
                COUNT(DISTINCT lead_days.id) FILTER (WHERE lead_days.accepted)::int AS accepted,
                COUNT(DISTINCT lead_days.id) FILTER (WHERE lead_days.closed)::int AS closed
            FROM days
            LEFT JOIN lead_days ON lead_days.day = days.day
            GROUP BY days.day
            ORDER BY days.day
        `, trendParams);

        const { params: classificationParams, businessCondition: classificationBusiness } = scopedParams(businessScope, 'l', [from, to]);
        const classification = await pool.query(`
            SELECT COALESCE(NULLIF(l.lead_type, ''), 'quality') AS lead_type,
                   COUNT(DISTINCT l.id)::int AS count
            FROM leads l
            WHERE ${dateExpr} >= $1::date
              AND ${dateExpr} <= $2::date
              AND ${classificationBusiness}
            GROUP BY COALESCE(NULLIF(l.lead_type, ''), 'quality')
        `, classificationParams);

        const row = totals.rows[0] || {};
        const accepted = parseInt(row.accepted, 10) || 0;
        const closed = parseInt(row.closed, 10) || 0;
        const classificationStats = leadTypeStatsFromRows(classification.rows);
        const data = {
            success: true,
            period: { from, to },
            businessScope: businessScopeMeta(businessScope),
            accepted,
            closed,
            lost: parseInt(row.lost, 10) || 0,
            total: parseInt(row.total, 10) || 0,
            classificationStats,
            operationalQueueStats: {
                collaboration: classificationStats.collaboration,
                informational: classificationStats.informational,
                low_quality: classificationStats.low_quality,
                spam: classificationStats.spam
            },
            conversionRatio: accepted > 0 ? Math.round((closed / accepted) * 1000) / 10 : 0,
            trend: trend.rows,
            meta: {
                salesLeadType: 'quality',
                excludedLeadTypes: ['spam', 'collaboration', 'informational', 'low_quality'],
                acceptedStages: ['deposit_received', 'waiting'],
                closedStages: ['completed', 'closed'],
                reportability: 'snapshot-only',
                duplicateProtection: 'COUNT(DISTINCT leads.id)',
                dateBasis: 'COALESCE(leads.booked_at, leads.event_date, leads.created_at)',
                stageTimestampTruth: 'missing',
                closedExcludesLost: true
            }
        };
        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /deals-lifecycle error', err);
        res.status(500).json({ success: false, error: 'Помилка звіту accepted-vs-closed' });
    }
});

// ==========================================
// GET /api/analytics/product-sales — Monthly product sales statement
// ==========================================

router.get('/product-sales', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        const data = await loadProductSalesData(req.query, req.user, businessScope);
        res.json(data);
    } catch (err) {
        if (err.statusCode === 400) log.warn(`GET /product-sales invalid query: ${err.message}`);
        else log.error('GET /product-sales error', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.statusCode === 400 ? 'month має бути у форматі YYYY-MM' : 'Помилка звіту продажів програм'
        });
    }
});

// ==========================================
// GET /api/analytics/product-sales/export — CSV/XLSX export
// ==========================================

router.get('/product-sales/export', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        const format = String(req.query.format || 'xlsx').toLowerCase();
        if (!['xlsx', 'csv'].includes(format)) {
            return res.status(400).json({ success: false, error: 'format має бути xlsx або csv' });
        }

        const data = await loadProductSalesData(req.query, req.user, businessScope);
        const filename = formatExportFilename({
            month: data.period.month,
            category: data.filters.category,
            programId: data.filters.programId
        }, format);

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            return res.send(buildProductSalesCsv(data));
        }

        const workbook = await buildProductSalesWorkbook(data);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        if (err.statusCode === 400) log.warn(`GET /product-sales/export invalid query: ${err.message}`);
        else log.error('GET /product-sales/export error', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.statusCode === 400 ? 'month має бути у форматі YYYY-MM' : 'Помилка експорту продажів програм'
        });
    }
});

// ==========================================
// v33.3: GET /api/analytics/bookings — Booking analytics
// ==========================================

router.get('/bookings', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const cacheKey = scopedAnalyticsCacheKey(req, 'bookings', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: totalsParams, businessCondition: totalsBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const totalsScope = getVisibleBookingScope(req.user, totalsParams, 'b');
        const { params: byProgramParams, businessCondition: byProgramBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byProgramScope = getVisibleBookingScope(req.user, byProgramParams, 'b');
        const { params: byDayParams, businessCondition: byDayBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byDayScope = getVisibleBookingScope(req.user, byDayParams, 'b');
        const { params: byCategoryParams, businessCondition: byCategoryBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byCategoryScope = getVisibleBookingScope(req.user, byCategoryParams, 'b');
        const { params: byWeekdayParams, businessCondition: byWeekdayBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byWeekdayScope = getVisibleBookingScope(req.user, byWeekdayParams, 'b');

        const [totalsR, byProgramR, byDayR, byCategoryR, byWeekdayR] = await Promise.all([
            pool.query(`
                SELECT COUNT(*)::int AS total,
                       COALESCE(SUM(b.price), 0)::int AS revenue,
                       ROUND(COALESCE(AVG(b.price), 0))::int AS avg_check,
                       COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                       COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS preliminary
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.status != 'cancelled' AND b.linked_to IS NULL
                AND ${totalsBusiness}
                ${totalsScope.sql}
            `, totalsParams),
            pool.query(`
                SELECT
                    CASE WHEN pinata_mode = 'client' THEN 'Клієнтська піньята (послуга)' ELSE program_name END AS name,
                    CASE WHEN pinata_mode = 'client' THEN 'SERV' ELSE program_code END AS code,
                    CASE WHEN pinata_mode = 'client' THEN 'custom' ELSE category END AS category,
                       COUNT(*)::int AS count, COALESCE(SUM(b.price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.status != 'cancelled' AND b.linked_to IS NULL
                AND ${byProgramBusiness}
                ${byProgramScope.sql}
                GROUP BY 1, 2, 3 ORDER BY revenue DESC LIMIT 15
            `, byProgramParams),
            pool.query(`
                SELECT b.date, COUNT(*)::int AS count, COALESCE(SUM(b.price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.status != 'cancelled' AND b.linked_to IS NULL
                AND ${byDayBusiness}
                ${byDayScope.sql}
                GROUP BY b.date ORDER BY b.date
            `, byDayParams),
            pool.query(`
                SELECT CASE WHEN pinata_mode = 'client' THEN 'custom' ELSE category END AS category,
                       COUNT(*)::int AS count, COALESCE(SUM(b.price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.status != 'cancelled' AND b.linked_to IS NULL AND b.category IS NOT NULL
                AND ${byCategoryBusiness}
                ${byCategoryScope.sql}
                GROUP BY 1 ORDER BY revenue DESC
            `, byCategoryParams),
            pool.query(`
                SELECT EXTRACT(ISODOW FROM b.date::date)::int AS dow, COUNT(*)::int AS count,
                       COALESCE(SUM(b.price), 0)::int AS revenue
                FROM bookings b WHERE b.date::date >= $1::date AND b.date::date <= $2::date
                AND b.status != 'cancelled' AND b.linked_to IS NULL
                AND ${byWeekdayBusiness}
                ${byWeekdayScope.sql}
                GROUP BY EXTRACT(ISODOW FROM b.date::date) ORDER BY dow
            `, byWeekdayParams)
        ]);

        const DOW_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
        const data = {
            from, to,
            businessScope: businessScopeMeta(businessScope),
            totals: totalsR.rows[0],
            byProgram: byProgramR.rows,
            byDay: byDayR.rows,
            byCategory: byCategoryR.rows,
            byWeekday: byWeekdayR.rows.map(r => ({ ...r, name: DOW_NAMES[r.dow] || r.dow }))
        };
        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /bookings error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v33.3: GET /api/analytics/revenue — Revenue analytics
// ==========================================

router.get('/revenue', async (req, res) => {
    try {
        const businessScope = analyticsBusinessScope(req, res);
        if (!businessScope) return;
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const cacheKey = scopedAnalyticsCacheKey(req, 'revenue', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: totalsParams, businessCondition: totalsBusiness } = scopedParams(businessScope, '', [from, to]);
        const { params: byCategoryParams, businessCondition: byCategoryBusiness } = scopedParams(businessScope, 'ft', [from, to]);
        const { params: monthlyParams, businessCondition: monthlyBusiness } = scopedParams(businessScope, '', [from, to]);
        const [totalsR, byCategoryR, monthlyR] = await Promise.all([
            pool.query(`
                SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS total_income,
                       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS total_expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                  AND ${totalsBusiness}
            `, totalsParams),
            pool.query(`
                SELECT fc.name AS category, fc.type, fc.icon, fc.color,
                       COUNT(*)::int AS count, COALESCE(SUM(ft.amount), 0)::int AS total
                FROM finance_transactions ft
                LEFT JOIN finance_categories fc ON ft.category_id = fc.id
                WHERE ft.date::date >= $1::date AND ft.date::date <= $2::date
                  AND ${byCategoryBusiness}
                GROUP BY fc.id, fc.name, fc.type, fc.icon, fc.color ORDER BY total DESC
            `, byCategoryParams),
            pool.query(`
                SELECT TO_CHAR(date::date, 'YYYY-MM') AS month,
                       COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                  AND ${monthlyBusiness}
                GROUP BY TO_CHAR(date::date, 'YYYY-MM') ORDER BY month
            `, monthlyParams)
        ]);

        const t = totalsR.rows[0];
        const data = {
            from, to,
            businessScope: businessScopeMeta(businessScope),
            totals: { totalIncome: t.total_income, totalExpense: t.total_expense, profit: t.total_income - t.total_expense },
            byCategory: byCategoryR.rows,
            monthly: monthlyR.rows
        };
        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('GET /revenue error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
