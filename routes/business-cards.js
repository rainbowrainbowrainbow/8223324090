/**
 * routes/business-cards.js — Business Cards CRUD + AI context endpoint (v42.2)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { stripTags, sanitizeArray } = require('../utils/sanitize');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('BusinessCards');

router.use(authenticateToken);

router.param('id', (req, res, next, val) => {
    if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' });
    next();
});

// ==========================================
// BUSINESS CARDS CRUD
// ==========================================

// GET /api/business-cards — list all cards
router.get('/', async (req, res) => {
    try {
        const { category, active } = req.query;
        const params = [];
        const conds = [];
        if (category) { params.push(category); conds.push(`category = $${params.length}`); }
        if (active !== undefined) { params.push(active !== 'false'); conds.push(`is_active = $${params.length}`); }

        let sql = 'SELECT * FROM business_cards';
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY sort_order, title';

        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET / error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/business-cards/categories
router.get('/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM business_card_categories ORDER BY sort_order');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /categories error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/business-cards/social-rules — all platform rules
router.get('/social-rules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM social_platform_rules WHERE is_active = true ORDER BY platform');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /social-rules error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/business-cards/context/:slug — AI context endpoint
// Bundles: general card + topic card + platform rules
router.get('/context/:slug', async (req, res) => {
    try {
        const { platform } = req.query;
        const general = await pool.query("SELECT * FROM business_cards WHERE slug = 'park-general' AND is_active = true LIMIT 1");
        const card = await pool.query('SELECT * FROM business_cards WHERE slug = $1 AND is_active = true LIMIT 1', [req.params.slug]);

        let rules = null;
        if (platform) {
            const r = await pool.query('SELECT * FROM social_platform_rules WHERE platform = $1 AND is_active = true LIMIT 1', [platform]);
            rules = r.rows[0] || null;
        }

        res.json({
            success: true,
            context: {
                business: general.rows[0] || null,
                topic: card.rows[0] || null,
                platform: rules
            }
        });
    } catch (err) {
        log.error('GET /context/:slug error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/business-cards/by-slug/:slug — single card by slug
router.get('/by-slug/:slug', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM business_cards WHERE slug = $1', [req.params.slug]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Картку не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /by-slug/:slug error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/business-cards/:id
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM business_cards WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Картку не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/business-cards — create
router.post('/', requireRole('creator', 'director', 'vice_director', 'art_director'), async (req, res) => {
    try {
        const { slug, title, category, short_description, full_description, target_audience,
                key_features, price_info, price_details, photo_urls, video_urls, instagram_refs,
                hashtags_instagram, hashtags_tiktok, hashtags_facebook,
                tone_of_voice, content_rules, call_to_action, do_not, sort_order } = req.body;

        if (!slug || !title) return res.status(400).json({ success: false, error: 'slug та title обовʼязкові' });

        // Sanitize text inputs
        const s = (v) => v ? stripTags(v) : v;
        const sa = (v) => v ? sanitizeArray(v) : v;

        const result = await pool.query(
            `INSERT INTO business_cards (slug, title, category, short_description, full_description,
             target_audience, key_features, price_info, price_details, photo_urls, video_urls,
             instagram_refs, hashtags_instagram, hashtags_tiktok, hashtags_facebook,
             tone_of_voice, content_rules, call_to_action, do_not, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
            [s(slug), s(title), category || 'service', s(short_description), s(full_description),
             s(target_audience), sa(key_features) || '{}', s(price_info), price_details ? JSON.stringify(price_details) : '{}',
             photo_urls || '{}', video_urls || '{}', instagram_refs || '{}',
             sa(hashtags_instagram) || '{}', sa(hashtags_tiktok) || '{}', sa(hashtags_facebook) || '{}',
             s(tone_of_voice), s(content_rules), s(call_to_action), sa(do_not) || '{}', sort_order || 0]
        );
        log.info(`Business card created: ${slug}`);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Картка з таким slug вже існує' });
        log.error('POST / error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/business-cards/:id — update
router.put('/:id', requireRole('creator', 'director', 'vice_director', 'art_director'), async (req, res) => {
    try {
        const { title, category, short_description, full_description, target_audience,
                key_features, price_info, price_details, photo_urls, video_urls, instagram_refs,
                hashtags_instagram, hashtags_tiktok, hashtags_facebook,
                tone_of_voice, content_rules, call_to_action, do_not, is_active, sort_order } = req.body;

        const result = await pool.query(
            `UPDATE business_cards SET
             title = COALESCE($1, title), category = COALESCE($2, category),
             short_description = COALESCE($3, short_description), full_description = COALESCE($4, full_description),
             target_audience = COALESCE($5, target_audience), key_features = COALESCE($6, key_features),
             price_info = COALESCE($7, price_info), price_details = COALESCE($8, price_details),
             photo_urls = COALESCE($9, photo_urls), video_urls = COALESCE($10, video_urls),
             instagram_refs = COALESCE($11, instagram_refs),
             hashtags_instagram = COALESCE($12, hashtags_instagram),
             hashtags_tiktok = COALESCE($13, hashtags_tiktok),
             hashtags_facebook = COALESCE($14, hashtags_facebook),
             tone_of_voice = COALESCE($15, tone_of_voice), content_rules = COALESCE($16, content_rules),
             call_to_action = COALESCE($17, call_to_action), do_not = COALESCE($18, do_not),
             is_active = COALESCE($19, is_active), sort_order = COALESCE($20, sort_order),
             updated_at = NOW()
             WHERE id = $21 RETURNING *`,
            [title, category, short_description, full_description, target_audience,
             key_features, price_info, price_details ? JSON.stringify(price_details) : null,
             photo_urls, video_urls, instagram_refs,
             hashtags_instagram, hashtags_tiktok, hashtags_facebook,
             tone_of_voice, content_rules, call_to_action, do_not,
             is_active, sort_order, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Картку не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/business-cards/:id
router.delete('/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM business_cards WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Картку не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/business-cards/social-rules/:platform — update platform rules
router.put('/social-rules/:platform', requireRole('creator', 'director', 'art_director'), async (req, res) => {
    try {
        const { max_text_length, media_required, hashtag_limit, tone, formatting_rules,
                image_ratio, video_max_seconds, default_hashtags, hashtag_placement } = req.body;
        const result = await pool.query(
            `UPDATE social_platform_rules SET
             max_text_length = COALESCE($1, max_text_length), media_required = COALESCE($2, media_required),
             hashtag_limit = COALESCE($3, hashtag_limit), tone = COALESCE($4, tone),
             formatting_rules = COALESCE($5, formatting_rules), image_ratio = COALESCE($6, image_ratio),
             video_max_seconds = COALESCE($7, video_max_seconds), default_hashtags = COALESCE($8, default_hashtags),
             hashtag_placement = COALESCE($9, hashtag_placement), updated_at = NOW()
             WHERE platform = $10 RETURNING *`,
            [max_text_length, media_required, hashtag_limit, tone, formatting_rules,
             image_ratio, video_max_seconds, default_hashtags, hashtag_placement, req.params.platform]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Платформу не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /social-rules/:platform error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

module.exports = router;
