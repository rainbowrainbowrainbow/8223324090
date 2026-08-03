'use strict';

const router = require('express').Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { normalizeUserId } = require('../services/taskPolicy');
const { myDayError } = require('../services/myDayTaxonomy');
const habits = require('../services/myDayHabits');

router.use(authenticateToken);

function currentUserId(req) {
    const id = normalizeUserId(req.user);
    if (!id) throw myDayError('Потрібна авторизація.', 401, 'MY_DAY_UNAUTHENTICATED');
    return id;
}

function sendError(res, error) {
    const status = error.statusCode || 500;
    res.status(status).json({
        success: false,
        code: error.code || 'MY_DAY_HABIT_ERROR',
        error: status >= 500 ? 'Не вдалося оновити звички My Day.' : error.message
    });
}

async function withTransaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

router.get('/', async (req, res) => {
    try {
        const localDate = habits.normalizeLocalDate(req.query.date || habits.kyivToday());
        const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
        const list = await habits.listHabits(pool, currentUserId(req), { date: localDate, includeArchived });
        res.json({ success: true, date: localDate, habits: list });
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/', async (req, res) => {
    try {
        const habit = await withTransaction(client => habits.createHabit(client, currentUserId(req), req.body || {}));
        res.status(201).json({ success: true, habit });
    } catch (error) {
        sendError(res, error);
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const habit = await withTransaction(client => habits.updateHabit(client, currentUserId(req), habits.positiveInteger(req.params.id, 'habit'), req.body || {}));
        res.json({ success: true, habit });
    } catch (error) {
        sendError(res, error);
    }
});

router.put('/:habitId/check-ins/:localDate', async (req, res) => {
    try {
        const checkin = await withTransaction(client => habits.upsertCheckin(
            client,
            currentUserId(req),
            habits.positiveInteger(req.params.habitId, 'habit'),
            habits.normalizeLocalDate(req.params.localDate),
            req.body || {}
        ));
        res.json({ success: true, checkin });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete('/:habitId/check-ins/:localDate', async (req, res) => {
    try {
        await habits.deleteCheckin(
            pool,
            currentUserId(req),
            habits.positiveInteger(req.params.habitId, 'habit'),
            habits.normalizeLocalDate(req.params.localDate)
        );
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
