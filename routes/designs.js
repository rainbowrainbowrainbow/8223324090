/**
 * routes/designs.js — Design board CRUD + file upload + Telegram send
 * v12.0: Design asset management for the park
 */
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { sendTelegramPhoto, getConfiguredChatId } = require('../services/telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Designs');

// --- Multer setup ---
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'designs');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = crypto.randomBytes(16).toString('hex') + ext;
        cb(null, name);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Непідтримуваний формат файлу'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB per file
});

// --- Helpers ---
function mapDesignRow(row) {
    return {
        id: row.id,
        filename: row.filename,
        originalName: row.original_name,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        width: row.width,
        height: row.height,
        title: row.title,
        description: row.description,
        isPinned: row.is_pinned,
        collectionId: row.collection_id,
        collectionName: row.collection_name || null,
        collectionColor: row.collection_color || null,
        publishDate: row.publish_date,
        createdBy: row.created_by,
        createdAt: row.created_at,
        tags: row.tags ? row.tags.split(',').filter(Boolean) : []
    };
}

// ==========================================
// STATIC ROUTES (must be before /:id)
// ==========================================

// --- GET /api/designs — List with filters ---
router.get('/', async (req, res) => {
    try {
        const { tag, collection, search, pinned, publish_from, publish_to, limit, offset } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (tag) {
            conditions.push(`d.id IN (SELECT design_id FROM design_tags WHERE tag = $${idx++})`);
            params.push(tag);
        }
        if (collection) {
            conditions.push(`d.collection_id = $${idx++}`);
            params.push(parseInt(collection));
        }
        if (search) {
            conditions.push(`(d.title ILIKE $${idx} OR d.original_name ILIKE $${idx} OR d.description ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }
        if (pinned === 'true') {
            conditions.push('d.is_pinned = true');
        }
        if (publish_from) {
            conditions.push(`d.publish_date >= $${idx++}`);
            params.push(publish_from);
        }
        if (publish_to) {
            conditions.push(`d.publish_date <= $${idx++}`);
            params.push(publish_to);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const lim = Math.min(parseInt(limit) || 50, 200);
        const off = parseInt(offset) || 0;

        const countResult = await pool.query(`SELECT COUNT(*) FROM designs d ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT d.*, dc.name AS collection_name, dc.color AS collection_color,
                    (SELECT string_agg(tag, ',') FROM design_tags WHERE design_id = d.id) AS tags
             FROM designs d
             LEFT JOIN design_collections dc ON d.collection_id = dc.id
             ${where}
             ORDER BY d.is_pinned DESC, d.created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, lim, off]
        );

        res.json({
            items: result.rows.map(mapDesignRow),
            total
        });
    } catch (err) {
        log.error('Error listing designs', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- GET /api/designs/tags — All unique tags for autocomplete ---
router.get('/tags', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT tag, COUNT(*) as count FROM design_tags GROUP BY tag ORDER BY count DESC, tag ASC'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Error fetching tags', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- GET /api/designs/calendar — Designs grouped by publish_date ---
router.get('/calendar', async (req, res) => {
    try {
        const { month } = req.query; // format: YYYY-MM
        const conditions = ['d.publish_date IS NOT NULL'];
        const params = [];

        if (month) {
            conditions.push(`d.publish_date LIKE $1`);
            params.push(`${month}%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT d.*, dc.name AS collection_name, dc.color AS collection_color,
                    (SELECT string_agg(tag, ',') FROM design_tags WHERE design_id = d.id) AS tags
             FROM designs d LEFT JOIN design_collections dc ON d.collection_id = dc.id
             ${where}
             ORDER BY d.publish_date ASC, d.created_at ASC`,
            params
        );

        // Group by date
        const grouped = {};
        for (const row of result.rows) {
            const date = row.publish_date;
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(mapDesignRow(row));
        }

        res.json(grouped);
    } catch (err) {
        log.error('Error fetching design calendar', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- COLLECTIONS (static paths before /:id) ---

// GET /api/designs/collections
router.get('/collections', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT *, (SELECT COUNT(*) FROM designs WHERE collection_id = design_collections.id) AS design_count FROM design_collections ORDER BY sort_order ASC, name ASC'
        );
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            color: r.color,
            sortOrder: r.sort_order,
            designCount: parseInt(r.design_count),
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('Error fetching collections', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/designs/collections
router.post('/collections', async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Назва обовʼязкова' });
        }
        const result = await pool.query(
            'INSERT INTO design_collections (name, color) VALUES ($1, $2) RETURNING *',
            [name.trim(), color || '#6366F1']
        );
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error creating collection', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/designs/collections/:id
router.put('/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color, sort_order } = req.body;
        await pool.query(
            'UPDATE design_collections SET name = COALESCE($1, name), color = COALESCE($2, color), sort_order = COALESCE($3, sort_order) WHERE id = $4',
            [name, color, sort_order, id]
        );
        const result = await pool.query('SELECT * FROM design_collections WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Колекцію не знайдено' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error updating collection', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/designs/collections/:id
router.delete('/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE designs SET collection_id = NULL WHERE collection_id = $1', [id]);
        await pool.query('DELETE FROM design_collections WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error deleting collection', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- POST /api/designs/upload — Upload single or batch ---
router.post('/upload', upload.array('files', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Файли не завантажено' });
        }

        const { tags, collection_id, title_prefix } = req.body;
        const parsedTags = tags ? JSON.parse(tags) : [];
        const colId = collection_id ? parseInt(collection_id) : null;

        const created = [];

        for (const file of req.files) {
            let width = null, height = null;

            const result = await pool.query(
                `INSERT INTO designs (filename, original_name, mime_type, file_size, width, height, title, collection_id, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [file.filename, file.originalname, file.mimetype, file.size, width, height,
                 title_prefix ? `${title_prefix} ${created.length + 1}` : file.originalname.replace(/\.[^.]+$/, ''),
                 colId, req.user?.username]
            );

            const design = result.rows[0];

            // Insert tags
            for (const tag of parsedTags) {
                const cleanTag = tag.trim().toLowerCase().replace(/^#/, '');
                if (cleanTag) {
                    await pool.query(
                        'INSERT INTO design_tags (design_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [design.id, cleanTag]
                    );
                }
            }

            // Fetch back with tags
            const full = await pool.query(
                `SELECT d.*, dc.name AS collection_name, dc.color AS collection_color,
                        (SELECT string_agg(tag, ',') FROM design_tags WHERE design_id = d.id) AS tags
                 FROM designs d LEFT JOIN design_collections dc ON d.collection_id = dc.id
                 WHERE d.id = $1`,
                [design.id]
            );
            created.push(mapDesignRow(full.rows[0]));
        }

        res.json({ items: created, count: created.length });
    } catch (err) {
        log.error('Error uploading designs', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// DYNAMIC ROUTES (/:id)
// ==========================================

// --- PUT /api/designs/:id — Update design metadata ---
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, is_pinned, collection_id, publish_date, tags } = req.body;

        const existing = await pool.query('SELECT * FROM designs WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Дизайн не знайдено' });
        }

        await pool.query(
            `UPDATE designs SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                is_pinned = COALESCE($3, is_pinned),
                collection_id = $4,
                publish_date = $5
             WHERE id = $6`,
            [title, description, is_pinned, collection_id || null, publish_date || null, id]
        );

        // Update tags if provided
        if (tags !== undefined) {
            await pool.query('DELETE FROM design_tags WHERE design_id = $1', [id]);
            const tagList = Array.isArray(tags) ? tags : [];
            for (const tag of tagList) {
                const cleanTag = tag.trim().toLowerCase().replace(/^#/, '');
                if (cleanTag) {
                    await pool.query(
                        'INSERT INTO design_tags (design_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [id, cleanTag]
                    );
                }
            }
        }

        // Fetch updated
        const result = await pool.query(
            `SELECT d.*, dc.name AS collection_name, dc.color AS collection_color,
                    (SELECT string_agg(tag, ',') FROM design_tags WHERE design_id = d.id) AS tags
             FROM designs d LEFT JOIN design_collections dc ON d.collection_id = dc.id
             WHERE d.id = $1`,
            [id]
        );

        res.json(mapDesignRow(result.rows[0]));
    } catch (err) {
        log.error('Error updating design', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- DELETE /api/designs/:id ---
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT filename FROM designs WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Дизайн не знайдено' });
        }

        // Delete file from disk
        const filePath = path.join(UPLOADS_DIR, existing.rows[0].filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await pool.query('DELETE FROM designs WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Error deleting design', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- POST /api/designs/:id/telegram — Send design to Telegram ---
router.post('/:id/telegram', async (req, res) => {
    try {
        const { id } = req.params;
        const { caption } = req.body;

        const existing = await pool.query('SELECT * FROM designs WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Дизайн не знайдено' });
        }

        const design = existing.rows[0];
        const filePath = path.join(UPLOADS_DIR, design.filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Файл не знайдено на диску' });
        }

        const chatId = await getConfiguredChatId();
        if (!chatId) {
            return res.status(400).json({ error: 'Telegram чат не налаштовано' });
        }

        const photoBuffer = fs.readFileSync(filePath);
        const finalCaption = caption || design.title || design.original_name;

        await sendTelegramPhoto(chatId, photoBuffer, `🎨 ${finalCaption}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Error sending design to Telegram', err);
        res.status(500).json({ error: 'Помилка відправки в Telegram' });
    }
});

module.exports = router;
