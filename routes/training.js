/**
 * routes/training.js — Staff Trainer API (v20.4.0)
 * Weekly training prompts, materials review, stats
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Training');

// Auto-categorize training input by keywords
function categorizeContent(text) {
    const lower = (text || '').toLowerCase();
    if (/квест|анімат|гр[аиу]|свято|програм/.test(lower)) return 'Аніматори';
    if (/оплат|кас[аиу]|чек|рахун/.test(lower)) return 'Адміністрація';
    if (/безпек|пожеж|евакуац|травм/.test(lower)) return 'Безпека';
    if (/клієнт|батьк|сервіс|обслугов/.test(lower)) return 'Сервіс';
    if (/продаж|дзвін|скрипт|апсейл/.test(lower)) return 'Продажі';
    return 'Загальне';
}

// GET /api/training/weekly-pending — pending responses for a week
router.get('/weekly-pending', requireMinRole('manager'), async (req, res) => {
    try {
        const week = parseInt(req.query.week) || getISOWeek(new Date());
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const result = await pool.query(
            `SELECT i.*, s.name as current_staff_name, s.department
             FROM staff_training_inputs i
             LEFT JOIN staff s ON s.id = i.staff_id
             WHERE i.week_number = $1 AND i.year = $2
             ORDER BY i.status ASC, i.created_at DESC`,
            [week, year]
        );

        res.json({ inputs: result.rows, week, year });
    } catch (err) {
        log.error('weekly-pending error', err);
        res.status(500).json({ error: 'Помилка завантаження' });
    }
});

// POST /api/training/review — batch approve/reject
router.post('/review', requireMinRole('manager'), async (req, res) => {
    const { decisions, reviewed_by_telegram_id } = req.body;
    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
        return res.status(400).json({ error: 'Потрібен масив decisions' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let approved = 0, rejected = 0;

        for (const d of decisions) {
            if (!d.id || !d.action) continue;

            if (d.action === 'approve') {
                // Get the input
                const inputRes = await client.query(
                    'SELECT * FROM staff_training_inputs WHERE id = $1 AND status = $2',
                    [d.id, 'pending']
                );
                if (inputRes.rows.length === 0) continue;
                const input = inputRes.rows[0];

                const category = d.category || categorizeContent(input.content);
                const title = d.title || input.content.substring(0, 100);

                // Create training material
                await client.query(
                    `INSERT INTO training_materials
                     (category, title, content, source_input_id, source_staff_id, source_staff_name, week_number, year, approved_by_telegram_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [category, title, input.content, input.id, input.staff_id, input.staff_name,
                     input.week_number, input.year, reviewed_by_telegram_id || null]
                );

                // Mark input as approved
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1, approved_at = NOW() WHERE id = $2',
                    ['approved', d.id]
                );
                approved++;

            } else if (d.action === 'reject') {
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1, rejected_at = NOW() WHERE id = $2',
                    ['rejected', d.id]
                );
                rejected++;

            } else if (d.action === 'duplicate') {
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1 WHERE id = $2',
                    ['duplicate', d.id]
                );
                rejected++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, approved, rejected });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('review error', err);
        res.status(500).json({ error: 'Помилка обробки рішень' });
    } finally {
        client.release();
    }
});

// POST /api/training/submit — save a training response from staff
router.post('/submit', async (req, res) => {
    const { staff_id, telegram_id, content } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Потрібен текст відповіді' });
    }

    try {
        const now = new Date();
        const week = getISOWeek(now);
        const year = now.getFullYear();

        // Get staff name
        let staffName = 'Невідомий';
        if (staff_id) {
            const staffRes = await pool.query('SELECT name FROM staff WHERE id = $1', [staff_id]);
            if (staffRes.rows.length > 0) staffName = staffRes.rows[0].name;
        }

        const result = await pool.query(
            `INSERT INTO staff_training_inputs (staff_id, staff_name, telegram_id, content, week_number, year)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [staff_id || null, staffName, telegram_id || null, content.trim(), week, year]
        );

        // Mark prompt as responded
        if (staff_id) {
            await pool.query(
                `UPDATE training_prompts_sent SET responded = true, responded_at = NOW()
                 WHERE staff_id = $1 AND week_number = $2 AND year = $3`,
                [staff_id, week, year]
            );
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        log.error('submit error', err);
        res.status(500).json({ error: 'Помилка збереження' });
    }
});

// GET /api/training/materials — list approved training materials
router.get('/materials', async (req, res) => {
    try {
        const { category, page = 1, limit = 20 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const params = [];
        let where = 'WHERE m.is_active = true';

        if (category && category !== 'all') {
            params.push(category);
            where += ` AND m.category = $${params.length}`;
        }

        params.push(parseInt(limit), offset);
        const dataQuery = `SELECT m.* FROM training_materials m ${where}
            ORDER BY m.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

        const countParams = params.slice(0, -2);
        const countQuery = `SELECT COUNT(*) FROM training_materials m ${where}`;

        const [data, count] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery, countParams)
        ]);

        res.json({
            materials: data.rows,
            total: parseInt(count.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        log.error('materials error', err);
        res.status(500).json({ error: 'Помилка завантаження матеріалів' });
    }
});

// POST /api/training/send-weekly-prompt — manually trigger weekly prompt (for testing)
router.post('/send-weekly-prompt', requireMinRole('manager'), async (req, res) => {
    try {
        const { sendWeeklyTrainingPrompts } = require('../services/training');
        const sent = await sendWeeklyTrainingPrompts();
        res.json({ success: true, sent });
    } catch (err) {
        log.error('send-weekly-prompt error', err);
        res.status(500).json({ error: 'Помилка відправки' });
    }
});

// GET /api/training/stats — training statistics
router.get('/stats', async (req, res) => {
    try {
        const [totalMaterials, thisWeek, topContributors, categories] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM training_materials WHERE is_active = true'),
            pool.query(
                `SELECT COUNT(*) FROM staff_training_inputs
                 WHERE year = $1 AND week_number = $2`,
                [new Date().getFullYear(), getISOWeek(new Date())]
            ),
            pool.query(
                `SELECT source_staff_name as name, COUNT(*) as count
                 FROM training_materials WHERE is_active = true AND source_staff_name IS NOT NULL
                 GROUP BY source_staff_name ORDER BY count DESC LIMIT 5`
            ),
            pool.query(
                `SELECT category, COUNT(*) as count
                 FROM training_materials WHERE is_active = true
                 GROUP BY category ORDER BY count DESC`
            )
        ]);

        res.json({
            totalMaterials: parseInt(totalMaterials.rows[0].count),
            thisWeekInputs: parseInt(thisWeek.rows[0].count),
            topContributors: topContributors.rows,
            categories: categories.rows
        });
    } catch (err) {
        log.error('stats error', err);
        res.status(500).json({ error: 'Помилка статистики' });
    }
});

// Helper: ISO week number
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = router;
