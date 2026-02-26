/**
 * routes/center.js — Center (Boss) module API
 * v18.1.0: Digital Workers status, KPI dashboard, Price Rules CRUD, daily report
 *
 * TABLES: price_rules, worker_roles, tasks, bookings, settings
 *
 * Endpoints:
 *   GET  /api/center/overview       — workers status + KPI today/week/month
 *   GET  /api/center/report         — last daily report
 *   POST /api/center/report         — save new report
 *   GET  /api/center/prices         — all price rules
 *   GET  /api/center/prices/:code   — single price rule
 *   PUT  /api/center/prices/:code   — update price (admin only)
 *   GET  /api/center/workers        — all workers with live status
 *   GET  /api/center/tasks          — aggregated tasks across all workers
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Center');

// ==========================================
// HELPERS
// ==========================================

function getKyivNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
}

function formatDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getWeekStart(d) {
    const dow = d.getDay() || 7; // 1=Mon ... 7=Sun
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow - 1));
    return mon;
}

function getMonthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Worker status based on last activity
function computeWorkerStatus(lastActivityAt) {
    if (!lastActivityAt) return { status: 'offline', label: 'Офлайн', emoji: '🔴' };
    const hoursAgo = (Date.now() - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo <= 24) return { status: 'active', label: 'Активний', emoji: '🟢' };
    if (hoursAgo <= 48) return { status: 'idle', label: 'Простоює', emoji: '🟡' };
    return { status: 'offline', label: 'Офлайн', emoji: '🔴' };
}

// ==========================================
// GET /api/center/overview — main dashboard data
// ==========================================
router.get('/overview', async (req, res) => {
    try {
        const now = getKyivNow();
        const today = formatDateISO(now);
        const weekStart = formatDateISO(getWeekStart(now));
        const monthStart = formatDateISO(getMonthStart(now));

        // Run all queries in parallel
        const [
            revenueToday, revenueWeek, revenueMonth,
            bookingsToday, bookingsWeek, bookingsMonth,
            topProgramToday, topProgramWeek, topProgramMonth,
            workersResult,
            tasksStats
        ] = await Promise.all([
            // Revenue
            pool.query(`SELECT COALESCE(SUM(price), 0) AS revenue FROM bookings WHERE date = $1 AND status != 'cancelled'`, [today]),
            pool.query(`SELECT COALESCE(SUM(price), 0) AS revenue FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled'`, [weekStart, today]),
            pool.query(`SELECT COALESCE(SUM(price), 0) AS revenue FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled'`, [monthStart, today]),
            // Bookings count
            pool.query(`SELECT COUNT(*) AS cnt FROM bookings WHERE date = $1 AND status != 'cancelled'`, [today]),
            pool.query(`SELECT COUNT(*) AS cnt FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled'`, [weekStart, today]),
            pool.query(`SELECT COUNT(*) AS cnt FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled'`, [monthStart, today]),
            // Top program
            pool.query(`SELECT program_name, COUNT(*) AS cnt FROM bookings WHERE date = $1 AND status != 'cancelled' GROUP BY program_name ORDER BY cnt DESC LIMIT 1`, [today]),
            pool.query(`SELECT program_name, COUNT(*) AS cnt FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled' GROUP BY program_name ORDER BY cnt DESC LIMIT 1`, [weekStart, today]),
            pool.query(`SELECT program_name, COUNT(*) AS cnt FROM bookings WHERE date >= $1 AND date <= $2 AND status != 'cancelled' GROUP BY program_name ORDER BY cnt DESC LIMIT 1`, [monthStart, today]),
            // Workers
            pool.query('SELECT id, name, display_name, type, purpose, is_active, updated_at FROM worker_roles ORDER BY created_at').catch(() => ({ rows: [] })),
            // Tasks stats
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'done') AS done,
                COUNT(*) FILTER (WHERE status != 'done') AS open,
                COUNT(*) AS total
                FROM tasks WHERE date >= $1`, [monthStart])
        ]);

        // Avg check
        const bookingsTodayCount = parseInt(bookingsToday.rows[0].cnt);
        const bookingsWeekCount = parseInt(bookingsWeek.rows[0].cnt);
        const bookingsMonthCount = parseInt(bookingsMonth.rows[0].cnt);
        const revTodayVal = parseInt(revenueToday.rows[0].revenue);
        const revWeekVal = parseInt(revenueWeek.rows[0].revenue);
        const revMonthVal = parseInt(revenueMonth.rows[0].revenue);

        const kpi = {
            today: {
                revenue: revTodayVal,
                bookings: bookingsTodayCount,
                avgCheck: bookingsTodayCount > 0 ? Math.round(revTodayVal / bookingsTodayCount) : 0,
                topProgram: topProgramToday.rows[0]?.program_name || '—'
            },
            week: {
                revenue: revWeekVal,
                bookings: bookingsWeekCount,
                avgCheck: bookingsWeekCount > 0 ? Math.round(revWeekVal / bookingsWeekCount) : 0,
                topProgram: topProgramWeek.rows[0]?.program_name || '—'
            },
            month: {
                revenue: revMonthVal,
                bookings: bookingsMonthCount,
                avgCheck: bookingsMonthCount > 0 ? Math.round(revMonthVal / bookingsMonthCount) : 0,
                topProgram: topProgramMonth.rows[0]?.program_name || '—'
            }
        };

        // Workers with live status
        const workers = workersResult.rows.map(w => {
            const statusInfo = computeWorkerStatus(w.updated_at);
            return {
                id: w.id,
                name: w.name,
                displayName: w.display_name,
                type: w.type,
                purpose: w.purpose,
                isActive: w.is_active,
                ...statusInfo,
                lastActivity: w.updated_at
            };
        });

        const tasksOverview = {
            done: parseInt(tasksStats.rows[0]?.done || 0),
            open: parseInt(tasksStats.rows[0]?.open || 0),
            total: parseInt(tasksStats.rows[0]?.total || 0)
        };

        res.json({
            success: true,
            kpi,
            workers,
            tasks: tasksOverview
        });
    } catch (err) {
        log.error('GET /center/overview error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження даних' });
    }
});

// ==========================================
// GET /api/center/workers — workers with live status
// ==========================================
router.get('/workers', async (req, res) => {
    try {
        const workersResult = await pool.query(
            'SELECT * FROM worker_roles ORDER BY created_at'
        ).catch(() => ({ rows: [] }));

        // Check multiple activity sources for each worker
        const [lastTasks, lastBookings, lastHistory] = await Promise.all([
            pool.query(`
                SELECT assigned_to AS name, MAX(updated_at) AS last_activity
                FROM tasks WHERE assigned_to IS NOT NULL
                GROUP BY assigned_to
            `).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT created_by AS name, MAX(created_at) AS last_activity
                FROM bookings WHERE created_by IS NOT NULL
                GROUP BY created_by
            `).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT changed_by AS name, MAX(changed_at) AS last_activity
                FROM history WHERE changed_by IS NOT NULL
                GROUP BY changed_by
            `).catch(() => ({ rows: [] }))
        ]);

        // Build combined activity map (latest from any source)
        const activityMap = {};
        for (const source of [lastTasks.rows, lastBookings.rows, lastHistory.rows]) {
            for (const row of source) {
                const key = row.name?.toLowerCase();
                if (!key) continue;
                const ts = new Date(row.last_activity).getTime();
                if (!activityMap[key] || ts > activityMap[key]) {
                    activityMap[key] = ts;
                }
            }
        }

        const workers = workersResult.rows.map(w => {
            const nameKey = w.name?.toLowerCase();
            const displayKey = w.display_name?.toLowerCase();
            const latestTs = Math.max(
                activityMap[nameKey] || 0,
                activityMap[displayKey] || 0,
                new Date(w.updated_at).getTime() || 0
            );
            const lastActivity = latestTs > 0 ? new Date(latestTs) : w.updated_at;
            const statusInfo = computeWorkerStatus(lastActivity);

            return {
                id: w.id,
                name: w.name,
                displayName: w.display_name,
                type: w.type,
                purpose: w.purpose,
                isActive: w.is_active,
                inputs: w.inputs,
                actions: w.actions,
                limits: w.limits,
                monitoring: w.monitoring,
                ...statusInfo,
                lastActivity
            };
        });

        res.json({ success: true, workers });
    } catch (err) {
        log.error('GET /center/workers error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження воркерів' });
    }
});

// ==========================================
// PRICE RULES CRUD
// ==========================================

// GET /api/center/prices — all price rules
router.get('/prices', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM price_rules ORDER BY category, code');
        res.json({ success: true, prices: result.rows });
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json({ success: true, prices: [] });
        log.error('GET /center/prices error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження цін' });
    }
});

// GET /api/center/prices/:code — single price rule
router.get('/prices/:code', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM price_rules WHERE code = $1', [req.params.code]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Ціну не знайдено' });
        res.json({ success: true, price: result.rows[0] });
    } catch (err) {
        log.error('GET /center/prices/:code error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/center/prices/:code — update price (admin only)
router.put('/prices/:code', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Тільки для адміністраторів' });
    try {
        const { value, name, unit, category, description } = req.body;
        if (value === undefined && !name) {
            return res.status(400).json({ success: false, error: 'Вкажіть value або name' });
        }
        const result = await pool.query(
            `UPDATE price_rules SET
                value = COALESCE($1, value),
                name = COALESCE($2, name),
                unit = COALESCE($3, unit),
                category = COALESCE($4, category),
                description = COALESCE($5, description),
                updated_at = NOW(),
                updated_by = $6
             WHERE code = $7 RETURNING *`,
            [value !== undefined ? value : null, name || null, unit || null, category || null, description || null, req.user.username, req.params.code]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Ціну не знайдено' });
        log.info(`Price ${req.params.code} updated to ${value} by ${req.user.username}`);
        res.json({ success: true, price: result.rows[0] });
    } catch (err) {
        log.error('PUT /center/prices/:code error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення ціни' });
    }
});

// POST /api/center/prices — create new price rule (admin only)
router.post('/prices', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Тільки для адміністраторів' });
    try {
        const { code, name, value, unit, category, description } = req.body;
        if (!code || !name || value === undefined) {
            return res.status(400).json({ success: false, error: "Обов'язкові поля: code, name, value" });
        }
        const result = await pool.query(
            `INSERT INTO price_rules (code, name, value, unit, category, description, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [code, name, value, unit || null, category || null, description || null, req.user.username]
        );
        log.info(`Price ${code} created by ${req.user.username}`);
        res.json({ success: true, price: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, error: 'Код ціни вже існує' });
        log.error('POST /center/prices error', err);
        res.status(500).json({ success: false, error: 'Помилка створення ціни' });
    }
});

// DELETE /api/center/prices/:code — delete price rule (admin only)
router.delete('/prices/:code', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Тільки для адміністраторів' });
    try {
        const result = await pool.query('DELETE FROM price_rules WHERE code = $1 RETURNING code', [req.params.code]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Ціну не знайдено' });
        log.info(`Price ${req.params.code} deleted by ${req.user.username}`);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /center/prices/:code error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення ціни' });
    }
});

// ==========================================
// DAILY REPORT
// ==========================================

// GET /api/center/report — last daily report
router.get('/report', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT value FROM settings WHERE key = 'center_daily_report'"
        );
        if (result.rows.length === 0) {
            return res.json({ success: true, report: null });
        }
        const data = JSON.parse(result.rows[0].value);
        res.json({ success: true, report: data });
    } catch (err) {
        log.error('GET /center/report error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження звіту' });
    }
});

// POST /api/center/report — save new report
router.post('/report', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ success: false, error: 'Текст звіту обов\'язковий' });

        const data = JSON.stringify({
            text,
            date: new Date().toISOString(),
            author: req.user.username
        });

        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('center_daily_report', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [data]
        );
        log.info(`Daily report saved by ${req.user.username}`);
        res.json({ success: true });
    } catch (err) {
        log.error('POST /center/report error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження звіту' });
    }
});

// ==========================================
// AGGREGATED TASKS
// ==========================================

// GET /api/center/tasks — all open tasks with optional filter
router.get('/tasks', async (req, res) => {
    try {
        const { assignee, status } = req.query;
        const conditions = [];
        const params = [];

        if (assignee) {
            params.push(assignee);
            conditions.push(`assigned_to = $${params.length}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const result = await pool.query(
            `SELECT id, title, description, status, priority, category, assigned_to, date, deadline, created_at, updated_at
             FROM tasks ${where}
             ORDER BY
                CASE WHEN status = 'in_progress' THEN 0 WHEN status = 'todo' THEN 1 ELSE 2 END,
                CASE WHEN priority = 'high' THEN 0 WHEN priority = 'normal' THEN 1 ELSE 2 END,
                created_at DESC
             LIMIT 100`,
            params
        );
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        log.error('GET /center/tasks error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження задач' });
    }
});

module.exports = router;
