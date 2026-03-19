/**
 * routes/dashboard.js — Dashboard API (v24.3.0)
 * User dashboard config, widget data, /today aggregate, weather/currency cache
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getDefaultWidgets } = require('../config/roles');
const { createLogger } = require('../utils/logger');
const { getKyivDateStr } = require('../services/booking');

const log = createLogger('Dashboard');

// All routes require authentication
router.use(authenticateToken);

// GET /api/dashboard/config — user's dashboard configuration
router.get('/config', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT layout, widgets, theme FROM dashboard_configs WHERE user_id = $1',
            [req.user.id]
        );

        if (result.rows.length > 0) {
            return res.json({ success: true, config: result.rows[0] });
        }

        // Return defaults based on role
        const defaultWidgets = getDefaultWidgets(req.user.role);
        res.json({
            success: true,
            config: {
                layout: {},
                widgets: defaultWidgets,
                theme: 'default'
            },
            isDefault: true
        });
    } catch (err) {
        log.error('Failed to get dashboard config', err);
        res.status(500).json({ error: 'Failed to load dashboard config' });
    }
});

// PUT /api/dashboard/config — save user's dashboard configuration
router.put('/config', async (req, res) => {
    try {
        const { layout, widgets, theme } = req.body;
        await pool.query(`
            INSERT INTO dashboard_configs (user_id, layout, widgets, theme, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET layout = $2, widgets = $3, theme = $4, updated_at = NOW()
        `, [req.user.id, JSON.stringify(layout || {}), JSON.stringify(widgets || []), theme || 'default']);

        res.json({ success: true });
    } catch (err) {
        log.error('Failed to save dashboard config', err);
        res.status(500).json({ error: 'Failed to save dashboard config' });
    }
});

// GET /api/dashboard/widgets/:type — widget-specific data
router.get('/widgets/:type', async (req, res) => {
    try {
        const { type } = req.params;
        let data = {};

        switch (type) {
            case 'tasks': {
                const result = await pool.query(`
                    SELECT id, title, status, priority, deadline, category
                    FROM tasks
                    WHERE (assigned_to = $1 OR created_by = $1)
                    AND status != 'done' AND status != 'cancelled'
                    ORDER BY
                        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        deadline ASC NULLS LAST
                    LIMIT 10
                `, [req.user.name]);
                data = { tasks: result.rows };
                break;
            }

            case 'bookings_today': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT b.id, b.label as client_name, b.program_name as program,
                           b.time as start_time, b.room, b.status, b.kids_count as children_count
                    FROM bookings b
                    WHERE b.date = $1 AND b.status != 'cancelled'
                    ORDER BY b.time ASC
                `, [today]);
                data = { bookings: result.rows, date: today };
                break;
            }

            case 'my_schedule': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT ss.date, ss.status, ss.shift_start as start_time, ss.shift_end as end_time, ss.note
                    FROM staff_schedule ss
                    JOIN employee_profiles ep ON ep.staff_id = ss.staff_id
                    WHERE ep.user_id = $1 AND ss.date >= $2
                    ORDER BY ss.date ASC
                    LIMIT 7
                `, [req.user.id, today]);
                data = { shifts: result.rows };
                break;
            }

            case 'team_online': {
                const result = await pool.query(`
                    SELECT u.id, u.name, u.role, ep.last_activity_at
                    FROM users u
                    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
                    WHERE u.is_active = true
                    AND ep.last_activity_at > NOW() - INTERVAL '5 minutes'
                    ORDER BY ep.last_activity_at DESC
                `, []);
                data = { online: result.rows };
                break;
            }

            case 'quick_stats': {
                const today = getKyivDateStr();
                const [bookings, tasks, revenue] = await Promise.all([
                    pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [today]),
                    pool.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'"),
                    pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [today]),
                ]);
                data = {
                    bookingsToday: parseInt(bookings.rows[0].count),
                    activeTasks: parseInt(tasks.rows[0].count),
                    revenueToday: parseFloat(revenue.rows[0].total),
                };
                break;
            }

            case 'alerts': {
                // System alerts: overdue tasks, unconfirmed bookings, low stock
                const alertToday = getKyivDateStr();
                const [overdue, unconfirmed] = await Promise.all([
                    pool.query(`
                        SELECT COUNT(*) as count FROM tasks
                        WHERE deadline < NOW() AND status NOT IN ('done', 'cancelled')
                    `),
                    pool.query(`
                        SELECT COUNT(*) as count FROM bookings
                        WHERE date = $1 AND status = 'preliminary'
                    `, [alertToday]),
                ]);
                const alerts = [];
                const overdueCount = parseInt(overdue.rows[0].count);
                const unconfirmedCount = parseInt(unconfirmed.rows[0].count);
                if (overdueCount > 0) alerts.push({ type: 'warning', title: `${overdueCount} протерм. задач`, icon: '⚠️' });
                if (unconfirmedCount > 0) alerts.push({ type: 'info', title: `${unconfirmedCount} непідтв. бронювань`, icon: '📋' });
                data = { alerts };
                break;
            }

            case 'leads_new': {
                const result = await pool.query(`
                    SELECT id, name, phone, source, status, created_at
                    FROM leads
                    WHERE status = 'new'
                    ORDER BY created_at DESC
                    LIMIT 8
                `);
                data = { leads: result.rows, total: result.rows.length };
                break;
            }

            case 'finance_today': {
                const finToday = getKyivDateStr();
                const [revenue, expenses, bookingCount] = await Promise.all([
                    pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [finToday]),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions WHERE date = $1 AND type = 'expense'", [finToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [finToday]),
                ]);
                data = {
                    revenue: parseFloat(revenue.rows[0].total),
                    expenses: parseFloat(expenses.rows[0].total),
                    bookings: parseInt(bookingCount.rows[0].count),
                    profit: parseFloat(revenue.rows[0].total) - parseFloat(expenses.rows[0].total),
                };
                break;
            }

            case 'announcements': {
                const result = await pool.query(`
                    SELECT id, title, text_content as content, priority, created_at, created_by as author_name
                    FROM announcements
                    WHERE status = 'active'
                    ORDER BY priority DESC, created_at DESC
                    LIMIT 5
                `);
                data = { announcements: result.rows };
                break;
            }

            case 'weather': {
                data = await getCachedData('weather', 1800, fetchWeather);
                break;
            }

            case 'currency': {
                data = await getCachedData('currency', 3600, fetchCurrency);
                break;
            }

            case 'reports_today': {
                const repToday = getKyivDateStr();
                const [repIncome, repExpense, repNew] = await Promise.all([
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'income'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'expense'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COUNT(*) as count FROM reports WHERE created_at::date = $1 AND status = 'new'", [repToday]).catch(() => ({ rows: [{ count: 0 }] })),
                ]);
                data = {
                    income: parseFloat(repIncome.rows[0].total),
                    expense: parseFloat(repExpense.rows[0].total),
                    newCount: parseInt(repNew.rows[0].count)
                };
                break;
            }

            default:
                return res.status(400).json({ error: 'Unknown widget type' });
        }

        res.json({ success: true, data });
    } catch (err) {
        log.error(`Widget data error (${req.params.type})`, err);
        res.status(500).json({ error: 'Failed to load widget data' });
    }
});

// GET /api/dashboard/roles — role definitions for test panel
router.get('/roles', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT role_key, name_uk, department, level FROM role_definitions WHERE is_active = true ORDER BY level DESC'
        );
        res.json({ success: true, roles: result.rows });
    } catch (err) {
        log.error('Failed to get roles', err);
        res.status(500).json({ error: 'Failed to load roles' });
    }
});

// GET /api/dashboard/today — aggregate "today" data for quick overview
router.get('/today', async (req, res) => {
    try {
        const today = getKyivDateStr();

        const [bookings, tasks, revenue, teamOnline, newLeads] = await Promise.all([
            pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [today]),
            pool.query("SELECT COUNT(*) as count FROM tasks WHERE (assigned_to = $1 OR created_by = $1) AND status NOT IN ('done', 'cancelled')", [req.user.name]),
            pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [today]),
            pool.query("SELECT COUNT(*) as count FROM users u LEFT JOIN employee_profiles ep ON ep.user_id = u.id WHERE u.is_active = true AND ep.last_activity_at > NOW() - INTERVAL '5 minutes'"),
            pool.query("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").catch(() => ({ rows: [{ count: 0 }] })),
        ]);

        res.json({
            success: true,
            data: {
                date: today,
                bookingsToday: parseInt(bookings.rows[0].count),
                myActiveTasks: parseInt(tasks.rows[0].count),
                revenueToday: parseFloat(revenue.rows[0].total),
                teamOnline: parseInt(teamOnline.rows[0].count),
                newLeads: parseInt(newLeads.rows[0].count),
            }
        });
    } catch (err) {
        log.error('Dashboard /today error', err);
        res.status(500).json({ error: 'Failed to load today data' });
    }
});

// --- Cache helpers ---
async function getCachedData(key, ttlSeconds, fetchFn) {
    try {
        const cached = await pool.query(
            'SELECT data FROM dashboard_cache WHERE cache_key = $1 AND expires_at > NOW()',
            [key]
        );
        if (cached.rows.length > 0) {
            return cached.rows[0].data;
        }

        const freshData = await fetchFn();
        await pool.query(`
            INSERT INTO dashboard_cache (cache_key, data, expires_at)
            VALUES ($1, $2, NOW() + make_interval(secs => $3))
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, expires_at = NOW() + make_interval(secs => $3)
        `, [key, JSON.stringify(freshData), ttlSeconds]);

        return freshData;
    } catch (err) {
        log.error(`Cache error for ${key}`, err);
        return {};
    }
}

async function fetchWeather() {
    try {
        // Kyiv weather via Open-Meteo (free, no API key)
        const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m,weathercode,windspeed_10m&timezone=Europe/Kyiv');
        if (!resp.ok) return { error: 'Weather API unavailable' };
        const data = await resp.json();
        return {
            temperature: data.current.temperature_2m,
            weatherCode: data.current.weathercode,
            windSpeed: data.current.windspeed_10m,
            city: 'Київ'
        };
    } catch {
        return { error: 'Weather fetch failed' };
    }
}

async function fetchCurrency() {
    try {
        // NBU currency rates
        const resp = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
        if (!resp.ok) return { error: 'Currency API unavailable' };
        const data = await resp.json();
        const usd = data.find(c => c.cc === 'USD');
        const eur = data.find(c => c.cc === 'EUR');
        return {
            usd: usd ? usd.rate : null,
            eur: eur ? eur.rate : null,
            date: usd ? usd.exchangedate : null
        };
    } catch {
        return { error: 'Currency fetch failed' };
    }
}

module.exports = router;
