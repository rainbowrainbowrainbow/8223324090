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
const { requireMinRole, authenticateToken } = require('../middleware/auth');
const { getVisibleBookingScope } = require('../services/bookingVisibility');

const log = createLogger('Center');

// v39.8: Security — require authentication for all center endpoints
router.use(authenticateToken);
router.use(requireMinRole('manager'));

// ==========================================
// HELPERS
// ==========================================

function getKyivNow() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
    const get = type => p.find(x => x.type === type)?.value;
    return new Date(parseInt(get('year')), parseInt(get('month')) - 1, parseInt(get('day')), parseInt(get('hour')), parseInt(get('minute')), parseInt(get('second')));
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

function scopedBookingParams(user, params = [], alias = 'b') {
    const queryParams = [...params];
    const visibility = getVisibleBookingScope(user, queryParams, alias);
    return { params: queryParams, sql: visibility.sql, condition: visibility.condition };
}

function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function timeFromTimestamp(value) {
    if (!value) return null;
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Kyiv',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(new Date(value));
    } catch {
        return null;
    }
}

function normalizeDateText(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    try {
        return value.toISOString().slice(0, 10);
    } catch {
        return String(value).slice(0, 10);
    }
}

function parseOperationsNotes(rows = []) {
    const raw = rows.find(row => row?.value)?.value;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.notes) ? parsed.notes : []);
        return items
            .map(item => typeof item === 'string' ? { text: item } : item)
            .filter(item => String(item?.text || item?.note || '').trim())
            .slice(0, 8);
    } catch {
        return String(raw)
            .split(/\r?\n/)
            .map(text => text.trim())
            .filter(Boolean)
            .slice(0, 8)
            .map(text => ({ text }));
    }
}

function shiftAttendanceStatus(row, nowMinutes) {
    const plannedStart = timeToMinutes(row.shift_start);
    const plannedEnd = timeToMinutes(row.shift_end);
    const clockIn = row.clock_in || row.check_in;
    const clockOut = row.clock_out || row.check_out;
    const dbStatus = String(row.time_status || '').trim().toLowerCase();
    const lateMinutes = Number(row.late_minutes || 0);

    if (clockIn && clockOut) return { status: 'completed', label: 'завершено', severity: 'ok' };
    if (clockIn) {
        if (dbStatus === 'late' || lateMinutes > 0) return { status: 'late', label: 'запізнення', severity: 'warning' };
        return { status: 'checked_in', label: 'на зміні', severity: 'ok' };
    }
    if (['excused', 'sick', 'vacation', 'day_off', 'dayoff'].includes(dbStatus)) {
        return { status: 'excused', label: 'поважна причина', severity: 'info' };
    }
    if (plannedStart !== null && nowMinutes !== null) {
        if (nowMinutes > plannedStart + 60) return { status: 'absent', label: 'не вийшов', severity: 'critical' };
        if (nowMinutes > plannedStart + 10) return { status: 'late', label: 'запізнюється', severity: 'warning' };
    }
    if (plannedStart !== null && plannedEnd !== null && nowMinutes !== null && nowMinutes >= plannedStart && nowMinutes <= plannedEnd) {
        return { status: 'planned', label: 'планова зміна зараз', severity: 'info' };
    }
    return { status: 'planned', label: 'заплановано', severity: 'info' };
}

function operationsIssue(type, severity, title, detail = '', ref = {}) {
    return { type, severity, title, detail, ref };
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

        async function getKpiSnapshot(from, to) {
            const totalsScope = scopedBookingParams(req.user, [from, to]);
            const topScope = scopedBookingParams(req.user, [from, to]);
            const [totalsResult, topProgramResult] = await Promise.all([
                pool.query(`
                    SELECT
                        COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS confirmed_revenue,
                        COALESCE(SUM(b.price), 0)::int AS projected_revenue,
                        COUNT(*)::int AS bookings,
                        COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed_bookings,
                        COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS preliminary_bookings
                    FROM bookings b
                    WHERE b.date::date >= $1::date
                      AND b.date::date <= $2::date
                      AND b.status != 'cancelled'
                      AND b.linked_to IS NULL
                      ${totalsScope.sql}
                `, totalsScope.params),
                pool.query(`
                    SELECT b.program_name, COUNT(*)::int AS cnt
                    FROM bookings b
                    WHERE b.date::date >= $1::date
                      AND b.date::date <= $2::date
                      AND b.status = 'confirmed'
                      AND b.linked_to IS NULL
                      ${topScope.sql}
                    GROUP BY b.program_name
                    ORDER BY cnt DESC, b.program_name
                    LIMIT 1
                `, topScope.params)
            ]);

            const row = totalsResult.rows[0] || {};
            const revenue = parseInt(row.confirmed_revenue || 0);
            const projectedRevenue = parseInt(row.projected_revenue || 0);
            const bookings = parseInt(row.bookings || 0);
            const confirmedBookings = parseInt(row.confirmed_bookings || 0);

            return {
                revenue,
                projectedRevenue,
                bookings,
                confirmedBookings,
                preliminaryBookings: parseInt(row.preliminary_bookings || 0),
                avgCheck: confirmedBookings > 0 ? Math.round(revenue / confirmedBookings) : 0,
                topProgram: topProgramResult.rows[0]?.program_name || '—'
            };
        }

        // Run all queries in parallel
        const [
            kpiToday, kpiWeek, kpiMonth,
            workersResult,
            tasksStats
        ] = await Promise.all([
            getKpiSnapshot(today, today),
            getKpiSnapshot(weekStart, today),
            getKpiSnapshot(monthStart, today),
            // Workers
            pool.query('SELECT id, name, display_name, type, purpose, is_active, updated_at FROM worker_roles ORDER BY created_at').catch(err => { log.warn('Worker roles fetch failed', err.message); return { rows: [] }; }),
            // Tasks stats: open/overdue truth for the operational center.
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status IN ('done', 'completed') AND COALESCE(completed_at, updated_at, created_at)::date >= $1::date) AS done,
                COUNT(*) FILTER (WHERE status NOT IN ('done', 'completed') AND archived_at IS NULL) AS open,
                COUNT(*) FILTER (WHERE status NOT IN ('done', 'completed') AND archived_at IS NULL AND deadline IS NOT NULL AND deadline::date < $2::date) AS overdue,
                COUNT(*) FILTER (WHERE status NOT IN ('done', 'completed') AND archived_at IS NULL AND ((NULLIF(date, '')::date = $2::date) OR (deadline IS NOT NULL AND deadline::date = $2::date))) AS due_today,
                COUNT(*) AS total
                FROM tasks`, [monthStart, today])
        ]);

        const kpi = {
            today: kpiToday,
            week: kpiWeek,
            month: kpiMonth
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
            overdue: parseInt(tasksStats.rows[0]?.overdue || 0),
            dueToday: parseInt(tasksStats.rows[0]?.due_today || 0),
            total: parseInt(tasksStats.rows[0]?.total || 0)
        };

        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            periods: {
                today: { label: 'Сьогодні', from: today, to: today },
                week: { label: 'Поточний тиждень', from: weekStart, to: today },
                month: { label: 'Поточний місяць', from: monthStart, to: today }
            },
            source: {
                bookings: 'bookings: status != cancelled, linked_to IS NULL, confirmed revenue for KPI, visibility-scoped',
                tasks: 'tasks: open excludes done/completed/archived, overdue uses deadline before today'
            },
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
        const lastBookingsScope = scopedBookingParams(req.user, []);
        const [lastTasks, lastBookings, lastHistory] = await Promise.all([
            pool.query(`
                SELECT assigned_to AS name, MAX(updated_at) AS last_activity
                FROM tasks WHERE assigned_to IS NOT NULL
                GROUP BY assigned_to
            `).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT created_by AS name, MAX(created_at) AS last_activity
                FROM bookings b WHERE b.created_by IS NOT NULL
                ${lastBookingsScope.sql}
                GROUP BY created_by
            `, lastBookingsScope.params).catch(() => ({ rows: [] })),
            pool.query(`
                SELECT username AS name, MAX(created_at) AS last_activity
                FROM history WHERE username IS NOT NULL
                GROUP BY username
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

// GET /api/center/prices/positions — product catalog positions with price-rule linkage
router.get('/prices/positions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                p.id AS product_id,
                p.code AS product_code,
                p.label AS product_label,
                p.name AS product_name,
                p.category AS product_category,
                p.price AS product_price,
                p.is_active AS product_active,
                pr.code AS price_code,
                pr.name AS price_name,
                pr.value AS price_value,
                pr.unit AS price_unit,
                pr.category AS price_category,
                pr.effective_from,
                pr.updated_at,
                pr.updated_by
            FROM products p
            LEFT JOIN price_rules pr ON pr.product_id = p.id
            WHERE p.is_active = true
            ORDER BY p.category, p.sort_order, p.name
        `);

        const positions = result.rows.map(row => ({
            productId: row.product_id,
            productCode: row.product_code,
            productLabel: row.product_label,
            productName: row.product_name,
            productCategory: row.product_category,
            productPrice: Number(row.product_price || 0),
            priceCode: row.price_code || null,
            priceName: row.price_name || null,
            priceValue: row.price_value === null || row.price_value === undefined ? null : Number(row.price_value),
            priceUnit: row.price_unit || null,
            priceCategory: row.price_category || null,
            effectiveFrom: row.effective_from || null,
            updatedAt: row.updated_at || null,
            updatedBy: row.updated_by || null
        }));

        res.json({
            success: true,
            source: 'products',
            linkSource: 'price_rules.product_id',
            positions,
            unlinkedCount: positions.filter(p => !p.priceCode).length
        });
    } catch (err) {
        if (err.message.includes('does not exist')) {
            return res.json({
                success: true,
                source: 'products',
                linkSource: 'price_rules.product_id',
                positions: [],
                unlinkedCount: 0
            });
        }
        log.error('GET /center/prices/positions error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження позицій прайсу' });
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
        const hasProductLinkUpdate = Object.prototype.hasOwnProperty.call(req.body, 'productId');
        const hasEffectiveFromUpdate = Object.prototype.hasOwnProperty.call(req.body, 'effectiveFrom');
        const hasAnyUpdate = value !== undefined
            || name !== undefined
            || unit !== undefined
            || category !== undefined
            || description !== undefined
            || hasEffectiveFromUpdate
            || hasProductLinkUpdate;
        if (!hasAnyUpdate) {
            return res.status(400).json({ success: false, error: 'Вкажіть поле для оновлення' });
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

        if (hasProductLinkUpdate && productId) {
            const productExists = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
            if (productExists.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Програму для привʼязки не знайдено' });
            }
        }

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
                effective_from = CASE WHEN $6::boolean THEN $7 ELSE effective_from END,
                updated_at = NOW(),
                updated_by = $8
             WHERE code = $9 RETURNING *`,
            [
                value !== undefined ? value : null,
                name !== undefined ? name || null : null,
                unit !== undefined ? unit || null : null,
                category !== undefined ? category || null : null,
                description !== undefined ? description || null : null,
                hasEffectiveFromUpdate,
                effectiveFrom || null,
                req.user.username,
                req.params.code
            ]
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
        const today = formatDateISO(getKyivNow());
        const conditions = [];
        const params = [];

        if (assignee) {
            params.push(assignee);
            conditions.push(`assigned_to = $${params.length}`);
        }
        if (status && status !== 'all') {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        } else {
            conditions.push(`status NOT IN ('done', 'completed')`);
            conditions.push(`archived_at IS NULL`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        params.push(today);
        const todayParam = `$${params.length}`;
        const result = await pool.query(
            `SELECT id, title, description, status, priority, category, assigned_to, date, deadline, created_at, updated_at,
                (status NOT IN ('done', 'completed') AND deadline IS NOT NULL AND deadline::date < ${todayParam}::date) AS is_overdue
             FROM tasks ${where}
             ORDER BY
                CASE WHEN status NOT IN ('done', 'completed') AND deadline IS NOT NULL AND deadline::date < ${todayParam}::date THEN 0 ELSE 1 END,
                CASE WHEN status = 'in_progress' THEN 0 WHEN status = 'todo' THEN 1 ELSE 2 END,
                CASE WHEN priority = 'high' THEN 0 WHEN priority = 'normal' THEN 1 ELSE 2 END,
                deadline ASC NULLS LAST,
                created_at DESC
             LIMIT 100`,
            params
        );
        res.json({
            success: true,
            period: { today },
            source: status && status !== 'all' ? 'tasks filtered by requested status' : 'open tasks only; done/completed/archived hidden by default',
            tasks: result.rows
        });
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
        const scoped = scopedBookingParams(req.user, [req.params.id]);
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.program_name, b.category, b.duration, b.price, b.status, b.room, b.kids_count,
                   b.banquet_guests, b.banquet_adults, b.banquet_tables, b.banquet_menu
            FROM bookings b
            WHERE b.customer_id = $1 AND b.status != 'cancelled'
            ${scoped.sql}
            ORDER BY b.date DESC, b.time DESC
            LIMIT 50
        `, scoped.params);
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
        const bookingsScope = scopedBookingParams(req.user, [from, to]);

        const [bookingsRes, tasksRes, expiringDiscounts, staffRes] = await Promise.all([
            pool.query(`
                SELECT b.date, b.time, b.program_name, b.category, b.price, b.status, b.room, b.kids_count, b.customer_id,
                       b.banquet_guests, b.banquet_adults, b.banquet_tables, b.banquet_menu
                FROM bookings b
                WHERE b.date::date >= $1::date AND b.date::date <= $2::date AND b.status != 'cancelled' AND b.linked_to IS NULL
                ${bookingsScope.sql}
                ORDER BY b.date, b.time
            `, bookingsScope.params),
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
                WHERE ss.date::date >= $1::date AND ss.date::date <= $2::date AND s.department = 'animators'
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
// RECEPTION / MANAGERS OPERATIONS CENTER
// ==========================================

router.get('/operations/today', async (req, res) => {
    try {
        const now = getKyivNow();
        const today = formatDateISO(now);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const bookingsScope = scopedBookingParams(req.user, [today]);

        const [
            bookingsRes,
            scheduleRes,
            tasksRes,
            reportsRes,
            historyRes,
            notesRes
        ] = await Promise.all([
            pool.query(`
                SELECT
                    b.id,
                    b.date::text AS date,
                    b.time,
                    b.duration,
                    b.label,
                    b.program_name,
                    b.category,
                    b.status,
                    b.room,
                    b.price,
                    b.payment_status,
                    b.paid_amount,
                    b.customer_id,
                    b.group_name,
                    c.name AS customer_name,
                    c.phone AS customer_phone
                FROM bookings b
                LEFT JOIN customers c ON c.id = b.customer_id
                WHERE b.date::date = $1::date
                  AND b.status != 'cancelled'
                  AND b.linked_to IS NULL
                  ${bookingsScope.sql}
                ORDER BY b.time ASC, b.id ASC
                LIMIT 120
            `, bookingsScope.params).catch(err => {
                log.warn('Operations center bookings read failed', err.message);
                return { rows: [] };
            }),
            pool.query(`
                SELECT
                    ss.id AS schedule_id,
                    ss.staff_id,
                    ss.date::text AS date,
                    ss.shift_start,
                    ss.shift_end,
                    ss.status,
                    ss.note,
                    s.name,
                    s.department,
                    s.position,
                    s.role_type,
                    COALESCE(s.is_active, true) AS is_active,
                    tr.id AS time_record_id,
                    tr.clock_in,
                    tr.clock_out,
                    tr.status AS time_status,
                    COALESCE(tr.late_minutes, 0) AS late_minutes,
                    COALESCE(tr.early_leave_minutes, 0) AS early_leave_minutes,
                    sc.id AS checkin_id,
                    sc.check_in,
                    sc.check_out,
                    sc.method AS checkin_method
                FROM staff_schedule ss
                JOIN staff s ON s.id = ss.staff_id
                LEFT JOIN hr_time_records tr
                  ON tr.staff_id = ss.staff_id
                 AND tr.record_date = ss.date::date
                LEFT JOIN staff_checkins sc
                  ON sc.staff_id = ss.staff_id
                 AND sc.date = ss.date::date
                WHERE ss.date::date = $1::date
                  AND ss.status IN ('working', 'remote')
                  AND COALESCE(s.is_active, true) = true
                ORDER BY ss.shift_start ASC NULLS LAST, s.department ASC, s.name ASC
                LIMIT 200
            `, [today]).catch(err => {
                log.warn('Operations center staff schedule read failed', err.message);
                return { rows: [] };
            }),
            pool.query(`
                SELECT
                    id,
                    title,
                    status,
                    priority,
                    assigned_to,
                    category,
                    source_type,
                    source_id,
                    date,
                    deadline,
                    created_at,
                    updated_at
                FROM tasks
                WHERE COALESCE(status, 'todo') NOT IN ('done', 'completed', 'cancelled', 'archived')
                  AND archived_at IS NULL
                  AND (
                    (NULLIF(date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND date::date = $1::date)
                    OR deadline::date <= $1::date
                    OR priority IN ('urgent', 'high')
                  )
                ORDER BY
                    CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                    deadline ASC NULLS LAST,
                    updated_at DESC
                LIMIT 24
            `, [today]).catch(err => {
                log.warn('Operations center tasks read failed', err.message);
                return { rows: [] };
            }),
            pool.query(`
                SELECT
                    id,
                    type,
                    category,
                    description,
                    submitted_by,
                    submitted_via,
                    status,
                    approval_status,
                    report_lifecycle_status,
                    created_at,
                    updated_at
                FROM reports
                WHERE COALESCE(status, 'new') IN ('new', 'processing')
                   OR COALESCE(approval_status, 'none') IN ('pending', 'task_created', 'in_review', 'rejected')
                   OR COALESCE(report_lifecycle_status, 'open') = 'open'
                ORDER BY created_at DESC
                LIMIT 12
            `).catch(err => {
                log.warn('Operations center reports read failed', err.message);
                return { rows: [] };
            }),
            pool.query(`
                SELECT id, action, username, data, created_at
                FROM history
                WHERE created_at::date = $1::date
                ORDER BY created_at DESC
                LIMIT 20
            `, [today]).catch(err => {
                log.warn('Operations center history read failed', err.message);
                return { rows: [] };
            }),
            pool.query(`
                SELECT key, value
                FROM settings
                WHERE key IN ('center_operations_handover_notes', 'center.operations.handover')
                ORDER BY key
            `).catch(err => {
                log.warn('Operations center handover notes read failed', err.message);
                return { rows: [] };
            })
        ]);

        const bookings = bookingsRes.rows.map(row => {
            const price = Number(row.price || 0);
            const paidAmount = Number(row.paid_amount || 0);
            return {
                id: row.id,
                date: normalizeDateText(row.date),
                time: row.time || null,
                duration: Number(row.duration || 0),
                label: row.label || row.program_name || row.id,
                programName: row.program_name || row.label || '',
                category: row.category || '',
                status: row.status || '',
                room: row.room || '',
                price,
                paymentStatus: row.payment_status || 'pending',
                paidAmount,
                debtAmount: Math.max(0, price - paidAmount),
                customerId: row.customer_id || null,
                clientName: row.customer_name || row.group_name || row.label || '',
                customerPhone: row.customer_phone || ''
            };
        });

        const shifts = scheduleRes.rows.map(row => {
            const attendance = shiftAttendanceStatus(row, nowMinutes);
            const start = timeToMinutes(row.shift_start);
            const end = timeToMinutes(row.shift_end);
            const isCurrent = start !== null && end !== null && nowMinutes >= start && nowMinutes <= end;
            return {
                scheduleId: row.schedule_id,
                staffId: row.staff_id,
                date: normalizeDateText(row.date),
                name: row.name,
                department: row.department || '',
                position: row.position || '',
                roleType: row.role_type || '',
                plannedStart: row.shift_start || null,
                plannedEnd: row.shift_end || null,
                status: row.status || '',
                note: row.note || '',
                isCurrent,
                attendance,
                actualArrival: timeFromTimestamp(row.clock_in || row.check_in),
                actualLeave: timeFromTimestamp(row.clock_out || row.check_out),
                attendanceSource: row.time_record_id ? 'hr_time_records' : (row.checkin_id ? 'staff_checkins' : 'none')
            };
        });

        const onShiftNow = shifts.filter(shift => shift.isCurrent && !['absent', 'excused'].includes(shift.attendance.status));
        const lateStaff = shifts.filter(shift => shift.attendance.status === 'late');
        const noShowStaff = shifts.filter(shift => shift.attendance.status === 'absent');
        const pendingPayments = bookings.filter(booking =>
            booking.status === 'confirmed'
            && booking.price > 0
            && booking.paymentStatus !== 'paid'
            && booking.paidAmount < booking.price
        );
        const unconfirmedBookings = bookings.filter(booking => booking.status === 'preliminary');
        const openTasks = tasksRes.rows.map(row => ({
            id: row.id,
            title: row.title,
            status: row.status || 'todo',
            priority: row.priority || 'normal',
            assignedTo: row.assigned_to || '',
            category: row.category || '',
            sourceType: row.source_type || '',
            sourceId: row.source_id || '',
            date: row.date || '',
            deadline: row.deadline || null,
            isOverdue: Boolean(row.deadline && new Date(row.deadline).getTime() < now.getTime())
        }));
        const pendingReports = reportsRes.rows.map(row => ({
            id: row.id,
            type: row.type,
            category: row.category || '',
            description: row.description || '',
            submittedBy: row.submitted_by || '',
            submittedVia: row.submitted_via || '',
            status: row.status || 'new',
            approvalStatus: row.approval_status || 'none',
            lifecycleStatus: row.report_lifecycle_status || 'open',
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        const timelineEvents = [
            ...bookings.map(booking => ({
                id: `booking:${booking.id}`,
                type: 'booking',
                time: booking.time,
                title: booking.programName || booking.label,
                detail: [booking.room, booking.clientName].filter(Boolean).join(' · '),
                status: booking.status,
                bookingId: booking.id
            })),
            ...historyRes.rows.map(row => ({
                id: `history:${row.id}`,
                type: 'history',
                time: timeFromTimestamp(row.created_at),
                title: row.action,
                detail: row.username || 'system',
                status: 'audit'
            }))
        ].sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99'))).slice(0, 40);

        const incidents = [
            ...noShowStaff.map(shift => operationsIssue('staff_no_show', 'critical', `${shift.name}: не вийшов`, `${shift.plannedStart || '—'}-${shift.plannedEnd || '—'}`, { staffId: shift.staffId })),
            ...lateStaff.map(shift => operationsIssue('staff_late', 'warning', `${shift.name}: запізнюється`, `${shift.plannedStart || '—'}-${shift.plannedEnd || '—'}`, { staffId: shift.staffId })),
            ...pendingPayments.slice(0, 8).map(booking => operationsIssue('payment_pending', 'warning', `Оплата: ${booking.label}`, `Борг ${booking.debtAmount} грн`, { bookingId: booking.id })),
            ...unconfirmedBookings.slice(0, 8).map(booking => operationsIssue('booking_unconfirmed', 'warning', `Не підтверджено: ${booking.label}`, [booking.time, booking.clientName].filter(Boolean).join(' · '), { bookingId: booking.id })),
            ...openTasks.filter(task => task.isOverdue).slice(0, 8).map(task => operationsIssue('task_overdue', 'critical', `Прострочена задача: ${task.title}`, task.assignedTo || 'без відповідального', { taskId: task.id })),
            ...pendingReports.filter(report => report.approvalStatus !== 'approved').slice(0, 8).map(report => operationsIssue('report_pending', 'warning', `Звіт #${report.id} потребує уваги`, report.category || report.status, { reportId: report.id }))
        ];

        res.json({
            success: true,
            date: today,
            generatedAt: new Date().toISOString(),
            source: {
                bookings: 'bookings + customers, visibility-scoped, today only',
                shifts: 'staff_schedule + hr_time_records + staff_checkins, read-only',
                tasks: 'tasks open/urgent/due/overdue',
                reports: 'reports metadata only; raw_data is intentionally omitted',
                handoverNotes: 'settings.center_operations_handover_notes'
            },
            counts: {
                bookings: bookings.length,
                activeShifts: shifts.length,
                onShiftNow: onShiftNow.length,
                lateStaff: lateStaff.length,
                noShowStaff: noShowStaff.length,
                pendingPayments: pendingPayments.length,
                pendingReports: pendingReports.length,
                openTasks: openTasks.length,
                incidents: incidents.length
            },
            bookings,
            timelineEvents,
            activeShifts: shifts,
            onShiftNow,
            lateStaff,
            noShowStaff,
            pendingPayments,
            pendingReports,
            openTasks,
            incidents,
            handoverNotes: parseOperationsNotes(notesRes.rows)
        });
    } catch (err) {
        log.error('GET /center/operations/today error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження операційного центру' });
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
        const bookingsScope = scopedBookingParams(req.user, [from, to]);

        const [bookingsRes, paymentsRes] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_bookings,
                    COALESCE(SUM(b.price), 0)::int AS total_price,
                    COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                    COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS confirmed_revenue,
                    COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS preliminary,
                    COALESCE(SUM(CASE WHEN b.status = 'preliminary' THEN b.price ELSE 0 END), 0)::int AS preliminary_revenue
                FROM bookings b
                WHERE b.date::date >= $1::date AND b.date::date <= $2::date AND b.linked_to IS NULL AND b.status != 'cancelled'
                ${bookingsScope.sql}
            `, bookingsScope.params),
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS total_income,
                    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS total_expense,
                    COUNT(*) FILTER (WHERE type = 'income')::int AS income_count,
                    COUNT(*) FILTER (WHERE type = 'expense')::int AS expense_count
                FROM finance_transactions
                WHERE date::date >= $1::date AND date::date <= $2::date
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
        const scoped = scopedBookingParams(req.user, [from, to]);

        const result = await pool.query(`
            SELECT b.date,
                COUNT(*)::int AS count,
                COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date::date >= $1::date AND b.date::date <= $2::date AND b.status != 'cancelled' AND b.linked_to IS NULL
            ${scoped.sql}
            GROUP BY b.date
            ORDER BY b.date
        `, scoped.params);

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
        const scoped = scopedBookingParams(req.user, [from, to]);

        const result = await pool.query(`
            SELECT
                b.program_id, b.program_name, b.category,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE b.status = 'preliminary')::int AS preliminary,
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.price ELSE 0 END), 0)::int AS revenue,
                COALESCE(ROUND(AVG(CASE WHEN b.status = 'confirmed' THEN b.price END)), 0)::int AS avg_price,
                COALESCE(ROUND(AVG(b.kids_count)), 0)::int AS avg_kids
            FROM bookings b
            WHERE b.date::date >= $1::date AND b.date::date <= $2::date AND b.linked_to IS NULL AND b.status != 'cancelled'
            ${scoped.sql}
            GROUP BY b.program_id, b.program_name, b.category
            ORDER BY revenue DESC
        `, scoped.params);

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
        const comboParams = [monthStart, today];
        const comboScopeB1 = getVisibleBookingScope(req.user, comboParams, 'b1');
        const comboScopeB2 = getVisibleBookingScope(req.user, comboParams, 'b2');

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
            WHERE b1.date::date >= $1::date AND b1.date::date <= $2::date
                AND b1.status != 'cancelled' AND b2.status != 'cancelled'
                ${comboScopeB1.sql}
                ${comboScopeB2.sql}
            GROUP BY b1.program_name, b2.program_name
            HAVING COUNT(*) >= 2
            ORDER BY combo_count DESC
            LIMIT 15
        `, comboParams);

        const addonScope = scopedBookingParams(req.user, [monthStart, today]);
        // Top add-ons (linked bookings)
        const addons = await pool.query(`
            SELECT b.program_name, COUNT(*)::int AS count, COALESCE(SUM(b.price), 0)::int AS revenue
            FROM bookings b
            WHERE b.date::date >= $1::date AND b.date::date <= $2::date AND b.linked_to IS NOT NULL AND b.status != 'cancelled'
            ${addonScope.sql}
            GROUP BY b.program_name
            ORDER BY count DESC
            LIMIT 10
        `, addonScope.params);

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
