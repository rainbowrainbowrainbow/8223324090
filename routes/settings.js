/**
 * routes/settings.js — Settings, stats, rooms, health
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, validateSettingKey, mapBookingRow, timeToMinutes, ALL_ROOMS } = require('../services/booking');
const { createLogger } = require('../utils/logger');
const { logAdminAction } = require('../services/adminAudit');
const { settingsCache } = require('../services/cache');

const { requireRole, requireMinRole } = require('../middleware/auth');
const log = createLogger('Settings');

// Stats
router.get('/stats/:dateFrom/:dateTo', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.params;
        if (!validateDate(dateFrom) || !validateDate(dateTo)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const result = await pool.query(
            "SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != 'cancelled' ORDER BY date, time",
            [dateFrom, dateTo]
        );
        res.json(result.rows.map(mapBookingRow));
    } catch (err) {
        log.error('Stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Settings CRUD — v19.10: with in-memory cache
router.get('/settings/:key', async (req, res) => {
    try {
        const key = req.params.key;
        const cached = settingsCache.get(key);
        if (cached !== null) {
            return res.json({ value: cached });
        }
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        const value = result.rows.length > 0 ? result.rows[0].value : null;
        settingsCache.set(key, value);
        res.json({ value });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/settings', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key || !validateSettingKey(key)) {
            return res.status(400).json({ error: 'Invalid setting key' });
        }
        if (typeof value !== 'string' || value.length > 1000) {
            return res.status(400).json({ error: 'Invalid setting value' });
        }
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [key, value]
        );
        settingsCache.invalidate(key);
        // v19.10: Audit trail for settings changes
        logAdminAction('settings_update', 'settings', {
            username: req.user?.username, target: key,
            details: { value: value.length > 50 ? value.slice(0, 50) + '...' : value },
            ip: req.ip, requestId: req.headers['x-request-id']
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v33.3: PUT /api/settings/language — dedicated language endpoint
router.put('/settings/language', requireRole('creator', 'director', 'admin', 'user'), async (req, res) => {
    try {
        const { value } = req.body;
        if (!['uk', 'en'].includes(value)) {
            return res.status(400).json({ error: 'value must be uk or en' });
        }
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('language', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
            [value]
        );
        settingsCache.invalidate('language');
        res.json({ success: true, value });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Free rooms
router.get('/rooms/free/:date/:time/:duration', async (req, res) => {
    try {
        const { date, time, duration } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const dur = parseInt(duration) || 60;

        const bookings = await pool.query(
            "SELECT room, time, duration FROM bookings WHERE date = $1 AND status != 'cancelled'",
            [date]
        );

        const reqStart = timeToMinutes(time);
        const reqEnd = reqStart + dur;

        const occupiedRooms = new Set();
        for (const b of bookings.rows) {
            if (!b.room) continue;
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + (b.duration || 0);
            if (reqStart < bEnd && reqEnd > bStart) {
                occupiedRooms.add(b.room);
            }
        }

        const free = ALL_ROOMS.filter(r => !occupiedRooms.has(r));
        res.json({ free, occupied: Array.from(occupiedRooms), total: ALL_ROOMS.length });
    } catch (err) {
        log.error('Free rooms error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v20.13: Version endpoint — returns package.json version
// v29.1.0: Added testMode flag
router.get('/version', (req, res) => {
    const pkg = require('../package.json');
    res.json({
        version: pkg.version,
        name: 'Event Genix',
        testMode: process.env.TEST_MODE === 'true'
    });
});

// Health check — v19.17: deep health check with DB pool, memory, uptime
router.get('/health', async (req, res) => {
    const pkg = require('../package.json');
    const checks = { version: pkg.version, database: 'unknown', uptime: process.uptime(), timestamp: new Date().toISOString() };
    const mem = process.memoryUsage();
    checks.memory = {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heap: Math.round(mem.heapUsed / 1024 / 1024) + '/' + Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
    };

    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        checks.database = 'connected';
        checks.dbLatency = (Date.now() - start) + 'ms';
        // Pool stats
        checks.pool = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
    } catch (err) {
        checks.database = 'error: ' + err.message;
    }

    let userCount = 0;
    try {
        const uc = await pool.query('SELECT COUNT(*)::int as c FROM users');
        userCount = uc.rows[0].c;
    } catch { /* ignore */ }
    checks.userCount = userCount;

    // Memory warning — use absolute heap limit (512MB) instead of percentage
    // because Node.js heapTotal grows dynamically and heapUsed/heapTotal ratio
    // is unreliable (often 85-95% even under normal load)
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    checks.status = checks.database === 'connected' && heapUsedMB < 512 ? 'ok' : 'degraded';

    res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

// v8.3: Automation rules CRUD
router.get('/automation-rules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM automation_rules ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('Automation rules get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/automation-rules', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { name, trigger_type, trigger_condition, actions, days_before } = req.body;
        if (!name || !trigger_condition || !actions) {
            return res.status(400).json({ error: 'name, trigger_condition, actions required' });
        }
        const result = await pool.query(
            `INSERT INTO automation_rules (name, trigger_type, trigger_condition, actions, days_before)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, trigger_type || 'booking_create', trigger_condition, actions, days_before || 0]
        );
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        log.error('Automation rule create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/automation-rules/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, trigger_type, trigger_condition, actions, days_before, is_active } = req.body;
        await pool.query(
            `UPDATE automation_rules SET name=$1, trigger_type=$2, trigger_condition=$3, actions=$4, days_before=$5, is_active=$6 WHERE id=$7`,
            [name, trigger_type || 'booking_create', trigger_condition, actions, days_before || 0, is_active !== false, id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Automation rule update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/automation-rules/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        await pool.query('DELETE FROM automation_rules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Automation rule delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v17.9.0: System status — management-only comprehensive health dashboard
router.get('/system-status', requireRole('creator', 'director', 'vice_director', 'senior_manager'), async (req, res) => {
    try {
        const startMs = Date.now();

        // DB table counts for key entities
        // v19.10: Use hardcoded Set to ensure only known table names are used (prevent SQL injection)
        const ALLOWED_STATUS_TABLES = new Set(['bookings', 'users', 'tasks', 'customers', 'finance_transactions', 'staff', 'certificates', 'contractors', 'warehouse_stock', 'procurement_lists']);
        const counts = {};
        for (const t of ALLOWED_STATUS_TABLES) {
            try {
                const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
                counts[t] = r.rows[0].c;
            } catch { counts[t] = null; }
        }

        // Last backup — from settings or action log
        let lastBackup = null;
        try {
            const bkpR = await pool.query(
                "SELECT created_at FROM user_action_log WHERE action = 'api:POST' AND target LIKE '%backup%' ORDER BY created_at DESC LIMIT 1"
            );
            if (bkpR.rows.length > 0) lastBackup = bkpR.rows[0].created_at;
        } catch { /* ignore */ }

        // Active users in last 24h
        let activeUsers24h = 0;
        try {
            const auR = await pool.query(
                "SELECT COUNT(DISTINCT username)::int AS c FROM user_action_log WHERE created_at > NOW() - INTERVAL '24 hours'"
            );
            activeUsers24h = auR.rows[0].c;
        } catch { /* ignore */ }

        // Recent API errors (4xx/5xx in last hour)
        let recentErrors = 0;
        try {
            const errR = await pool.query(
                "SELECT COUNT(*)::int AS c FROM user_action_log WHERE created_at > NOW() - INTERVAL '1 hour' AND meta->>'status' >= '400'"
            );
            recentErrors = errR.rows[0].c;
        } catch { /* ignore */ }

        // Migrations
        let migrations = [];
        try {
            const mgR = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5');
            migrations = mgR.rows;
        } catch { /* ignore */ }

        const mem = process.memoryUsage();

        res.json({
            ok: true,
            checked_at: new Date().toISOString(),
            elapsed_ms: Date.now() - startMs,
            database: { connected: true, counts },
            activity: { active_users_24h: activeUsers24h, recent_errors_1h: recentErrors },
            backup: { last_triggered: lastBackup },
            memory_mb: {
                rss: Math.round(mem.rss / 1024 / 1024),
                heap_used: Math.round(mem.heapUsed / 1024 / 1024),
                heap_total: Math.round(mem.heapTotal / 1024 / 1024),
            },
            uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
            node_version: process.version,
            migrations,
        });
    } catch (err) {
        log.error(`System status error: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
