/**
 * routes/afisha.js — Events / Afisha CRUD
 */

const express = require('express');
const { pool } = require('../db');
const { validateDate, validateTime } = require('../services/booking');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../middleware/errors');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM afisha ORDER BY date, time');
    res.json(result.rows);
}));

router.get('/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    if (!validateDate(date)) throw new ValidationError('Invalid date');
    const result = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
    res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
    const { date, time, title, duration } = req.body;
    if (!date || !time || !title) throw new ValidationError('date, time, title required');
    if (!validateDate(date)) throw new ValidationError('Invalid date');
    if (!validateTime(time)) throw new ValidationError('Invalid time');
    const result = await pool.query(
        'INSERT INTO afisha (date, time, title, duration) VALUES ($1, $2, $3, $4) RETURNING *',
        [date, time, title, duration || 60]
    );
    res.json({ success: true, item: result.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { date, time, title, duration } = req.body;
    if (!date || !time || !title) throw new ValidationError('date, time, title required');
    if (!validateDate(date)) throw new ValidationError('Invalid date');
    if (!validateTime(time)) throw new ValidationError('Invalid time');
    await pool.query(
        'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4 WHERE id=$5',
        [date, time, title, duration || 60, id]
    );
    res.json({ success: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
    res.json({ success: true });
}));

module.exports = router;
