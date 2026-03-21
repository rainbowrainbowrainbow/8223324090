/**
 * routes/reports.js — Reports module API (v32.7)
 *
 * CRUD for financial reports, summary/analytics, accountant management.
 * Hashtag-based grouping and filtering. Accepts data from Telegram bot, web UI, or manual entry.
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { requireRole } = require('../middleware/auth');

const log = createLogger('Reports');

// RBAC: Reports access
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'accountant'));

// ==========================================
// HELPERS
// ==========================================

function parseHashtags(val) {
    if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean);
    if (!val) return [];
    try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        return Array.isArray(parsed) ? parsed.map(String).map(s => s.trim()).filter(Boolean) : [];
    } catch { return []; }
}

function sanitizeHashtags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(
        tags.map(t => String(t).trim().slice(0, 50)).filter(Boolean)
    )];
}

function mapReportRow(r) {
    return {
        id: r.id,
        type: r.type,
        amount: parseFloat(r.amount) || 0,
        description: r.description,
        category: r.category,
        submittedBy: r.submitted_by,
        submittedById: r.submitted_by_id,
        submittedVia: r.submitted_via,
        photoUrl: r.photo_url,
        ocrText: r.ocr_text,
        voiceTranscript: r.voice_transcript,
        rawData: r.raw_data,
        status: r.status,
        assignedTo: r.assigned_to,
        assignedAt: r.assigned_at,
        processedAt: r.processed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        hashtags: parseHashtags(r.hashtags),
        hashtagActive: r.hashtag_active !== false && r.hashtag_active !== 0,
        // joined fields
        accountantName: r.accountant_name || null
    };
}

function mapAccountantRow(r) {
    return {
        id: r.id,
        name: r.name,
        chatId: r.chat_id,
        schedule: r.schedule,
        isOnDuty: r.is_on_duty,
        phone: r.phone,
        staffId: r.staff_id,
        createdAt: r.created_at
    };
}

// ==========================================
// GET /api/reports — list with filters
// ==========================================
router.get('/', async (req, res) => {
    try {
        const { type, status, submittedBy, category, hashtag, dateFrom, dateTo, limit = 100, offset = 0 } = req.query;

        function buildWhere(params) {
            let where = '';
            if (type && ['income', 'expense'].includes(type)) {
                params.push(type);
                where += ` AND r.type = $${params.length}`;
            }
            if (status) {
                params.push(status);
                where += ` AND r.status = $${params.length}`;
            }
            if (submittedBy) {
                params.push(`%${submittedBy}%`);
                where += ` AND r.submitted_by ILIKE $${params.length}`;
            }
            if (category) {
                params.push(category);
                where += ` AND r.category = $${params.length}`;
            }
            if (hashtag) {
                params.push(JSON.stringify([hashtag]));
                where += ` AND r.hashtags @> $${params.length}::jsonb`;
            }
            if (dateFrom) {
                params.push(dateFrom);
                where += ` AND r.created_at >= $${params.length}::date`;
            }
            if (dateTo) {
                params.push(dateTo);
                where += ` AND r.created_at < ($${params.length}::date + interval '1 day')`;
            }
            return where;
        }

        const params = [];
        let sql = `
            SELECT r.*, a.name AS accountant_name
            FROM reports r
            LEFT JOIN accountants a ON a.id = r.assigned_to
            WHERE 1=1
        `;
        sql += buildWhere(params);
        sql += ` ORDER BY r.created_at DESC`;
        params.push(parseInt(limit));
        sql += ` LIMIT $${params.length}`;
        params.push(parseInt(offset));
        sql += ` OFFSET $${params.length}`;

        const result = await pool.query(sql, params);

        const countParams = [];
        let countSql = `SELECT COUNT(*) FROM reports r WHERE 1=1`;
        countSql += buildWhere(countParams);
        const countResult = await pool.query(countSql, countParams);

        res.json({
            reports: result.rows.map(mapReportRow),
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        log.error('GET /reports error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/summary — aggregated data for dashboard/charts
// ==========================================
router.get('/summary', async (req, res) => {
    try {
        const { period = 'month', dateFrom, dateTo } = req.query;
        let fromDate, toDate;

        if (dateFrom && dateTo) {
            fromDate = dateFrom;
            toDate = dateTo;
        } else {
            const now = new Date();
            if (period === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                fromDate = weekAgo.toISOString().slice(0, 10);
            } else if (period === 'year') {
                fromDate = `${now.getFullYear()}-01-01`;
            } else {
                fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            }
            toDate = now.toISOString().slice(0, 10);
        }

        // Totals (only hashtag_active reports)
        const totalsResult = await pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
              AND hashtag_active IS NOT FALSE
            GROUP BY type
        `, [fromDate, toDate]);

        const income = totalsResult.rows.find(r => r.type === 'income');
        const expense = totalsResult.rows.find(r => r.type === 'expense');

        // By day (for line chart)
        const dailyResult = await pool.query(`
            SELECT
                created_at::date AS day,
                type,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
            GROUP BY day, type
            ORDER BY day
        `, [fromDate, toDate]);

        // By category (for pie chart)
        const categoryResult = await pool.query(`
            SELECT
                COALESCE(category, 'Інше') AS category,
                type,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
            GROUP BY category, type
            ORDER BY total DESC
        `, [fromDate, toDate]);

        // Status counts
        const statusResult = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
            GROUP BY status
        `, [fromDate, toDate]);

        // Today's stats
        const today = new Date().toISOString().slice(0, 10);
        const todayResult = await pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at::date = $1::date
            GROUP BY type
        `, [today]);

        const todayIncome = todayResult.rows.find(r => r.type === 'income');
        const todayExpense = todayResult.rows.find(r => r.type === 'expense');

        res.json({
            period: { from: fromDate, to: toDate },
            totals: {
                income: parseFloat(income?.total || 0),
                incomeCount: parseInt(income?.count || 0),
                expense: parseFloat(expense?.total || 0),
                expenseCount: parseInt(expense?.count || 0),
                profit: parseFloat((income?.total || 0) - (expense?.total || 0))
            },
            today: {
                income: parseFloat(todayIncome?.total || 0),
                expense: parseFloat(todayExpense?.total || 0),
                newReports: parseInt((todayIncome?.count || 0)) + parseInt((todayExpense?.count || 0))
            },
            daily: dailyResult.rows.map(r => ({
                day: r.day,
                type: r.type,
                total: parseFloat(r.total)
            })),
            categories: categoryResult.rows.map(r => ({
                category: r.category,
                type: r.type,
                total: parseFloat(r.total)
            })),
            statuses: statusResult.rows.reduce((acc, r) => {
                acc[r.status] = parseInt(r.count);
                return acc;
            }, {})
        });
    } catch (err) {
        log.error('GET /reports/summary error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/accountants — list accountants
// ==========================================
router.get('/accountants', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM accountants ORDER BY is_on_duty DESC, name');
        res.json(result.rows.map(mapAccountantRow));
    } catch (err) {
        log.error('GET /accountants error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/hashtags — hashtag stats
// ==========================================
router.get('/hashtags', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT hashtags, amount, hashtag_active, type FROM reports WHERE status IN ('done', 'new', 'processing')"
        );

        const stats = {};
        for (const row of result.rows) {
            const tags = parseHashtags(row.hashtags);
            for (const tag of tags) {
                if (!stats[tag]) stats[tag] = { hashtag: tag, total: 0, count: 0, activeCount: 0, inactiveCount: 0 };
                const isActive = row.hashtag_active !== false && row.hashtag_active !== 0;
                stats[tag].count += 1;
                if (isActive) {
                    stats[tag].total += parseFloat(row.amount) || 0;
                    stats[tag].activeCount += 1;
                } else {
                    stats[tag].inactiveCount += 1;
                }
            }
        }

        res.json(Object.values(stats).sort((a, b) => b.total - a.total));
    } catch (err) {
        log.error('GET /reports/hashtags error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PATCH /api/reports/hashtags/toggle — bulk toggle hashtagActive for all reports with a given hashtag
// ==========================================
router.patch('/hashtags/toggle', async (req, res) => {
    try {
        const { hashtag, active } = req.body;
        if (!hashtag || typeof hashtag !== 'string') {
            return res.status(400).json({ error: 'hashtag (string) required' });
        }
        const isActive = active !== false && active !== 0;
        const result = await pool.query(
            `UPDATE reports SET hashtag_active = $1, updated_at = NOW()
             WHERE hashtags @> $2::jsonb
             RETURNING id`,
            [isActive, JSON.stringify([hashtag])]
        );
        log.info(`Hashtag toggle: #${hashtag} → ${isActive ? 'ON' : 'OFF'} (${result.rowCount} reports)`);
        res.json({ updated: result.rowCount, active: isActive });
    } catch (err) {
        log.error('PATCH /reports/hashtags/toggle error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/reports/:id — single report
// ==========================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT r.*, a.name AS accountant_name
            FROM reports r
            LEFT JOIN accountants a ON a.id = r.assigned_to
            WHERE r.id = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json(mapReportRow(result.rows[0]));
    } catch (err) {
        log.error('GET /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// POST /api/reports — create report
// ==========================================
router.post('/', async (req, res) => {
    try {
        const {
            type, amount, description, category, hashtags,
            submittedBy, submittedById, submittedVia = 'web',
            photoUrl, ocrText, voiceTranscript, rawData
        } = req.body;

        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type (income/expense)' });
        }

        const result = await pool.query(`
            INSERT INTO reports (type, amount, description, category, submitted_by, submitted_by_id,
                submitted_via, photo_url, ocr_text, voice_transcript, raw_data, hashtags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            type,
            parseFloat(amount) || 0,
            description || null,
            category || null,
            submittedBy || req.user?.displayName || 'Unknown',
            submittedById || req.user?.id || null,
            submittedVia,
            photoUrl || null,
            ocrText || null,
            voiceTranscript || null,
            rawData ? JSON.stringify(rawData) : '{}',
            JSON.stringify(sanitizeHashtags(hashtags || []))
        ]);

        const report = mapReportRow(result.rows[0]);

        // Auto-assign to on-duty accountant
        const dutyAccountant = await pool.query(
            'SELECT id, name, chat_id FROM accountants WHERE is_on_duty = true LIMIT 1'
        );
        if (dutyAccountant.rows.length > 0) {
            await pool.query(
                'UPDATE reports SET assigned_to = $1, assigned_at = NOW() WHERE id = $2',
                [dutyAccountant.rows[0].id, report.id]
            );
            report.assignedTo = dutyAccountant.rows[0].id;
            report.accountantName = dutyAccountant.rows[0].name;
        }

        log.info(`Report #${report.id} created: ${type} ${amount} by ${report.submittedBy}`);
        res.status(201).json(report);
    } catch (err) {
        log.error('POST /reports error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PUT /api/reports/:id — update report
// ==========================================
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            type, amount, description, category,
            status, photoUrl, ocrText,
            hashtags, hashtagActive
        } = req.body;

        const existing = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const updates = [];
        const params = [];

        if (type) { params.push(type); updates.push(`type = $${params.length}`); }
        if (amount !== undefined) { params.push(parseFloat(amount)); updates.push(`amount = $${params.length}`); }
        if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
        if (category !== undefined) { params.push(category); updates.push(`category = $${params.length}`); }
        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
            if (status === 'done') updates.push(`processed_at = NOW()`);
        }
        if (photoUrl !== undefined) { params.push(photoUrl); updates.push(`photo_url = $${params.length}`); }
        if (ocrText !== undefined) { params.push(ocrText); updates.push(`ocr_text = $${params.length}`); }
        if (hashtags !== undefined) { params.push(JSON.stringify(sanitizeHashtags(hashtags))); updates.push(`hashtags = $${params.length}`); }
        if (hashtagActive !== undefined) { params.push(!!hashtagActive); updates.push(`hashtag_active = $${params.length}`); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        params.push(id);

        const result = await pool.query(`
            UPDATE reports SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *
        `, params);

        res.json(mapReportRow(result.rows[0]));
    } catch (err) {
        log.error('PUT /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// DELETE /api/reports/:id
// ==========================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM reports WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json({ success: true, id: parseInt(id) });
    } catch (err) {
        log.error('DELETE /reports/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// POST /api/reports/:id/assign — assign to accountant
// ==========================================
router.post('/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { accountantId } = req.body;

        if (!accountantId) {
            return res.status(400).json({ error: 'accountantId required' });
        }

        const result = await pool.query(`
            UPDATE reports SET assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
            WHERE id = $2 RETURNING *
        `, [accountantId, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        res.json(mapReportRow(result.rows[0]));
    } catch (err) {
        log.error('POST /reports/:id/assign error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// PUT /api/reports/accountants/:id — update accountant
// ==========================================
router.put('/accountants/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, schedule, isOnDuty, phone } = req.body;

        const updates = [];
        const params = [];

        if (name) { params.push(name); updates.push(`name = $${params.length}`); }
        if (schedule !== undefined) { params.push(JSON.stringify(schedule)); updates.push(`schedule = $${params.length}`); }
        if (isOnDuty !== undefined) { params.push(isOnDuty); updates.push(`is_on_duty = $${params.length}`); }
        if (phone !== undefined) { params.push(phone); updates.push(`phone = $${params.length}`); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = NOW()');
        params.push(id);

        const result = await pool.query(`
            UPDATE accountants SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *
        `, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Accountant not found' });
        }

        res.json(mapAccountantRow(result.rows[0]));
    } catch (err) {
        log.error('PUT /accountants/:id error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
