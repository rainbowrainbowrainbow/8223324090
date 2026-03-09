/**
 * routes/scripts.js — Sales scripts API
 * v20.7.0: Quick phrases for managers
 *
 * Endpoints:
 *   GET    /api/scripts           — all active scripts (grouped by category)
 *   POST   /api/scripts           — create script (senior_manager+)
 *   PUT    /api/scripts/:id       — update script
 *   DELETE /api/scripts/:id       — delete script
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');

// GET /api/scripts — all active scripts grouped by category
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sales_scripts WHERE is_active = true ORDER BY category, sort_order'
        );
        // Group by category
        const grouped = {};
        for (const row of result.rows) {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push(row);
        }
        res.json({ success: true, scripts: result.rows, grouped });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Помилка завантаження скриптів' });
    }
});

// POST /api/scripts — create new script
router.post('/', requireMinRole('senior_manager'), async (req, res) => {
    try {
        const { category, trigger_phrase, response_text, sort_order } = req.body;
        if (!category || !response_text) {
            return res.status(400).json({ success: false, error: "Категорія і текст обов'язкові" });
        }
        const result = await pool.query(
            `INSERT INTO sales_scripts (category, trigger_phrase, response_text, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [category, trigger_phrase || null, response_text, sort_order || 0]
        );
        res.json({ success: true, script: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Помилка створення скрипту' });
    }
});

// PUT /api/scripts/:id — update script
router.put('/:id', requireMinRole('senior_manager'), async (req, res) => {
    try {
        const { category, trigger_phrase, response_text, is_active, sort_order } = req.body;
        const result = await pool.query(
            `UPDATE sales_scripts SET
                category = COALESCE($1, category),
                trigger_phrase = COALESCE($2, trigger_phrase),
                response_text = COALESCE($3, response_text),
                is_active = COALESCE($4, is_active),
                sort_order = COALESCE($5, sort_order)
             WHERE id = $6 RETURNING *`,
            [category || null, trigger_phrase || null, response_text || null,
             is_active !== undefined ? is_active : null, sort_order !== undefined ? sort_order : null,
             req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Скрипт не знайдено' });
        }
        res.json({ success: true, script: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// DELETE /api/scripts/:id
router.delete('/:id', requireMinRole('senior_manager'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM sales_scripts WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Скрипт не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

module.exports = router;
