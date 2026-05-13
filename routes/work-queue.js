/**
 * routes/work-queue.js — read-only manager operational queue
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { buildWorkQueue } = require('../services/workQueue');
const { createLogger } = require('../utils/logger');

const log = createLogger('WorkQueue');

router.use(authenticateToken);
router.use(requireRole('manager'));

router.get('/', async (req, res) => {
    try {
        const queue = await buildWorkQueue({
            pool,
            user: req.user,
            limit: req.query.limit
        });
        res.json({ success: true, queue });
    } catch (err) {
        log.error('GET /work-queue error', err);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити робочу чергу' });
    }
});

module.exports = router;
