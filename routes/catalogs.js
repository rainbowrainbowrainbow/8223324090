/**
 * routes/catalogs.js — Catalog CRUD + pages + image generation
 * v28.1.0: Product catalog system
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Catalogs');

// --- List catalogs ---
router.get('/', requireRole('admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM catalog_pages WHERE catalog_id = c.id) AS page_count
             FROM catalogs c
             ORDER BY c.sort_order, c.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        log.error('List catalogs:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Get catalog with pages ---
router.get('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { rows: [catalog] } = await pool.query(
            'SELECT * FROM catalogs WHERE id = $1', [req.params.id]
        );
        if (!catalog) return res.status(404).json({ error: 'Каталог не знайдено' });

        const { rows: pages } = await pool.query(
            'SELECT * FROM catalog_pages WHERE catalog_id = $1 ORDER BY page_number',
            [req.params.id]
        );

        res.json({ ...catalog, pages });
    } catch (err) {
        log.error('Get catalog:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Create catalog ---
router.post('/', requireRole('admin'), async (req, res) => {
    const { title, description, category, cover_url, background_url } = req.body;
    if (!title) return res.status(400).json({ error: 'Назва обовʼязкова' });

    try {
        const slug = title.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '');
        const { rows: [catalog] } = await pool.query(
            `INSERT INTO catalogs (title, slug, description, category, cover_url, background_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [title, slug, description || null, category || 'general', cover_url || null, background_url || null, req.user.id]
        );
        res.status(201).json(catalog);
    } catch (err) {
        log.error('Create catalog:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Update catalog ---
router.put('/:id', requireRole('admin'), async (req, res) => {
    const { title, description, category, cover_url, background_url, status, sort_order } = req.body;
    try {
        const sets = [];
        const vals = [];
        let n = 1;

        if (title !== undefined) { sets.push(`title = $${n++}`); vals.push(title); }
        if (description !== undefined) { sets.push(`description = $${n++}`); vals.push(description); }
        if (category !== undefined) { sets.push(`category = $${n++}`); vals.push(category); }
        if (cover_url !== undefined) { sets.push(`cover_url = $${n++}`); vals.push(cover_url); }
        if (background_url !== undefined) { sets.push(`background_url = $${n++}`); vals.push(background_url); }
        if (status !== undefined) { sets.push(`status = $${n++}`); vals.push(status); }
        if (sort_order !== undefined) { sets.push(`sort_order = $${n++}`); vals.push(sort_order); }
        sets.push(`updated_at = NOW()`);

        if (sets.length === 1) return res.json({ ok: true });

        vals.push(req.params.id);
        const { rows: [catalog] } = await pool.query(
            `UPDATE catalogs SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
            vals
        );

        if (!catalog) return res.status(404).json({ error: 'Каталог не знайдено' });
        res.json(catalog);
    } catch (err) {
        log.error('Update catalog:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Delete catalog ---
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM catalogs WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        log.error('Delete catalog:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Add page to catalog ---
router.post('/:id/pages', requireRole('admin'), async (req, res) => {
    const { title, subtitle, description, price_label, detail, image_url, background_url, product_id, layout } = req.body;

    try {
        // Get next page number
        const { rows: [{ max }] } = await pool.query(
            'SELECT COALESCE(MAX(page_number), 0) AS max FROM catalog_pages WHERE catalog_id = $1',
            [req.params.id]
        );
        const pageNumber = max + 1;

        const { rows: [page] } = await pool.query(
            `INSERT INTO catalog_pages (catalog_id, page_number, title, subtitle, description, price_label, detail, image_url, background_url, product_id, layout)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [req.params.id, pageNumber, title || null, subtitle || null, description || null,
             price_label || null, detail || null, image_url || null, background_url || null,
             product_id || null, layout || 'image-left']
        );
        res.status(201).json(page);
    } catch (err) {
        log.error('Add page:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Update page ---
router.put('/:id/pages/:pageNumber', requireRole('admin'), async (req, res) => {
    const { title, subtitle, description, price_label, detail, image_url, imageUrl, background_url, backgroundUrl, product_id, layout } = req.body;

    try {
        const sets = [];
        const vals = [];
        let n = 1;

        if (title !== undefined) { sets.push(`title = $${n++}`); vals.push(title); }
        if (subtitle !== undefined) { sets.push(`subtitle = $${n++}`); vals.push(subtitle); }
        if (description !== undefined) { sets.push(`description = $${n++}`); vals.push(description); }
        if (price_label !== undefined) { sets.push(`price_label = $${n++}`); vals.push(price_label); }
        if (detail !== undefined) { sets.push(`detail = $${n++}`); vals.push(detail); }
        // Support both snake_case and camelCase
        const imgUrl = image_url !== undefined ? image_url : imageUrl;
        if (imgUrl !== undefined) { sets.push(`image_url = $${n++}`); vals.push(imgUrl); }
        const bgUrl = background_url !== undefined ? background_url : backgroundUrl;
        if (bgUrl !== undefined) { sets.push(`background_url = $${n++}`); vals.push(bgUrl); }
        if (product_id !== undefined) { sets.push(`product_id = $${n++}`); vals.push(product_id); }
        if (layout !== undefined) { sets.push(`layout = $${n++}`); vals.push(layout); }
        sets.push(`updated_at = NOW()`);

        if (sets.length === 1) return res.json({ ok: true });

        vals.push(req.params.id);
        vals.push(req.params.pageNumber);
        const { rows: [page] } = await pool.query(
            `UPDATE catalog_pages SET ${sets.join(', ')} WHERE catalog_id = $${n} AND page_number = $${n + 1} RETURNING *`,
            vals
        );

        if (!page) return res.status(404).json({ error: 'Сторінку не знайдено' });
        res.json(page);
    } catch (err) {
        log.error('Update page:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Delete page ---
router.delete('/:id/pages/:pageNumber', requireRole('admin'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM catalog_pages WHERE catalog_id = $1 AND page_number = $2',
            [req.params.id, req.params.pageNumber]
        );
        // Reorder remaining pages
        await pool.query(
            `WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY page_number) AS new_num
                FROM catalog_pages WHERE catalog_id = $1
            )
            UPDATE catalog_pages SET page_number = ordered.new_num
            FROM ordered WHERE catalog_pages.id = ordered.id`,
            [req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        log.error('Delete page:', err);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// --- Generate image (proxy to AI) ---
router.post('/generate-image', requireRole('admin'), async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt обовʼязковий' });

    try {
        // Placeholder — returns a generated placeholder URL
        // In production, integrate with DALL-E, Stability AI, etc.
        const placeholderUrl = `https://placehold.co/800x600/1a1a1a/C9A84C?text=${encodeURIComponent(prompt.slice(0, 30))}`;
        res.json({ url: placeholderUrl, prompt });
    } catch (err) {
        log.error('Generate image:', err);
        res.status(500).json({ error: 'Помилка генерації' });
    }
});

module.exports = router;
