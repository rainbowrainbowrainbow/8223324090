/**
 * routes/lines.js — Animator lines per date
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, syncScheduledAnimatorLines } = require('../services/booking');
const { broadcast } = require('../services/websocket');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('Lines');

// All lines routes require authentication
router.use(authenticateToken);

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });

        const sync = await syncScheduledAnimatorLines(date);
        const result = await pool.query(
            `SELECT
                 l.*,
                 ss.shift_start,
                 ss.shift_end,
                 ss.status AS shift_status,
                 s.id AS staff_id
             FROM lines_by_date l
             LEFT JOIN staff s ON l.line_id = s.id::text
             LEFT JOIN staff_schedule ss
                ON ss.staff_id = s.id
               AND ss.date = l.date
               AND ss.status IN ('working', 'remote')
             WHERE l.date = $1
             ORDER BY
                CASE WHEN ss.staff_id IS NULL THEN 1 ELSE 0 END,
                ss.shift_start NULLS LAST,
                l.id`,
            [date]
        );
        const lines = result.rows.map(row => ({
            id: row.line_id,
            name: row.name,
            color: row.color,
            fromSheet: row.from_sheet,
            staffId: row.staff_id || null,
            shiftStart: row.shift_start || null,
            shiftEnd: row.shift_end || null,
            shiftStatus: row.shift_status || null,
            source: row.staff_id ? 'staff_schedule' : (row.from_sheet ? 'sheet' : 'manual')
        }));
        res.set('X-Timeline-Lines-Source', sync.source);
        res.json(lines);
    } catch (err) {
        log.error('Error fetching lines', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:date', async (req, res) => {
    const client = await pool.connect();
    try {
        const { date } = req.params;
        const lines = req.body;

        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        if (!Array.isArray(lines)) return res.status(400).json({ error: 'Lines must be an array' });

        await client.query('BEGIN');
        await client.query('DELETE FROM lines_by_date WHERE date = $1', [date]);

        for (const line of lines) {
            await client.query(
                'INSERT INTO lines_by_date (date, line_id, name, color, from_sheet) VALUES ($1, $2, $3, $4, $5)',
                [date, line.id, line.name, line.color, line.fromSheet || false]
            );
        }

        await client.query('COMMIT');

        // WebSocket: notify other clients about line changes
        broadcast('line:updated', { date, lines }, req.user?.id?.toString(), date);

        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Error saving lines', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
