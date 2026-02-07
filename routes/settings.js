/**
 * routes/settings.js — Settings, stats, rooms, health
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, validateSettingKey, mapBookingRow, timeToMinutes, ALL_ROOMS } = require('../services/booking');

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
        console.error('Stats error:', err);
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
        console.error('Free rooms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
router.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.json({ status: 'ok', database: 'not connected' });
    }
});

module.exports = router;
