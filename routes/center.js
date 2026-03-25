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
const { requireMinRole } = require('../middleware/auth');

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
            pool.query('SELECT id, name, display_name, type, purpose, is_active, updated_at FROM worker_roles ORDER BY created_at').catch(err => { log.warn('Worker roles fetch failed', err.message); return { rows: [] }; }),
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
            'SELECT * FROM worker_roles ORDER BY created_at LIMIT 500'
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

// PUT /api/center/prices/:code — update price (senior_manager+)
// v20.9.25: syncs price to products table if product_id is linked
router.put('/prices/:code', requireMinRole('senior_manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { value, name, unit, category, description, effectiveFrom, productId } = req.body;
        if (value === undefined && !name) {
            return res.status(400).json({ success: false, error: 'Вкажіть value або name' });
        }

        // v20.9.25: Block past effective dates
        if (effectiveFrom) {
            const effectiveDate = new Date(effectiveFrom);
            const now = new Date();
            // Allow a 5-minute grace period for slight clock differences
            now.setMinutes(now.getMinutes() - 5);
            if (effectiveDate < now) {
                return res.status(400).json({ success: false, error: 'Дата введення в дію не може бути в минулому' });
            }
        }

        await client.query('BEGIN');

        // v33.3: Fetch old price for history tracking
        const oldPriceResult = await client.query('SELECT value, name FROM price_rules WHERE code = $1', [req.params.code]);
        const oldPrice = oldPriceResult.rows[0] || null;

        // Update product_id if provided (one-time link)
        if (productId !== undefined) {
            await client.query('UPDATE price_rules SET product_id = $1 WHERE code = $2', [productId || null, req.params.code]);
        }

        const result = await client.query(
            `UPDATE price_rules SET
                value = COALESCE($1, value),
                name = COALESCE($2, name),
                unit = COALESCE($3, unit),
                category = COALESCE($4, category),
                description = COALESCE($5, description),
                effective_from = $6,
                updated_at = NOW(),
                updated_by = $7
             WHERE code = $8 RETURNING *`,
            [value !== undefined ? value : null, name || null, unit || null, category || null, description || null, effectiveFrom || null, req.user.username, req.params.code]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Ціну не знайдено' });
        }

        const priceRule = result.rows[0];

        // v33.3: Price history tracking
        if (oldPrice && value !== undefined && oldPrice.value !== null && parseFloat(oldPrice.value) !== parseFloat(value)) {
            await client.query(
                `INSERT INTO price_history (price_code, name, old_value, new_value, changed_by, reason)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [req.params.code, oldPrice.name, oldPrice.value, value, req.user.username, req.body.reason || null]
            );
        }

        let productSynced = false;

        // v20.9.25: Sync price to products table if linked and effective now
        if (value !== undefined && priceRule.product_id) {
            const isEffectiveNow = !effectiveFrom || new Date(effectiveFrom) <= new Date();
            if (isEffectiveNow) {
                const syncResult = await client.query(
                    'UPDATE products SET price = $1, updated_by = $2 WHERE id = $3 RETURNING id',
                    [value, req.user.username, priceRule.product_id]
                );
                productSynced = syncResult.rowCount > 0;
            }
        }

        await client.query('COMMIT');
        log.info(`Price ${req.params.code} updated to ${value} by ${req.user.username}${productSynced ? ' (synced to product)' : ''}`);
        res.json({ success: true, price: priceRule, productSynced });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('PUT /center/prices/:code error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення ціни' });
    } finally {
        client.release();
    }
});

// v33.3: GET /api/center/prices/:code/history — price change history
router.get('/prices/:code/history', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM price_history WHERE price_code = $1 ORDER BY changed_at DESC LIMIT 50',
            [req.params.code]
        );
        res.json({ success: true, history: result.rows });
    } catch (err) {
        log.error('GET /prices/:code/history error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/center/prices — create new price rule (senior_manager+)
router.post('/prices', requireMinRole('senior_manager'), async (req, res) => {
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

// DELETE /api/center/prices/:code — delete price rule (senior_manager+)
router.delete('/prices/:code', requireMinRole('senior_manager'), async (req, res) => {
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

// ==========================================
// CLIENT SEARCH + PROFILE (v19.9)
// ==========================================

router.get('/clients', async (req, res) => {
    try {
        const { search } = req.query;
        const lim = Math.min(parseInt(req.query.limit) || 20, 50);

        let query, params;
        if (search && search.trim()) {
            query = `SELECT c.id, c.name, c.phone, c.instagram, c.child_name,
                c.total_bookings, c.total_spent, c.first_visit, c.last_visit,
                c.loyalty_tier_id
                FROM customers c
                WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.child_name ILIKE $1 OR c.instagram ILIKE $1
                ORDER BY c.last_visit DESC NULLS LAST
                LIMIT $2`;
            params = [`%${search.trim()}%`, lim];
        } else {
            query = `SELECT c.id, c.name, c.phone, c.instagram, c.child_name,
                c.total_bookings, c.total_spent, c.first_visit, c.last_visit,
                c.loyalty_tier_id
                FROM customers c
                ORDER BY c.last_visit DESC NULLS LAST
                LIMIT $1`;
            params = [lim];
        }
        const result = await pool.query(query, params);
        res.json({ success: true, clients: result.rows });
    } catch (err) {
        log.error('GET /center/clients error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження клієнтів' });
    }
});

router.get('/clients/:id/bookings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, date, time, program_name, category, duration, price, status, room, kids_count
            FROM bookings
            WHERE customer_id = $1 AND status != 'cancelled'
            ORDER BY date DESC, time DESC
            LIMIT 50
        `, [req.params.id]);
        res.json({ success: true, bookings: result.rows });
    } catch (err) {
        log.error('GET /center/clients/:id/bookings error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ==========================================
// REVENUE GOALS (v19.9)
// ==========================================

router.get('/goals', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'center_revenue_goals'");
        if (result.rows.length === 0) return res.json({ success: true, goals: null });
        res.json({ success: true, goals: JSON.parse(result.rows[0].value) });
    } catch (err) {
        log.error('GET /center/goals error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

router.post('/goals', requireMinRole('senior_manager'), async (req, res) => {
    try {
        const { weeklyRevenue, weeklyBookings, monthlyRevenue, monthlyBookings } = req.body;
        const data = JSON.stringify({ weeklyRevenue, weeklyBookings, monthlyRevenue, monthlyBookings, updatedBy: req.user.username, updatedAt: new Date().toISOString() });
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('center_revenue_goals', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1`,
            [data]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('POST /center/goals error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження' });
    }
});

// ==========================================
// WEEKLY BRIEFING (v19.9)
// ==========================================

router.get('/briefing', async (req, res) => {
    try {
        const now = getKyivNow();
        const weekStart = getWeekStart(now);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const from = formatDateISO(weekStart);
        const to = formatDateISO(weekEnd);

        const [bookingsRes, tasksRes, expiringDiscounts, staffRes] = await Promise.all([
            pool.query(`
                SELECT date, time, program_name, category, price, status, room, kids_count, customer_id
                FROM bookings
                WHERE date >= $1 AND date <= $2 AND status != 'cancelled' AND linked_to IS NULL
                ORDER BY date, time
            `, [from, to]),
            pool.query(`
                SELECT id, title, status, priority, assigned_to, date, deadline
                FROM tasks
                WHERE (date >= $1 AND date <= $2) OR (deadline >= $1::date AND deadline <= $2::date) OR (status IN ('todo', 'in_progress'))
                ORDER BY priority DESC, date
            `, [from, to]),
            pool.query(`
                SELECT code, name, valid_until
                FROM discount_codes
                WHERE is_active = true AND valid_until IS NOT NULL AND valid_until >= $1 AND valid_until <= $2
                ORDER BY valid_until
            `, [from, to]).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT ss.date, s.name, ss.shift_start, ss.shift_end, ss.status
                FROM staff_schedule ss
                JOIN staff s ON ss.staff_id = s.id
                WHERE ss.date >= $1 AND ss.date <= $2 AND s.department = 'animators'
                ORDER BY ss.date, ss.shift_start
            `, [from, to]).catch(() => ({ rows: [] }))
        ]);

        const bookings = bookingsRes.rows;
        const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
        const totalBookings = bookings.length;
        const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;
        const preliminaryCount = bookings.filter(b => b.status === 'preliminary').length;

        // Group bookings by day
        const byDay = {};
        for (const b of bookings) {
            const d = typeof b.date === 'string' ? b.date : (b.date ? b.date.toISOString().split('T')[0] : '');
            if (!byDay[d]) byDay[d] = [];
            byDay[d].push(b);
        }

        const tasks = tasksRes.rows;
        const openTasks = tasks.filter(t => t.status !== 'done').length;
        const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'done');

        res.json({
            success: true,
            briefing: {
                period: { from, to },
                bookings: { total: totalBookings, confirmed: confirmedCount, preliminary: preliminaryCount, revenue: totalRevenue, byDay },
                tasks: { total: tasks.length, open: openTasks, highPriority: highPriorityTasks },
                expiringDiscounts: expiringDiscounts.rows,
                staff: staffRes.rows
            }
        });
    } catch (err) {
        log.error('GET /center/briefing error', err);
        res.status(500).json({ success: false, error: 'Помилка компіляції брифінгу' });
    }
});

// ==========================================
// FINANCIAL RECONCILIATION (v19.9)
// ==========================================

router.get('/reconciliation', async (req, res) => {
    try {
        const now = getKyivNow();
        const monthStart = formatDateISO(getMonthStart(now));
        const today = formatDateISO(now);
        const from = req.query.from || monthStart;
        const to = req.query.to || today;

        const [bookingsRes, paymentsRes] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_bookings,
                    COALESCE(SUM(price), 0)::int AS total_price,
                    COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                    COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS confirmed_revenue,
                    COUNT(*) FILTER (WHERE status = 'preliminary')::int AS preliminary,
                    COALESCE(SUM(CASE WHEN status = 'preliminary' THEN price ELSE 0 END), 0)::int AS preliminary_revenue
                FROM bookings
                WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != 'cancelled'
            `, [from, to]),
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS total_income,
                    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS total_expense,
                    COUNT(*) FILTER (WHERE type = 'income')::int AS income_count,
                    COUNT(*) FILTER (WHERE type = 'expense')::int AS expense_count
                FROM finance_transactions
                WHERE date >= $1 AND date <= $2
            `, [from, to]).catch(() => ({ rows: [{ total_income: 0, total_expense: 0, income_count: 0, expense_count: 0 }] }))
        ]);

        const b = bookingsRes.rows[0];
        const p = paymentsRes.rows[0];
        const gap = b.confirmed_revenue - p.total_income;

        res.json({
            success: true,
            reconciliation: {
                period: { from, to },
                bookings: b,
                payments: p,
                gap,
                gapPercent: b.confirmed_revenue > 0 ? Math.round(gap / b.confirmed_revenue * 100) : 0
            }
        });
    } catch (err) {
        log.error('GET /center/reconciliation error', err);
        res.status(500).json({ success: false, error: 'Помилка звірки' });
    }
});

// ==========================================
// SEASONAL HEATMAP (v19.9)
// ==========================================

router.get('/heatmap', async (req, res) => {
    try {
        const months = Math.min(parseInt(req.query.months) || 6, 12);
        const now = getKyivNow();
        const fromDate = new Date(now);
        fromDate.setMonth(fromDate.getMonth() - months);
        const from = formatDateISO(fromDate);
        const to = formatDateISO(now);

        const result = await pool.query(`
            SELECT date,
                COUNT(*)::int AS count,
                COALESCE(SUM(price), 0)::int AS revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2 AND status != 'cancelled' AND linked_to IS NULL
            GROUP BY date
            ORDER BY date
        `, [from, to]);

        res.json({ success: true, heatmap: result.rows, period: { from, to } });
    } catch (err) {
        log.error('GET /center/heatmap error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ==========================================
// PROGRAM PERFORMANCE MATRIX (v19.9)
// ==========================================

router.get('/program-performance', async (req, res) => {
    try {
        const now = getKyivNow();
        const monthStart = formatDateISO(getMonthStart(now));
        const today = formatDateISO(now);
        const from = req.query.from || monthStart;
        const to = req.query.to || today;

        const result = await pool.query(`
            SELECT
                program_id, program_name, category,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE status = 'preliminary')::int AS preliminary,
                COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS revenue,
                COALESCE(ROUND(AVG(CASE WHEN status = 'confirmed' THEN price END)), 0)::int AS avg_price,
                COALESCE(ROUND(AVG(kids_count)), 0)::int AS avg_kids
            FROM bookings
            WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != 'cancelled'
            GROUP BY program_id, program_name, category
            ORDER BY revenue DESC
        `, [from, to]);

        res.json({ success: true, programs: result.rows, period: { from, to } });
    } catch (err) {
        log.error('GET /center/program-performance error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ==========================================
// CROSS-SELL INSIGHTS (v19.9)
// ==========================================

router.get('/cross-sell', async (req, res) => {
    try {
        const now = getKyivNow();
        const monthStart = formatDateISO(new Date(now.getFullYear(), now.getMonth() - 3, 1));
        const today = formatDateISO(now);

        // Find programs frequently booked together on the same date by the same customer
        const result = await pool.query(`
            SELECT
                b1.program_name AS program_a,
                b2.program_name AS program_b,
                COUNT(*)::int AS combo_count
            FROM bookings b1
            JOIN bookings b2 ON b1.date = b2.date
                AND b1.customer_id = b2.customer_id
                AND b1.id < b2.id
                AND b1.linked_to IS NULL AND b2.linked_to IS NULL
            WHERE b1.date >= $1 AND b1.date <= $2
                AND b1.status != 'cancelled' AND b2.status != 'cancelled'
            GROUP BY b1.program_name, b2.program_name
            HAVING COUNT(*) >= 2
            ORDER BY combo_count DESC
            LIMIT 15
        `, [monthStart, today]);

        // Top add-ons (linked bookings)
        const addons = await pool.query(`
            SELECT program_name, COUNT(*)::int AS count, COALESCE(SUM(price), 0)::int AS revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2 AND linked_to IS NOT NULL AND status != 'cancelled'
            GROUP BY program_name
            ORDER BY count DESC
            LIMIT 10
        `, [monthStart, today]);

        res.json({
            success: true,
            combos: result.rows,
            addons: addons.rows
        });
    } catch (err) {
        log.error('GET /center/cross-sell error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ==========================================
// EVENT TIMELINE (v19.9)
// ==========================================

router.get('/event-log', async (req, res) => {
    try {
        const lim = Math.min(parseInt(req.query.limit) || 50, 200);
        const result = await pool.query(`
            SELECT id, action, username, data, created_at
            FROM history
            ORDER BY created_at DESC
            LIMIT $1
        `, [lim]);

        const events = result.rows.map(r => ({
            id: r.id,
            action: r.action,
            user: r.username,
            data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
            timestamp: r.created_at
        }));

        res.json({ success: true, events });
    } catch (err) {
        log.error('GET /center/event-log error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

module.exports = router;
