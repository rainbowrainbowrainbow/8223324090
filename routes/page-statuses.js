/**
 * routes/page-statuses.js — Page status badges API
 * v20.6.0: Status badges for sidebar navigation
 *
 * Endpoints:
 *   GET   /api/page-statuses        — all page statuses
 *   PATCH /api/page-statuses/:path  — update status (creator/director only)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('PageStatuses');

// GET /api/page-statuses — all statuses (for sidebar rendering)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT page_path, status FROM page_statuses ORDER BY page_path');
        const statuses = {};
        for (const row of result.rows) {
            statuses[row.page_path] = row.status;
        }
        res.json({ success: true, statuses });
    } catch (err) {
        log.error('GET /page-statuses error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження статусів' });
    }
});

// PATCH /api/page-statuses/:path — update status (director+)
router.patch('/*', requireMinRole('director'), async (req, res) => {
    try {
        const pagePath = '/' + req.params[0];
        const { status } = req.body;
        const VALID = ['building', 'testing', 'updated', 'in_tests', 'ready'];
        if (!VALID.includes(status)) {
            return res.status(400).json({ success: false, error: `Невірний статус. Допустимі: ${VALID.join(', ')}` });
        }
        const result = await pool.query(
            `INSERT INTO page_statuses (page_path, status, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (page_path) DO UPDATE SET status = $2, updated_at = NOW()
             RETURNING *`,
            [pagePath, status]
        );
        res.json({ success: true, pageStatus: result.rows[0] });
    } catch (err) {
        log.error('PATCH /page-statuses error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення статусу' });
    }
});

module.exports = router;
