/**
 * routes/afisha.js — Events CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime } = require('../services/booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('Afisha');

router.get('/', async (req, res) => {
    try {
        const { type } = req.query;
        const validTypes = ['event', 'birthday', 'regular'];
        if (type && validTypes.includes(type)) {
            const result = await pool.query('SELECT * FROM afisha WHERE type = $1 ORDER BY date, time', [type]);
            return res.json(result.rows);
        }
        const result = await pool.query('SELECT * FROM afisha ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        log.error('Get error', err);
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
        log.error('Get by date error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { date, time, title, duration, type } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : 'event';
        const eventDuration = eventType === 'birthday' ? 0 : (duration || 60);
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration, type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [date, time, title, eventDuration, eventType]
        );
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, time, title, duration, type } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : undefined;
        if (eventType) {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4, type=$5 WHERE id=$6',
                [date, time, title, duration || 60, eventType, id]
            );
        } else {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4 WHERE id=$5',
                [date, time, title, duration || 60, id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
