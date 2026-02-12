/**
 * routes/lines.js — Animator lines per date
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, ensureDefaultLines } = require('../services/booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('Lines');

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        await ensureDefaultLines(date);
        const result = await pool.query(
            'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id',
            [date]
        );
        const lines = result.rows.map(row => ({
            id: row.line_id,
            name: row.name,
            color: row.color,
            fromSheet: row.from_sheet
        }));
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
