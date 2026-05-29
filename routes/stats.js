/**
 * routes/stats.js — Revenue Dashboard analytics endpoints
 * Mount in server.js: app.use('/api/stats', auth, statsRoutes)
 *
 * All endpoints require authentication (handled by parent middleware in server.js).
 * Viewers are excluded — only admin and user roles can access.
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

const log = createLogger('Stats');

// ==========================================
// IN-MEMORY CACHE (5-minute TTL)
// ==========================================

const statsCache = new Map();
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const STATS_CACHE_MAX = 50;

function getCached(key) {
    const entry = statsCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts < STATS_CACHE_TTL) {
        // v19.16: LRU — move to end (most recently used)
        statsCache.delete(key);
        statsCache.set(key, entry);
        return entry.data;
    }
    // Expired — remove
    statsCache.delete(key);
    return null;
}

function setCache(key, data) {
    // v19.16: LRU eviction — Map preserves insertion order, oldest is first
    if (statsCache.has(key)) statsCache.delete(key);
    statsCache.set(key, { data, ts: Date.now() });
    while (statsCache.size > STATS_CACHE_MAX) {
        const firstKey = statsCache.keys().next().value;
        statsCache.delete(firstKey);
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

function scopedStatsCacheKey(req, prefix, scope, ...parts) {
    return actorScopedCacheKey(req, prefix, businessScopeCachePart(scope), ...parts);
}

function statsBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function scopedParams(scope, alias = 'b', baseParams = []) {
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

/** Validate YYYY-MM-DD date string */
function isValidDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

/** Compute date range from period keyword (Europe/Kyiv timezone) */
function getDateRange(period) {
    // Use Kyiv timezone for "today"
    const kyivParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    const nowKyiv = new Date(parseInt(kyivParts[0]), parseInt(kyivParts[1]) - 1, parseInt(kyivParts[2]));
    const year = nowKyiv.getFullYear();
    const month = nowKyiv.getMonth();
    const day = nowKyiv.getDate();
    const dow = nowKyiv.getDay() || 7; // 1=Mon ... 7=Sun (ISO)

    switch (period) {
        case 'day': {
            const d = formatDateISO(year, month, day);
            return { from: d, to: d };
        }
        case 'week': {
            const monOffset = dow - 1;
            const monday = new Date(year, month, day - monOffset);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            return {
                from: formatDateISO(monday.getFullYear(), monday.getMonth(), monday.getDate()),
                to: formatDateISO(sunday.getFullYear(), sunday.getMonth(), sunday.getDate())
            };
        }
        case 'quarter': {
            const qStart = Math.floor(month / 3) * 3;
            const qEnd = qStart + 2;
            const lastDay = new Date(year, qEnd + 1, 0).getDate();
            return {
                from: formatDateISO(year, qStart, 1),
                to: formatDateISO(year, qEnd, lastDay)
            };
        }
        case 'year': {
            return {
                from: `${year}-01-01`,
                to: `${year}-12-31`
            };
        }
        case 'month':
        default: {
            const lastDay = new Date(year, month + 1, 0).getDate();
            return {
                from: formatDateISO(year, month, 1),
                to: formatDateISO(year, month, lastDay)
            };
        }
    }
}

/** Compute the previous period range (same length, immediately before) */
function getPreviousRange(from, to) {
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    const days = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
    const prevTo = new Date(fromDate);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - days + 1);
    return {
        from: prevFrom.toISOString().split('T')[0],
        to: prevTo.toISOString().split('T')[0]
    };
}

function formatDateISO(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Day-of-week names (Ukrainian, ISO order) */
const DAY_NAMES = {
    1: 'Понеділок',
    2: 'Вівторок',
    3: 'Середа',
    4: 'Четвер',
    5: "П'ятниця",
    6: 'Субота',
    7: 'Неділя'
};

/** Category display names (Ukrainian) */
const CATEGORY_NAMES = {
    quest: 'Квести',
    animation: 'Анімація',
    show: 'Шоу',
    photo: 'Фото',
    masterclass: 'Майстер-класи',
    pinata: 'Піньяти',
    custom: 'Інше'
};

// ==========================================
// ROLE CHECK — block viewers
// ==========================================

router.use(requireRole('manager'));

// ==========================================
// GET /revenue — Aggregated revenue + daily breakdown + comparison
// ==========================================

router.get('/revenue', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const period = req.query.period || 'month';
        let from = req.query.from;
        let to = req.query.to;

        // If custom dates provided and valid, use them; otherwise compute from period
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(period);
            from = range.from;
            to = range.to;
        }

        const cacheKey = scopedStatsCacheKey(req, 'revenue', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: totalsParams, businessCondition: totalsBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const totalsScope = getVisibleBookingScope(req.user, totalsParams, 'b');

        // Totals for current period
        const totalsResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS confirmed_revenue,
                COALESCE(SUM(b.price), 0)::int AS total_revenue,
                COUNT(*)::int AS total_count,
                COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed_count,
                COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS preliminary_count,
                COALESCE(ROUND(AVG(b.price)), 0)::int AS avg_price
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${totalsBusiness}
              ${totalsScope.sql}
        `, totalsParams);

        const t = totalsResult.rows[0];

        // Previous period for comparison
        const prev = getPreviousRange(from, to);
        const { params: prevParams, businessCondition: prevBusiness } = scopedParams(businessScope, 'b', [prev.from, prev.to]);
        const prevScope = getVisibleBookingScope(req.user, prevParams, 'b');
        const prevResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS confirmed_revenue,
                COALESCE(SUM(b.price), 0)::int AS total_revenue,
                COUNT(*)::int AS total_count,
                COALESCE(ROUND(AVG(b.price)), 0)::int AS avg_price
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${prevBusiness}
              ${prevScope.sql}
        `, prevParams);

        const p = prevResult.rows[0];

        const { params: dailyParams, businessCondition: dailyBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const dailyScope = getVisibleBookingScope(req.user, dailyParams, 'b');

        // Daily breakdown
        const dailyResult = await pool.query(`
            SELECT b.date,
                COALESCE(SUM(b.price), 0)::int AS revenue,
                COUNT(*)::int AS count
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${dailyBusiness}
              ${dailyScope.sql}
            GROUP BY b.date
            ORDER BY b.date
        `, dailyParams);

        // Compute growth percentages
        function growthPct(current, previous) {
            if (!previous || previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        }

        const data = {
            period: { from, to },
            businessScope: businessScopeMeta(businessScope),
            totals: {
                revenue: t.total_revenue,
                confirmedRevenue: t.confirmed_revenue,
                count: t.total_count,
                average: t.avg_price,
                confirmedCount: t.confirmed_count,
                preliminaryCount: t.preliminary_count
            },
            comparison: {
                prevRevenue: p.total_revenue,
                prevCount: p.total_count,
                prevAverage: p.avg_price,
                revenueGrowth: growthPct(t.confirmed_revenue, p.confirmed_revenue),
                countGrowth: growthPct(t.total_count, p.total_count),
                averageGrowth: growthPct(t.avg_price, p.avg_price)
            },
            daily: dailyResult.rows.map(r => ({
                date: r.date,
                revenue: r.revenue,
                count: r.count
            }))
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('Stats revenue error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /programs — Program popularity and revenue rankings
// ==========================================

router.get('/programs', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const range = getDateRange(req.query.period || 'month');
        const from = (req.query.from && isValidDate(req.query.from)) ? req.query.from : range.from;
        const to = (req.query.to && isValidDate(req.query.to)) ? req.query.to : range.to;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        const cacheKey = scopedStatsCacheKey(req, 'programs', businessScope, from, to, limit);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: byCountParams, businessCondition: byCountBusiness } = scopedParams(businessScope, 'b', [from, to, limit]);
        const byCountScope = getVisibleBookingScope(req.user, byCountParams, 'b');

        // Top programs by count
        const byCountResult = await pool.query(`
            SELECT b.program_id, b.program_name, b.category,
                COUNT(*)::int AS count,
                COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status = 'confirmed'
              AND ${byCountBusiness}
              ${byCountScope.sql}
            GROUP BY b.program_id, b.program_name, b.category
            ORDER BY count DESC
            LIMIT $3
        `, byCountParams);

        const { params: byRevenueParams, businessCondition: byRevenueBusiness } = scopedParams(businessScope, 'b', [from, to, limit]);
        const byRevenueScope = getVisibleBookingScope(req.user, byRevenueParams, 'b');

        // Top programs by revenue
        const byRevenueResult = await pool.query(`
            SELECT b.program_id, b.program_name, b.category,
                COUNT(*)::int AS count,
                COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status = 'confirmed'
              AND ${byRevenueBusiness}
              ${byRevenueScope.sql}
            GROUP BY b.program_id, b.program_name, b.category
            ORDER BY revenue DESC
            LIMIT $3
        `, byRevenueParams);

        const { params: byCategoryParams, businessCondition: byCategoryBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byCategoryScope = getVisibleBookingScope(req.user, byCategoryParams, 'b');

        // By category
        const byCategoryResult = await pool.query(`
            SELECT b.category,
                COUNT(*)::int AS count,
                COALESCE(SUM(b.price), 0)::int AS revenue,
                ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS pct
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status = 'confirmed'
              AND ${byCategoryBusiness}
              ${byCategoryScope.sql}
            GROUP BY b.category
            ORDER BY count DESC
        `, byCategoryParams);

        const data = {
            period: { from, to },
            businessScope: businessScopeMeta(businessScope),
            byCount: byCountResult.rows.map(r => ({
                programId: r.program_id,
                programName: r.program_name,
                category: r.category,
                count: r.count,
                revenue: r.revenue
            })),
            byRevenue: byRevenueResult.rows.map(r => ({
                programId: r.program_id,
                programName: r.program_name,
                category: r.category,
                count: r.count,
                revenue: r.revenue
            })),
            byCategory: byCategoryResult.rows.map(r => ({
                category: r.category,
                categoryName: CATEGORY_NAMES[r.category] || r.category,
                count: r.count,
                revenue: r.revenue,
                pct: parseFloat(r.pct) || 0
            }))
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('Stats programs error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /load — Workload analytics (day-of-week, hour, room, animator)
// ==========================================

router.get('/load', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const range = getDateRange(req.query.period || 'month');
        const from = (req.query.from && isValidDate(req.query.from)) ? req.query.from : range.from;
        const to = (req.query.to && isValidDate(req.query.to)) ? req.query.to : range.to;

        const cacheKey = scopedStatsCacheKey(req, 'load', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: byDowParams, businessCondition: byDowBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byDowScope = getVisibleBookingScope(req.user, byDowParams, 'b');

        // By day of week (ISODOW: 1=Monday ... 7=Sunday)
        const byDowResult = await pool.query(`
            SELECT
                EXTRACT(ISODOW FROM b.date::date)::int AS day_num,
                COUNT(*)::int AS count,
                COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND ${byDowBusiness}
              ${byDowScope.sql}
            GROUP BY day_num
            ORDER BY day_num
        `, byDowParams);

        const { params: byHourParams, businessCondition: byHourBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const byHourScope = getVisibleBookingScope(req.user, byHourParams, 'b');

        // By hour of day
        const byHourResult = await pool.query(`
            SELECT
                CAST(SUBSTRING(b.time FROM 1 FOR 2) AS INTEGER) AS hour,
                COUNT(*)::int AS count
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND ${byHourBusiness}
              ${byHourScope.sql}
            GROUP BY hour
            ORDER BY hour
        `, byHourParams);

        const { params: roomParams, businessCondition: roomBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const roomScope = getVisibleBookingScope(req.user, roomParams, 'b');

        // Room utilization
        const roomResult = await pool.query(`
            SELECT b.room,
                COUNT(*)::int AS booking_count,
                COALESCE(SUM(b.duration), 0)::int AS total_minutes
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND b.room IS NOT NULL AND b.room != ''
              AND ${roomBusiness}
              ${roomScope.sql}
            GROUP BY b.room
            ORDER BY total_minutes DESC
        `, roomParams);

        // Count business days in range for utilization calculation
        const fromDate = new Date(from + 'T00:00:00');
        const toDate = new Date(to + 'T00:00:00');
        let totalAvailableMinutes = 0;
        const d = new Date(fromDate);
        while (d <= toDate) {
            const dow = d.getDay();
            // Weekday: 12-20 (480min), Weekend: 10-20 (600min)
            totalAvailableMinutes += (dow === 0 || dow === 6) ? 600 : 480;
            d.setDate(d.getDate() + 1);
        }

        // Animator workload — group by line_id only, pick latest name
        const { params: animatorParams, businessCondition: animatorBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const animatorScope = getVisibleBookingScope(req.user, animatorParams, 'b');

        const animatorResult = await pool.query(`
            SELECT b.line_id,
                MAX(l.name) AS animator_name,
                COUNT(DISTINCT b.id)::int AS booking_count,
                COALESCE(SUM(b.duration), 0)::int AS total_minutes
            FROM bookings b
            LEFT JOIN lines_by_date l ON b.line_id = l.line_id AND b.date = l.date AND COALESCE(l.business_context, 'event_genix') = COALESCE(b.business_context, 'event_genix')
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND ${animatorBusiness}
              ${animatorScope.sql}
            GROUP BY b.line_id
            ORDER BY booking_count DESC
        `, animatorParams);

        const data = {
            period: { from, to },
            businessScope: businessScopeMeta(businessScope),
            byDayOfWeek: byDowResult.rows.map(r => ({
                day: r.day_num,
                dayName: DAY_NAMES[r.day_num] || '',
                count: r.count,
                revenue: r.revenue
            })),
            byHour: byHourResult.rows.map(r => ({
                hour: r.hour,
                count: r.count
            })),
            roomUtilization: roomResult.rows.map(r => ({
                room: r.room,
                bookingCount: r.booking_count,
                totalMinutes: r.total_minutes,
                utilizationPct: totalAvailableMinutes > 0
                    ? Math.round(r.total_minutes / totalAvailableMinutes * 1000) / 10
                    : 0
            })),
            animatorWorkload: animatorResult.rows.map(r => ({
                lineId: r.line_id,
                animatorName: r.animator_name,
                bookingCount: r.booking_count,
                totalMinutes: r.total_minutes
            }))
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('Stats load error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /trends — Period-over-period comparison
// ==========================================

router.get('/trends', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const period = req.query.period || 'month';
        const range = getDateRange(period);
        const from = range.from;
        const to = range.to;
        const prev = getPreviousRange(from, to);

        const cacheKey = scopedStatsCacheKey(req, 'trends', businessScope, from, to);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const { params: currentParams, businessCondition: currentBusiness } = scopedParams(businessScope, 'b', [from, to]);
        const currentScope = getVisibleBookingScope(req.user, currentParams, 'b');

        // Current period
        const currentResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(b.price)), 0)::int AS average
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${currentBusiness}
              ${currentScope.sql}
        `, currentParams);

        const { params: prevParams, businessCondition: prevBusiness } = scopedParams(businessScope, 'b', [prev.from, prev.to]);
        const prevScope = getVisibleBookingScope(req.user, prevParams, 'b');

        // Previous period
        const prevResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(b.price)), 0)::int AS average
            FROM bookings b
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL
              AND b.status != 'cancelled'
              AND ${prevBusiness}
              ${prevScope.sql}
        `, prevParams);

        const c = currentResult.rows[0];
        const p = prevResult.rows[0];

        function growthPct(current, previous) {
            if (!previous || previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        }

        const data = {
            businessScope: businessScopeMeta(businessScope),
            current: {
                from, to,
                revenue: c.revenue,
                count: c.count,
                average: c.average
            },
            previous: {
                from: prev.from, to: prev.to,
                revenue: p.revenue,
                count: p.count,
                average: p.average
            },
            growth: {
                revenue: growthPct(c.revenue, p.revenue),
                count: growthPct(c.count, p.count),
                average: growthPct(c.average, p.average)
            }
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('Stats trends error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /forecast — Predictive booking load (v22.18)
// ==========================================

router.get('/forecast', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const days = Math.min(parseInt(req.query.days) || 14, 60);
        const cacheKey = scopedStatsCacheKey(req, 'forecast', businessScope, days);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        // Analyze last 12 weeks of booking data by day-of-week and hour
        const lookback = new Date();
        lookback.setDate(lookback.getDate() - 84);
        const lookbackStr = lookback.toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];

        const { params: dowParams, businessCondition: dowBusiness } = scopedParams(businessScope, 'b', [lookbackStr, todayStr]);
        const dowScope = getVisibleBookingScope(req.user, dowParams, 'b');
        const dowAvg = await pool.query(`
            SELECT
                EXTRACT(ISODOW FROM date::date)::int AS dow,
                ROUND(AVG(day_count), 1)::float AS avg_bookings,
                MAX(day_count)::int AS peak_bookings,
                ROUND(AVG(day_revenue))::int AS avg_revenue
            FROM (
                SELECT b.date, COUNT(*) AS day_count, COALESCE(SUM(b.price), 0) AS day_revenue
                FROM bookings b
                WHERE b.date >= $1 AND b.date < $2
                  AND b.linked_to IS NULL AND b.status = 'confirmed'
                  AND ${dowBusiness}
                  ${dowScope.sql}
                GROUP BY b.date
            ) daily
            GROUP BY EXTRACT(ISODOW FROM daily.date::date)
            ORDER BY dow
        `, dowParams);

        // Hourly pattern
        const hourParams = [lookbackStr, todayStr];
        const hourSubBusiness = pushBusinessScopeCondition(hourParams, businessScope, 'b2');
        const hourSubScope = getVisibleBookingScope(req.user, hourParams, 'b2');
        const hourMainBusiness = pushBusinessScopeCondition(hourParams, businessScope, 'b');
        const hourMainScope = getVisibleBookingScope(req.user, hourParams, 'b');
        const hourAvg = await pool.query(`
            SELECT
                CAST(SUBSTRING(b.time FROM 1 FOR 2) AS INTEGER) AS hour,
                ROUND(COUNT(*)::numeric / GREATEST(1, (SELECT COUNT(DISTINCT b2.date) FROM bookings b2 WHERE b2.date >= $1 AND b2.date < $2 AND b2.linked_to IS NULL AND b2.status = 'confirmed' AND ${hourSubBusiness} ${hourSubScope.sql})), 2)::float AS avg_per_day
            FROM bookings b
            WHERE b.date >= $1 AND b.date < $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND ${hourMainBusiness}
              ${hourMainScope.sql}
            GROUP BY hour
            ORDER BY hour
        `, hourParams);

        // Weekly trend (is load growing or shrinking?)
        const { params: weeklyParams, businessCondition: weeklyBusiness } = scopedParams(businessScope, 'b', [lookbackStr, todayStr]);
        const weeklyScope = getVisibleBookingScope(req.user, weeklyParams, 'b');
        const weeklyTrend = await pool.query(`
            SELECT
                EXTRACT(WEEK FROM b.date::date)::int AS week_num,
                COUNT(*)::int AS bookings,
                COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date >= $1 AND b.date < $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
              AND ${weeklyBusiness}
              ${weeklyScope.sql}
            GROUP BY week_num
            ORDER BY week_num
        `, weeklyParams);

        // Calculate growth trend (simple linear regression slope)
        const weeks = weeklyTrend.rows;
        let trendSlope = 0;
        if (weeks.length >= 3) {
            const n = weeks.length;
            const xMean = (n - 1) / 2;
            const yMean = weeks.reduce((s, w) => s + w.bookings, 0) / n;
            let num = 0, den = 0;
            weeks.forEach((w, i) => {
                num += (i - xMean) * (w.bookings - yMean);
                den += (i - xMean) ** 2;
            });
            if (den > 0) trendSlope = Math.round(num / den * 10) / 10;
        }

        // Build day-of-week average map
        const dowMap = {};
        for (const r of dowAvg.rows) {
            dowMap[r.dow] = { avg: r.avg_bookings, peak: r.peak_bookings, avgRevenue: r.avg_revenue };
        }

        // Generate forecast for next N days
        const forecast = [];
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dow = date.getDay() === 0 ? 7 : date.getDay(); // ISODOW
            const base = dowMap[dow] || { avg: 0, peak: 0, avgRevenue: 0 };

            // Apply trend adjustment (growth per week * weeks ahead)
            const weeksAhead = i / 7;
            const trendAdj = 1 + (trendSlope * weeksAhead / Math.max(1, base.avg || 1));
            const predicted = Math.round(base.avg * Math.max(0.5, Math.min(1.5, trendAdj)) * 10) / 10;

            forecast.push({
                date: dateStr,
                dayName: DAY_NAMES[dow] || '',
                predicted,
                peak: base.peak,
                avgRevenue: base.avgRevenue,
                confidence: weeks.length >= 8 ? 'high' : weeks.length >= 4 ? 'medium' : 'low'
            });
        }

        // Peak hours (sorted by avg bookings)
        const peakHours = hourAvg.rows
            .sort((a, b) => b.avg_per_day - a.avg_per_day)
            .slice(0, 5)
            .map(r => ({ hour: r.hour, avgPerDay: r.avg_per_day }));

        // Peak days (sorted by avg bookings)
        const peakDays = dowAvg.rows
            .sort((a, b) => b.avg_bookings - a.avg_bookings)
            .slice(0, 3)
            .map(r => ({ day: r.dow, dayName: DAY_NAMES[r.dow], avg: r.avg_bookings }));

        const data = {
            businessScope: businessScopeMeta(businessScope),
            forecast,
            peakHours,
            peakDays,
            trendSlope,
            trendDirection: trendSlope > 0.5 ? 'growing' : trendSlope < -0.5 ? 'declining' : 'stable',
            dataWeeks: weeks.length,
            hourlyPattern: hourAvg.rows
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        log.error('Stats forecast error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /reviews — Event reviews summary (v22.18)
// ==========================================

router.get('/reviews', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const cacheKey = scopedStatsCacheKey(req, 'reviews-summary', businessScope);
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const summaryParams = [];
        const summaryBusiness = pushBusinessScopeCondition(summaryParams, businessScope, 'er');
        const summaryScope = getVisibleBookingScope(req.user, summaryParams, 'b');
        const summary = await pool.query(`
            SELECT
                COUNT(*)::int AS total_reviews,
                ROUND(AVG(rating), 1)::float AS avg_rating,
                COUNT(CASE WHEN rating >= 4 THEN 1 END)::int AS positive,
                COUNT(CASE WHEN rating <= 2 THEN 1 END)::int AS negative
            FROM event_reviews er
            LEFT JOIN bookings b ON b.id = er.booking_id
            WHERE ${summaryBusiness}
              AND (er.booking_id IS NULL OR (${summaryScope.condition}))
        `, summaryParams);

        const recentParams = [];
        const recentBusiness = pushBusinessScopeCondition(recentParams, businessScope, 'er');
        const recentScope = getVisibleBookingScope(req.user, recentParams, 'b');
        const recent = await pool.query(`
            SELECT er.id, er.rating, er.customer_name, er.comment, er.created_at,
                   b.label, b.program_name, b.date
            FROM event_reviews er
            LEFT JOIN bookings b ON b.id = er.booking_id
            WHERE ${recentBusiness}
              AND (er.booking_id IS NULL OR (${recentScope.condition}))
            ORDER BY er.created_at DESC
            LIMIT 20
        `, recentParams);

        const byRatingParams = [];
        const byRatingBusiness = pushBusinessScopeCondition(byRatingParams, businessScope, 'er');
        const byRatingScope = getVisibleBookingScope(req.user, byRatingParams, 'b');
        const byRating = await pool.query(`
            SELECT er.rating, COUNT(*)::int AS count
            FROM event_reviews er
            LEFT JOIN bookings b ON b.id = er.booking_id
            WHERE ${byRatingBusiness}
              AND (er.booking_id IS NULL OR (${byRatingScope.condition}))
            GROUP BY er.rating
            ORDER BY rating
        `, byRatingParams);

        const data = {
            businessScope: businessScopeMeta(businessScope),
            summary: summary.rows[0] || { total_reviews: 0, avg_rating: 0, positive: 0, negative: 0 },
            recent: recent.rows,
            distribution: byRating.rows
        };

        setCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        if (err.message.includes('does not exist')) {
            return res.json({ summary: { total_reviews: 0, avg_rating: 0 }, recent: [], distribution: [] });
        }
        log.error('Stats reviews error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /pulse — Team pulse summary (v22.18)
// ==========================================

router.get('/pulse', async (req, res) => {
    try {
        const businessScope = statsBusinessScope(req, res);
        if (!businessScope) return;
        const days = Math.min(parseInt(req.query.days) || 30, 90);
        const dailyParams = [days];
        const dailyBusiness = pushBusinessScopeCondition(dailyParams, businessScope, '');

        const daily = await pool.query(`
            SELECT date, ROUND(AVG(score), 1)::float AS avg_score,
                   COUNT(*)::int AS responses
            FROM team_pulse
            WHERE date::date >= CURRENT_DATE - ($1 || ' days')::interval
              AND ${dailyBusiness}
            GROUP BY date
            ORDER BY date
        `, dailyParams);

        const overallParams = [days];
        const overallBusiness = pushBusinessScopeCondition(overallParams, businessScope, '');
        const overall = await pool.query(`
            SELECT ROUND(AVG(score), 1)::float AS avg_score,
                   COUNT(*)::int AS total_responses
            FROM team_pulse
            WHERE date::date >= CURRENT_DATE - ($1 || ' days')::interval
              AND ${overallBusiness}
        `, overallParams);

        const todayParams = [];
        const todayBusiness = pushBusinessScopeCondition(todayParams, businessScope, '');
        const todayPulse = await pool.query(`
            SELECT ROUND(AVG(score), 1)::float AS avg_score,
                   COUNT(*)::int AS responses
            FROM team_pulse
            WHERE date = CURRENT_DATE
              AND ${todayBusiness}
        `, todayParams);

        res.json({
            businessScope: businessScopeMeta(businessScope),
            today: todayPulse.rows[0] || { avg_score: null, responses: 0 },
            overall: overall.rows[0] || { avg_score: null, total_responses: 0 },
            daily: daily.rows
        });
    } catch (err) {
        if (err.message.includes('does not exist')) {
            return res.json({ today: { avg_score: null, responses: 0 }, overall: { avg_score: null, total_responses: 0 }, daily: [] });
        }
        log.error('Stats pulse error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
