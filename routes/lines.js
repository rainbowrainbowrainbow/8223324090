/**
 * routes/lines.js — Animator lines CRUD
 */

const express = require('express');
const { pool } = require('../db');
const { validateDate, ensureDefaultLines } = require('../services/booking');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../middleware/errors');

const router = express.Router();

router.get('/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    await ensureDefaultLines(date);
    const result = await pool.query(
        'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id',
        [date]
    );
    const lines = result.rows.map(row => ({
        id: row.line_id,
        name: row.name,
        color: row.color,
        fromSheet: row.from_sheet
    }));
    res.json(lines);
}));

router.post('/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const lines = req.body;

    if (!validateDate(date)) throw new ValidationError('Invalid date format');
    if (!Array.isArray(lines)) throw new ValidationError('Lines must be an array');

    const client = await pool.connect();
    try {
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
        throw err;
    } finally {
        client.release();
    }
}));

module.exports = router;
