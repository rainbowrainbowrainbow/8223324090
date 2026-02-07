/**
 * routes/settings.js — Settings + stats endpoints
 */

const express = require('express');
const { pool } = require('../db');
const { validateDate, validateTime, validateSettingKey, mapBookingRow, timeToMinutes, ALL_ROOMS } = require('../services/booking');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../middleware/errors');

const router = express.Router();

// Stats
router.get('/stats/:dateFrom/:dateTo', asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.params;
    if (!validateDate(dateFrom) || !validateDate(dateTo)) {
        throw new ValidationError('Invalid date format');
    }
    const result = await pool.query(
        'SELECT * FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != \'cancelled\' ORDER BY date, time',
        [dateFrom, dateTo]
    );
    res.json(result.rows.map(mapBookingRow));
}));

// Settings CRUD
router.get('/settings/:key', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
    res.json({ value: result.rows.length > 0 ? result.rows[0].value : null });
}));

router.post('/settings', asyncHandler(async (req, res) => {
    const { key, value } = req.body;
    if (!key || !validateSettingKey(key)) {
        throw new ValidationError('Invalid setting key');
    }
    if (typeof value !== 'string' || value.length > 1000) {
        throw new ValidationError('Invalid setting value');
    }
    await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
    );
    res.json({ success: true });
}));

// Free rooms
router.get('/rooms/free/:date/:time/:duration', asyncHandler(async (req, res) => {
    const { date, time, duration } = req.params;
    if (!validateDate(date)) throw new ValidationError('Invalid date');
    if (!validateTime(time)) throw new ValidationError('Invalid time');
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
}));

// Health check — always returns 200 (even if DB is down)
router.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.json({ status: 'ok', database: 'not connected' });
    }
});

module.exports = router;
