/**
 * routes/sales.js — Sales Techniques API (v20.5.0)
 * Call scripts, reviews, free slots, upsell suggestions, price-per-child
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Sales');

// GET /api/sales/call-script — active call script
router.get('/call-script', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM call_scripts WHERE is_active = true ORDER BY id LIMIT 1'
        );
        res.json({ script: result.rows[0] || null });
    } catch (err) {
        log.error('call-script error', err);
        res.status(500).json({ error: 'Помилка завантаження скрипту' });
    }
});

// GET /api/sales/upsells — upsell catalog
router.get('/upsells', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM upsell_catalog WHERE is_active = true ORDER BY sort_order'
        );
        res.json({ upsells: result.rows });
    } catch (err) {
        log.error('upsells error', err);
        res.status(500).json({ error: 'Помилка завантаження' });
    }
});

// POST /api/sales/booking-upsells — add upsells to a booking
router.post('/booking-upsells', async (req, res) => {
    const { booking_id, upsells } = req.body;
    if (!booking_id || !Array.isArray(upsells)) {
        return res.status(400).json({ error: 'Потрібен booking_id та масив upsells' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const u of upsells) {
            if (!u.name) continue;
            await client.query(
                'INSERT INTO booking_upsells (booking_id, upsell_name, price) VALUES ($1, $2, $3)',
                [booking_id, u.name, u.price || 0]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('booking-upsells error', err);
        res.status(500).json({ error: 'Помилка збереження' });
    } finally {
        client.release();
    }
});

// GET /api/sales/booking-upsells/:bookingId — get upsells for a booking
router.get('/booking-upsells/:bookingId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM booking_upsells WHERE booking_id = $1 ORDER BY added_at',
            [req.params.bookingId]
        );
        res.json({ upsells: result.rows });
    } catch (err) {
        log.error('get booking-upsells error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/sales/program-reviews/:programName — last N reviews for a program
router.get('/program-reviews/:programName', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 3;
        const programName = decodeURIComponent(req.params.programName);

        // Use bookings with notes as reviews — recent completed bookings
        const result = await pool.query(
            `SELECT b.notes, b.label, b.date, b.kids_count, b.program_name,
                    c.name as customer_name
             FROM bookings b
             LEFT JOIN customers c ON c.id = b.customer_id
             WHERE b.program_name = $1
               AND b.notes IS NOT NULL AND b.notes != ''
               AND b.status IN ('confirmed', 'completed')
             ORDER BY b.date DESC
             LIMIT $2`,
            [programName, limit]
        );

        res.json({ reviews: result.rows });
    } catch (err) {
        log.error('program-reviews error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/sales/free-slots — free weekend dates in a month
router.get('/free-slots', async (req, res) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const year = parseInt(req.query.year) || now.getFullYear();

        // Find all Saturdays and Sundays in the month
        const weekends = [];
        const date = new Date(year, month - 1, 1);
        while (date.getMonth() === month - 1) {
            const day = date.getDay();
            if (day === 0 || day === 6) {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                weekends.push(dateStr);
            }
            date.setDate(date.getDate() + 1);
        }

        // Check which weekends have bookings
        const bookedResult = await pool.query(
            `SELECT DISTINCT date FROM bookings
             WHERE date = ANY($1) AND status NOT IN ('cancelled', 'deleted')`,
            [weekends]
        );
        const bookedDates = new Set(bookedResult.rows.map(r => r.date));

        const freeDates = weekends.filter(d => !bookedDates.has(d));

        res.json({
            month, year,
            totalWeekends: weekends.length,
            freeWeekends: freeDates.length,
            freeDates,
            bookedDates: [...bookedDates]
        });
    } catch (err) {
        log.error('free-slots error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/sales/price-per-child — calculate price breakdown
router.get('/price-per-child', async (req, res) => {
    try {
        const price = parseInt(req.query.price) || 0;
        const kids = parseInt(req.query.kids) || 1;

        const perChild = Math.round(price / Math.max(1, kids));

        res.json({ price, kids, perChild });
    } catch (err) {
        res.status(500).json({ error: 'Помилка' });
    }
});

module.exports = router;
