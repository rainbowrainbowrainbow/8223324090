/**
 * routes/afisha.js — Events CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime } = require('../services/booking');

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM afisha ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        console.error('Afisha get error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        const result = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
        res.json(result.rows);
    } catch (err) {
        console.error('Afisha get by date error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { date, time, title, duration } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration) VALUES ($1, $2, $3, $4) RETURNING *',
            [date, time, title, duration || 60]
        );
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Afisha create error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, time, title, duration } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        await pool.query(
            'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4 WHERE id=$5',
            [date, time, title, duration || 60, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Afisha update error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Afisha delete error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
