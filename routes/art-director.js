/**
 * routes/art-director.js — Art Director v1: brand memory, content pipeline, approval workflow
 * v18.2.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('ArtDirector');

// ==========================================
// BRAND GUIDELINES
// ==========================================

// GET /api/art-director/brand — All brand guidelines
router.get('/brand', async (req, res) => {
    try {
        const { category } = req.query;
        let query = 'SELECT * FROM brand_guidelines WHERE is_active = true';
        const params = [];
        if (category) {
            query += ' AND category = $1';
            params.push(category);
        }
        query += ' ORDER BY category, sort_order, id';
        const result = await pool.query(query, params);

        // Group by category
        const grouped = {};
        for (const row of result.rows) {
            if (!grouped[row.category]) grouped[row.category] = [];
            grouped[row.category].push(row);
        }

        res.json({ success: true, guidelines: result.rows, grouped });
    } catch (err) {
        log.error('GET /brand error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження бренд-гайдлайнів' });
    }
});

// POST /api/art-director/brand — Create guideline
router.post('/brand', requireRole('admin'), async (req, res) => {
    try {
        const { category, title, value, description, sort_order } = req.body;
        if (!category || !title || !value) {
            return res.status(400).json({ success: false, error: 'category, title та value обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO brand_guidelines (category, title, value, description, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [category, title.trim(), value.trim(), description || null, sort_order || 0, req.user?.username]
        );
        res.json({ success: true, guideline: result.rows[0] });
    } catch (err) {
        log.error('POST /brand error', err);
        res.status(500).json({ success: false, error: 'Помилка створення' });
    }
});

// PUT /api/art-director/brand/:id — Update guideline
router.put('/brand/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { category, title, value, description, sort_order, is_active } = req.body;
        const result = await pool.query(
            `UPDATE brand_guidelines SET
                category = COALESCE($1, category),
                title = COALESCE($2, title),
                value = COALESCE($3, value),
                description = COALESCE($4, description),
                sort_order = COALESCE($5, sort_order),
                is_active = COALESCE($6, is_active),
                updated_at = NOW()
             WHERE id = $7 RETURNING *`,
            [category, title, value, description, sort_order, is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        res.json({ success: true, guideline: result.rows[0] });
    } catch (err) {
        log.error('PUT /brand/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// DELETE /api/art-director/brand/:id
router.delete('/brand/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM brand_guidelines WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /brand/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ==========================================
// CONTENT TEMPLATES
// ==========================================

// GET /api/art-director/templates — All templates
router.get('/templates', async (req, res) => {
    try {
        const { category } = req.query;
        let query = 'SELECT * FROM content_templates WHERE is_active = true';
        const params = [];
        if (category) {
            query += ' AND category = $1';
            params.push(category);
        }
        query += ' ORDER BY category, name';
        const result = await pool.query(query, params);
        res.json({ success: true, templates: result.rows });
    } catch (err) {
        log.error('GET /templates error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження шаблонів' });
    }
});

// POST /api/art-director/templates — Create template
router.post('/templates', requireRole('admin'), async (req, res) => {
    try {
        const { code, name, category, description, format, width, height, fields } = req.body;
        if (!code || !name || !category) {
            return res.status(400).json({ success: false, error: 'code, name та category обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO content_templates (code, name, category, description, format, width, height, fields, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [code.trim(), name.trim(), category, description || null, format || 'png',
             width || null, height || null, JSON.stringify(fields || []), req.user?.username]
        );
        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ success: false, error: 'Шаблон з таким кодом вже існує' });
        }
        log.error('POST /templates error', err);
        res.status(500).json({ success: false, error: 'Помилка створення шаблону' });
    }
});

// PUT /api/art-director/templates/:id — Update template
router.put('/templates/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, description, format, width, height, fields, is_active } = req.body;
        const result = await pool.query(
            `UPDATE content_templates SET
                name = COALESCE($1, name),
                category = COALESCE($2, category),
                description = COALESCE($3, description),
                format = COALESCE($4, format),
                width = COALESCE($5, width),
                height = COALESCE($6, height),
                fields = COALESCE($7, fields),
                is_active = COALESCE($8, is_active),
                updated_at = NOW()
             WHERE id = $9 RETURNING *`,
            [name, category, description, format, width, height,
             fields ? JSON.stringify(fields) : null, is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
        }
        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        log.error('PUT /templates/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// DELETE /api/art-director/templates/:id
router.delete('/templates/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('UPDATE content_templates SET is_active = false WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /templates/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ==========================================
// CONTENT PIPELINE
// ==========================================

// GET /api/art-director/content — List content items (with filters)
router.get('/content', async (req, res) => {
    try {
        const { status, category, assigned_to, priority, search, limit, offset } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) {
            conditions.push(`c.status = $${idx++}`);
            params.push(status);
        }
        if (category) {
            conditions.push(`c.category = $${idx++}`);
            params.push(category);
        }
        if (assigned_to) {
            conditions.push(`c.assigned_to = $${idx++}`);
            params.push(assigned_to);
        }
        if (priority) {
            conditions.push(`c.priority = $${idx++}`);
            params.push(priority);
        }
        if (search) {
            conditions.push(`(c.title ILIKE $${idx} OR c.notes ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 50, 200);
        const off = parseInt(offset) || 0;

        const countResult = await pool.query(`SELECT COUNT(*) FROM content_items c ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT c.*, ct.name AS template_name, ct.format AS template_format
             FROM content_items c
             LEFT JOIN content_templates ct ON c.template_id = ct.id
             ${where}
             ORDER BY
                CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                c.updated_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, lim, off]
        );

        res.json({ success: true, items: result.rows, total });
    } catch (err) {
        log.error('GET /content error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження контенту' });
    }
});

// GET /api/art-director/content/stats — Pipeline stats
router.get('/content/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT status, COUNT(*) AS count FROM content_items GROUP BY status
        `);
        const stats = { draft: 0, in_review: 0, approved: 0, rejected: 0, published: 0, archived: 0 };
        for (const row of result.rows) {
            stats[row.status] = parseInt(row.count);
        }
        stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
        res.json({ success: true, stats });
    } catch (err) {
        log.error('GET /content/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка статистики' });
    }
});

// POST /api/art-director/content — Create content item
router.post('/content', async (req, res) => {
    try {
        const { title, template_id, category, priority, field_values, notes, due_date, assigned_to } = req.body;
        if (!title || !category) {
            return res.status(400).json({ success: false, error: 'title та category обовʼязкові' });
        }

        // Get template code if template_id provided
        let templateCode = null;
        if (template_id) {
            const tpl = await pool.query('SELECT code FROM content_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length > 0) {
                templateCode = tpl.rows[0].code;
                await pool.query('UPDATE content_templates SET use_count = use_count + 1 WHERE id = $1', [template_id]);
            }
        }

        const result = await pool.query(
            `INSERT INTO content_items (title, template_id, template_code, category, priority, field_values, notes, due_date, assigned_to, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [title.trim(), template_id || null, templateCode, category, priority || 'normal',
             JSON.stringify(field_values || {}), notes || null, due_date || null,
             assigned_to || null, req.user?.username]
        );

        // Log creation
        await pool.query(
            `INSERT INTO content_approvals (content_id, from_status, to_status, comment, user_name)
             VALUES ($1, NULL, 'draft', 'Створено', $2)`,
            [result.rows[0].id, req.user?.username || 'system']
        );

        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        log.error('POST /content error', err);
        res.status(500).json({ success: false, error: 'Помилка створення контенту' });
    }
});

// PUT /api/art-director/content/:id — Update content item
router.put('/content/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, priority, field_values, notes, due_date, assigned_to, design_id } = req.body;

        const result = await pool.query(
            `UPDATE content_items SET
                title = COALESCE($1, title),
                priority = COALESCE($2, priority),
                field_values = COALESCE($3, field_values),
                notes = COALESCE($4, notes),
                due_date = COALESCE($5, due_date),
                assigned_to = COALESCE($6, assigned_to),
                design_id = COALESCE($7, design_id),
                updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [title, priority, field_values ? JSON.stringify(field_values) : null,
             notes, due_date, assigned_to, design_id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Контент не знайдено' });
        }
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        log.error('PUT /content/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// POST /api/art-director/content/:id/status — Change status (approval workflow)
router.post('/content/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { status, comment } = req.body;

        const validStatuses = ['draft', 'in_review', 'approved', 'rejected', 'published', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: `Невалідний статус. Допустимі: ${validStatuses.join(', ')}` });
        }

        await client.query('BEGIN');

        const existing = await client.query('SELECT * FROM content_items WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Контент не знайдено' });
        }

        const fromStatus = existing.rows[0].status;
        const username = req.user?.username || 'system';

        // Transition validation
        const validTransitions = {
            draft: ['in_review', 'archived'],
            in_review: ['approved', 'rejected', 'draft'],
            approved: ['published', 'draft'],
            rejected: ['draft'],
            published: ['archived'],
            archived: ['draft']
        };

        if (!validTransitions[fromStatus]?.includes(status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `Перехід ${fromStatus} → ${status} неможливий`
            });
        }

        const updateFields = ['status = $1', 'updated_at = NOW()'];
        const updateParams = [status];
        let paramIdx = 2;

        if (status === 'approved' || status === 'rejected') {
            updateFields.push(`reviewed_by = $${paramIdx++}`);
            updateParams.push(username);
            updateFields.push(`reviewed_at = NOW()`);
            if (comment) {
                updateFields.push(`review_comment = $${paramIdx++}`);
                updateParams.push(comment);
            }
        }
        if (status === 'published') {
            updateFields.push(`publish_date = $${paramIdx++}`);
            updateParams.push(new Date().toISOString().slice(0, 10));
        }

        updateParams.push(id);
        const result = await client.query(
            `UPDATE content_items SET ${updateFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            updateParams
        );

        // Log approval
        await client.query(
            `INSERT INTO content_approvals (content_id, from_status, to_status, comment, user_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, fromStatus, status, comment || null, username]
        );

        await client.query('COMMIT');
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /content/:id/status error', err);
        res.status(500).json({ success: false, error: 'Помилка зміни статусу' });
    } finally {
        client.release();
    }
});

// GET /api/art-director/content/:id/history — Approval history
router.get('/content/:id/history', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM content_approvals WHERE content_id = $1 ORDER BY created_at DESC`,
            [req.params.id]
        );
        res.json({ success: true, history: result.rows });
    } catch (err) {
        log.error('GET /content/:id/history error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження історії' });
    }
});

// DELETE /api/art-director/content/:id
router.delete('/content/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM content_items WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /content/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ==========================================
// OVERVIEW — Dashboard summary
// ==========================================
router.get('/overview', async (req, res) => {
    try {
        // Pipeline stats
        const statsResult = await pool.query(`
            SELECT status, COUNT(*) AS count FROM content_items GROUP BY status
        `);
        const pipeline = { draft: 0, in_review: 0, approved: 0, rejected: 0, published: 0, archived: 0 };
        for (const row of statsResult.rows) {
            pipeline[row.status] = parseInt(row.count);
        }

        // Templates count
        const tplResult = await pool.query('SELECT COUNT(*) FROM content_templates WHERE is_active = true');
        const templateCount = parseInt(tplResult.rows[0].count);

        // Brand guidelines count
        const brandResult = await pool.query('SELECT COUNT(*) FROM brand_guidelines WHERE is_active = true');
        const brandCount = parseInt(brandResult.rows[0].count);

        // Recent items (last 5)
        const recentResult = await pool.query(`
            SELECT c.*, ct.name AS template_name
            FROM content_items c
            LEFT JOIN content_templates ct ON c.template_id = ct.id
            ORDER BY c.updated_at DESC LIMIT 5
        `);

        // Urgent/overdue
        const today = new Date().toISOString().slice(0, 10);
        const urgentResult = await pool.query(
            `SELECT COUNT(*) FROM content_items
             WHERE status NOT IN ('published', 'archived')
               AND (priority = 'urgent' OR (due_date IS NOT NULL AND due_date < $1))`,
            [today]
        );

        res.json({
            success: true,
            pipeline,
            templateCount,
            brandCount,
            recentItems: recentResult.rows,
            urgentCount: parseInt(urgentResult.rows[0].count)
        });
    } catch (err) {
        log.error('GET /overview error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження' });
    }
});

module.exports = router;
