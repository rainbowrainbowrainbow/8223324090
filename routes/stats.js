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

const log = createLogger('Stats');

// ==========================================
// IN-MEMORY CACHE (5-minute TTL)
// ==========================================

const statsCache = new Map();
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
    const entry = statsCache.get(key);
    if (entry && Date.now() - entry.ts < STATS_CACHE_TTL) return entry.data;
    return null;
}

function setCache(key, data) {
    statsCache.set(key, { data, ts: Date.now() });
    // Cleanup: limit cache size to 50 entries
    if (statsCache.size > 50) {
        const oldest = [...statsCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) statsCache.delete(oldest[0]);
    }
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
    const nowKyiv = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
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

router.use((req, res, next) => {
    if (req.user && req.user.role === 'viewer') {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
});

// ==========================================
// GET /revenue — Aggregated revenue + daily breakdown + comparison
// ==========================================

router.get('/revenue', async (req, res) => {
    try {
        const period = req.query.period || 'month';
        let from = req.query.from;
        let to = req.query.to;

        // If custom dates provided and valid, use them; otherwise compute from period
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(period);
            from = range.from;
            to = range.to;
        }

        const cacheKey = `revenue:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        // Totals for current period
        const totalsResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS confirmed_revenue,
                COALESCE(SUM(price), 0)::int AS total_revenue,
                COUNT(*)::int AS total_count,
                COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_count,
                COUNT(*) FILTER (WHERE status = 'preliminary')::int AS preliminary_count,
                COALESCE(ROUND(AVG(price)), 0)::int AS avg_price
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status != 'cancelled'
        `, [from, to]);

        const t = totalsResult.rows[0];

        // Previous period for comparison
        const prev = getPreviousRange(from, to);
        const prevResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS confirmed_revenue,
                COALESCE(SUM(price), 0)::int AS total_revenue,
                COUNT(*)::int AS total_count,
                COALESCE(ROUND(AVG(price)), 0)::int AS avg_price
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status != 'cancelled'
        `, [prev.from, prev.to]);

        const p = prevResult.rows[0];

        // Daily breakdown
        const dailyResult = await pool.query(`
            SELECT date,
                COALESCE(SUM(price), 0)::int AS revenue,
                COUNT(*)::int AS count
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status != 'cancelled'
            GROUP BY date
            ORDER BY date
        `, [from, to]);

        // Compute growth percentages
        function growthPct(current, previous) {
            if (!previous || previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        }

        const data = {
            period: { from, to },
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
        const range = getDateRange(req.query.period || 'month');
        const from = (req.query.from && isValidDate(req.query.from)) ? req.query.from : range.from;
        const to = (req.query.to && isValidDate(req.query.to)) ? req.query.to : range.to;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        const cacheKey = `programs:${from}:${to}:${limit}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        // Top programs by count
        const byCountResult = await pool.query(`
            SELECT program_id, program_name, category,
                COUNT(*)::int AS count,
                COALESCE(SUM(price), 0)::int AS revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status = 'confirmed'
            GROUP BY program_id, program_name, category
            ORDER BY count DESC
            LIMIT $3
        `, [from, to, limit]);

        // Top programs by revenue
        const byRevenueResult = await pool.query(`
            SELECT program_id, program_name, category,
                COUNT(*)::int AS count,
                COALESCE(SUM(price), 0)::int AS revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status = 'confirmed'
            GROUP BY program_id, program_name, category
            ORDER BY revenue DESC
            LIMIT $3
        `, [from, to, limit]);

        // By category
        const byCategoryResult = await pool.query(`
            SELECT category,
                COUNT(*)::int AS count,
                COALESCE(SUM(price), 0)::int AS revenue,
                ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS pct
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status = 'confirmed'
            GROUP BY category
            ORDER BY count DESC
        `, [from, to]);

        const data = {
            period: { from, to },
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
        const range = getDateRange(req.query.period || 'month');
        const from = (req.query.from && isValidDate(req.query.from)) ? req.query.from : range.from;
        const to = (req.query.to && isValidDate(req.query.to)) ? req.query.to : range.to;

        const cacheKey = `load:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        // By day of week (ISODOW: 1=Monday ... 7=Sunday)
        const byDowResult = await pool.query(`
            SELECT
                EXTRACT(ISODOW FROM date::date)::int AS day_num,
                COUNT(*)::int AS count,
                COALESCE(SUM(price), 0)::int AS revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL AND status = 'confirmed'
            GROUP BY day_num
            ORDER BY day_num
        `, [from, to]);

        // By hour of day
        const byHourResult = await pool.query(`
            SELECT
                CAST(SUBSTRING(time FROM 1 FOR 2) AS INTEGER) AS hour,
                COUNT(*)::int AS count
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL AND status = 'confirmed'
            GROUP BY hour
            ORDER BY hour
        `, [from, to]);

        // Room utilization
        const roomResult = await pool.query(`
            SELECT room,
                COUNT(*)::int AS booking_count,
                COALESCE(SUM(duration), 0)::int AS total_minutes
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL AND status = 'confirmed'
              AND room IS NOT NULL AND room != ''
            GROUP BY room
            ORDER BY total_minutes DESC
        `, [from, to]);

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

        // Animator workload
        const animatorResult = await pool.query(`
            SELECT b.line_id,
                l.name AS animator_name,
                COUNT(*)::int AS booking_count,
                COALESCE(SUM(b.duration), 0)::int AS total_minutes
            FROM bookings b
            JOIN lines_by_date l ON b.line_id = l.line_id AND b.date = l.date
            WHERE b.date >= $1 AND b.date <= $2
              AND b.linked_to IS NULL AND b.status = 'confirmed'
            GROUP BY b.line_id, l.name
            ORDER BY booking_count DESC
        `, [from, to]);

        const data = {
            period: { from, to },
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
        const period = req.query.period || 'month';
        const range = getDateRange(period);
        const from = range.from;
        const to = range.to;
        const prev = getPreviousRange(from, to);

        const cacheKey = `trends:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        // Current period
        const currentResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS revenue,
                COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(price)), 0)::int AS average
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status != 'cancelled'
        `, [from, to]);

        // Previous period
        const prevResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS revenue,
                COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(price)), 0)::int AS average
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL
              AND status != 'cancelled'
        `, [prev.from, prev.to]);

        const c = currentResult.rows[0];
        const p = prevResult.rows[0];

        function growthPct(current, previous) {
            if (!previous || previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        }

        const data = {
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

module.exports = router;
