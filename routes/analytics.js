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
const log = createLogger('Analytics');

// RBAC: Analytics — management only (creator, director, vice_director, senior_manager)
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager'));

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
        const period = req.query.period || 'month';
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(period);
            from = range.from; to = range.to;
        }
        const prev = getPrevRange(from, to);

        const cacheKey = `overview:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

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
                    COALESCE(SUM(CASE WHEN status='confirmed' THEN price ELSE 0 END), 0)::int AS revenue,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
                    COUNT(*) FILTER (WHERE status='preliminary')::int AS preliminary,
                    COALESCE(ROUND(AVG(price)), 0)::int AS avg_check
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND linked_to IS NULL AND status != 'cancelled'
            `, [from, to]),
            // Bookings — previous
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN status='confirmed' THEN price ELSE 0 END), 0)::int AS revenue,
                    COUNT(*)::int AS total,
                    COALESCE(ROUND(AVG(price)), 0)::int AS avg_check
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND linked_to IS NULL AND status != 'cancelled'
            `, [prev.from, prev.to]),
            // Finance — current
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense,
                    COUNT(*) FILTER (WHERE type='income')::int AS income_count,
                    COUNT(*) FILTER (WHERE type='expense')::int AS expense_count
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
            `, [from, to]),
            // Finance — previous
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
            `, [prev.from, prev.to]),
            // Customers — current period new
            pool.query(`
                SELECT COUNT(*)::int AS new_customers
                FROM customers WHERE created_at::date >= $1::date AND created_at::date <= $2::date
            `, [from, to]),
            // Customers — previous period new
            pool.query(`
                SELECT COUNT(*)::int AS new_customers
                FROM customers WHERE created_at::date >= $1::date AND created_at::date <= $2::date
            `, [prev.from, prev.to]),
            // HR — current period hours
            pool.query(`
                SELECT
                    COALESCE(SUM(total_worked_minutes), 0)::int AS total_minutes,
                    COUNT(DISTINCT staff_id)::int AS active_staff
                FROM hr_time_records WHERE record_date >= $1 AND record_date <= $2
            `, [from, to])
        ]);

        const bc = bookingsCurr.rows[0], bp = bookingsPrev.rows[0];
        const fc = financeCurr.rows[0], fp = financePrev.rows[0];
        const cc = customersCurr.rows[0], cp = customersPrev.rows[0];
        const hr = hrCurr.rows[0];

        const data = {
            period: { from, to, prev: { from: prev.from, to: prev.to } },
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
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }

        const cacheKey = `charts:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const [dailyBookings, dailyFinance, topPrograms, topCategories, weekdayLoad, customerSegments] = await Promise.all([
            // Daily bookings
            pool.query(`
                SELECT date, COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND linked_to IS NULL AND status = 'confirmed'
                GROUP BY date ORDER BY date
            `, [from, to]),
            // Daily finance
            pool.query(`
                SELECT date,
                    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                GROUP BY date ORDER BY date
            `, [from, to]),
            // Top programs
            pool.query(`
                SELECT program_name, category, COUNT(*)::int AS count,
                    COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND linked_to IS NULL AND status = 'confirmed'
                GROUP BY program_name, category
                ORDER BY revenue DESC LIMIT 10
            `, [from, to]),
            // Expense categories
            pool.query(`
                SELECT fc.name, fc.icon, fc.color,
                    COALESCE(SUM(ft.amount), 0)::int AS total
                FROM finance_transactions ft
                JOIN finance_categories fc ON ft.category_id = fc.id
                WHERE ft.date::date >= $1::date AND ft.date::date <= $2::date
                GROUP BY fc.id, fc.name, fc.icon, fc.color
                ORDER BY total DESC
            `, [from, to]),
            // Day-of-week load
            pool.query(`
                SELECT EXTRACT(ISODOW FROM date::date)::int AS dow,
                    COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND linked_to IS NULL AND status = 'confirmed'
                GROUP BY dow ORDER BY dow
            `, [from, to]),
            // Customer segments (RFM summary)
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE total_bookings >= 5)::int AS champions,
                    COUNT(*) FILTER (WHERE total_bookings >= 3 AND total_bookings < 5)::int AS loyal,
                    COUNT(*) FILTER (WHERE total_bookings >= 1 AND total_bookings < 3)::int AS potential,
                    COUNT(*) FILTER (WHERE total_bookings = 0)::int AS inactive,
                    COUNT(*)::int AS total
                FROM customers
            `)
        ]);

        const DOW_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

        const data = {
            period: { from, to },
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
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const prev = getPrevRange(from, to);

        const cacheKey = `comparison:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const metrics = [
            { key: 'bookingRevenue', label: 'Виручка бронювань', sql: `SELECT COALESCE(SUM(CASE WHEN status='confirmed' THEN price ELSE 0 END), 0)::int AS val FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND linked_to IS NULL AND status != 'cancelled'` },
            { key: 'bookingCount', label: 'Кількість бронювань', sql: `SELECT COUNT(*)::int AS val FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND linked_to IS NULL AND status != 'cancelled'` },
            { key: 'finIncome', label: 'Фінанси: доходи', sql: `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS val FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date` },
            { key: 'finExpense', label: 'Фінанси: витрати', sql: `SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS val FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date` },
            { key: 'newCustomers', label: 'Нових клієнтів', sql: `SELECT COUNT(*)::int AS val FROM customers WHERE created_at::date >= $1::date AND created_at::date <= $2::date` },
            { key: 'hrHours', label: 'Робочих годин', sql: `SELECT COALESCE(ROUND(SUM(total_worked_minutes) / 60.0, 1), 0)::numeric AS val FROM hr_time_records WHERE record_date >= $1 AND record_date <= $2` }
        ];

        const results = await Promise.all(
            metrics.flatMap(m => [
                pool.query(m.sql, [from, to]),
                pool.query(m.sql, [prev.from, prev.to])
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
            GROUP BY b.created_by
            ORDER BY revenue DESC
        `, [fromDate, toDate]);

        // Leads per manager
        const leadsResult = await pool.query(`
            SELECT
                u.name AS manager,
                u.username,
                COUNT(*)::int AS total_leads,
                COUNT(*) FILTER (WHERE l.status = 'booked')::int AS converted
            FROM leads l
            JOIN users u ON l.assigned_to = u.id
            WHERE l.created_at >= $1 AND l.created_at <= ($2::date + INTERVAL '1 day')
            GROUP BY u.name, u.username
        `, [fromDate, toDate]).catch(() => ({ rows: [] }));

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

        res.json({ success: true, managers, period: { from: fromDate, to: toDate } });
    } catch (err) {
        log.error('GET /conversion error', err);
        res.status(500).json({ success: false, error: 'Помилка аналітики конверсії' });
    }
});

// ==========================================
// v33.3: GET /api/analytics/bookings — Booking analytics
// ==========================================

router.get('/bookings', async (req, res) => {
    try {
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const cacheKey = `bookings:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const [totalsR, byProgramR, byDayR, byCategoryR, byWeekdayR] = await Promise.all([
            pool.query(`
                SELECT COUNT(*)::int AS total,
                       COALESCE(SUM(price), 0)::int AS revenue,
                       ROUND(COALESCE(AVG(price), 0))::int AS avg_check,
                       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                       COUNT(*) FILTER (WHERE status = 'preliminary')::int AS preliminary
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND status != 'cancelled' AND linked_to IS NULL
            `, [from, to]),
            pool.query(`
                SELECT program_name AS name, program_code AS code, category,
                       COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND status != 'cancelled' AND linked_to IS NULL
                GROUP BY program_name, program_code, category ORDER BY revenue DESC LIMIT 15
            `, [from, to]),
            pool.query(`
                SELECT date, COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND status != 'cancelled' AND linked_to IS NULL
                GROUP BY date ORDER BY date
            `, [from, to]),
            pool.query(`
                SELECT category, COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND status != 'cancelled' AND linked_to IS NULL AND category IS NOT NULL
                GROUP BY category ORDER BY revenue DESC
            `, [from, to]),
            pool.query(`
                SELECT EXTRACT(ISODOW FROM date::date)::int AS dow, COUNT(*)::int AS count,
                       COALESCE(SUM(price), 0)::int AS revenue
                FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date
                AND status != 'cancelled' AND linked_to IS NULL
                GROUP BY EXTRACT(ISODOW FROM date::date) ORDER BY dow
            `, [from, to])
        ]);

        const DOW_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
        const data = {
            from, to,
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
        let from = req.query.from, to = req.query.to;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const range = getDateRange(req.query.period || 'month');
            from = range.from; to = range.to;
        }
        const cacheKey = `revenue:${from}:${to}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const [totalsR, byCategoryR, monthlyR] = await Promise.all([
            pool.query(`
                SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS total_income,
                       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS total_expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
            `, [from, to]),
            pool.query(`
                SELECT fc.name AS category, fc.type, fc.icon, fc.color,
                       COUNT(*)::int AS count, COALESCE(SUM(ft.amount), 0)::int AS total
                FROM finance_transactions ft
                LEFT JOIN finance_categories fc ON ft.category_id = fc.id
                WHERE ft.date::date >= $1::date AND ft.date::date <= $2::date
                GROUP BY fc.id, fc.name, fc.type, fc.icon, fc.color ORDER BY total DESC
            `, [from, to]),
            pool.query(`
                SELECT TO_CHAR(date::date, 'YYYY-MM') AS month,
                       COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)::int AS income,
                       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)::int AS expense
                FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date
                GROUP BY TO_CHAR(date::date, 'YYYY-MM') ORDER BY month
            `, [from, to])
        ]);

        const t = totalsR.rows[0];
        const data = {
            from, to,
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
