/**
 * routes/settings.js — Settings, stats, rooms, health
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, validateSettingKey, mapBookingRow, timeToMinutes, ALL_ROOMS } = require('../services/booking');
const { createLogger } = require('../utils/logger');

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

// Settings CRUD
router.get('/settings/:key', async (req, res) => {
    try {
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
        res.json({ value: result.rows.length > 0 ? result.rows[0].value : null });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/settings', async (req, res) => {
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
        res.json({ success: true });
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

// Health check
router.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        // Check password reset migration status
        let passwordReset = 'unknown';
        let userCount = 0;
        try {
            const migCheck = await pool.query(
                "SELECT applied_at FROM schema_migrations WHERE version = '005_password_reset'"
            );
            passwordReset = migCheck.rows.length > 0
                ? `done at ${migCheck.rows[0].applied_at}`
                : 'not applied';
        } catch { passwordReset = 'schema_migrations not found'; }
        try {
            const uc = await pool.query('SELECT COUNT(*)::int as c FROM users');
            userCount = uc.rows[0].c;
        } catch { /* ignore */ }
        res.json({ status: 'ok', database: 'connected', passwordReset, userCount });
    } catch (err) {
        res.json({ status: 'ok', database: 'not connected' });
    }
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

router.post('/automation-rules', async (req, res) => {
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

router.put('/automation-rules/:id', async (req, res) => {
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

router.delete('/automation-rules/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM automation_rules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Automation rule delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
