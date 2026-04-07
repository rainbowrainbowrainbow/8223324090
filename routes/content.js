/**
 * routes/content.js — Content Matrix: posts CRUD, approval, social accounts (v42.0)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { stripTags, sanitizeArray } = require('../utils/sanitize');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Content');

router.use(authenticateToken);

router.param('id', (req, res, next, val) => {
    if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' });
    next();
});

const PLATFORMS = ['instagram', 'telegram', 'tiktok', 'facebook', 'threads', 'viber'];
const STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'published', 'failed'];
const TOPICS = ['animation', 'quest', 'birthday', 'show', 'masterclass', 'general', 'promo', 'event', 'review'];

// ==========================================
// POSTS CRUD
// ==========================================

// GET /api/content/posts — list posts (filter by week/year/platform/status)
router.get('/posts', async (req, res) => {
    try {
        const { week, year, platform, status, limit = 100, offset = 0 } = req.query;
        const params = [];
        const conds = [];

        if (week) { params.push(parseInt(week)); conds.push(`week_number = $${params.length}`); }
        if (year) { params.push(parseInt(year)); conds.push(`year = $${params.length}`); }
        if (platform) { params.push(platform); conds.push(`$${params.length} = ANY(platforms)`); }
        if (status) { params.push(status); conds.push(`status = $${params.length}`); }

        let sql = `SELECT cp.*, u.name AS creator_name, ua.name AS approver_name
                   FROM content_posts cp
                   LEFT JOIN users u ON u.id = cp.created_by
                   LEFT JOIN users ua ON ua.id = cp.approved_by`;
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY COALESCE(cp.scheduled_at, cp.created_at) ASC';
        params.push(parseInt(limit)); sql += ` LIMIT $${params.length}`;
        params.push(parseInt(offset)); sql += ` OFFSET $${params.length}`;

        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /posts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/content/posts/:id
router.get('/posts/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT cp.*, u.name AS creator_name, ua.name AS approver_name
             FROM content_posts cp
             LEFT JOIN users u ON u.id = cp.created_by
             LEFT JOIN users ua ON ua.id = cp.approved_by
             WHERE cp.id = $1`, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Пост не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /posts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/content/posts — create
router.post('/posts', async (req, res) => {
    try {
        const { title, body, media_urls, platforms, topic, hashtags, status,
                scheduled_at, week_number, year, day_of_week, notes, ai_generated } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Назва обовʼязкова' });
        const safeTitle = stripTags(title);
        const safeBody = stripTags(body || '');
        const safeNotes = stripTags(notes || null);
        const safeHashtags = sanitizeArray(hashtags || []);

        const result = await pool.query(
            `INSERT INTO content_posts (title, body, media_urls, platforms, topic, hashtags, status,
             scheduled_at, week_number, year, day_of_week, notes, ai_generated, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [safeTitle, safeBody, media_urls || '{}', platforms || '{}', topic || 'general',
             safeHashtags.length ? safeHashtags : '{}', status || 'draft', scheduled_at || null,
             week_number || null, year || null, day_of_week || null,
             safeNotes, ai_generated || false, req.user?.id || null]
        );
        log.info(`Post created: "${title}" by user ${req.user?.id}`);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /posts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/content/posts/:id — update
router.put('/posts/:id', async (req, res) => {
    try {
        const raw = req.body;
        const title = raw.title ? stripTags(raw.title) : undefined;
        const body = raw.body ? stripTags(raw.body) : undefined;
        const notes = raw.notes !== undefined ? stripTags(raw.notes) : undefined;
        const hashtags = raw.hashtags ? sanitizeArray(raw.hashtags) : undefined;
        const { media_urls, platforms, topic, status, scheduled_at, week_number, year, day_of_week } = raw;

        const result = await pool.query(
            `UPDATE content_posts SET
             title = COALESCE($1, title), body = COALESCE($2, body),
             media_urls = COALESCE($3, media_urls), platforms = COALESCE($4, platforms),
             topic = COALESCE($5, topic), hashtags = COALESCE($6, hashtags),
             status = COALESCE($7, status), scheduled_at = COALESCE($8, scheduled_at),
             week_number = COALESCE($9, week_number), year = COALESCE($10, year),
             day_of_week = COALESCE($11, day_of_week), notes = $12,
             updated_at = NOW()
             WHERE id = $13 RETURNING *`,
            [title, body, media_urls, platforms, topic, hashtags, status,
             scheduled_at, week_number, year, day_of_week, notes, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Пост не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /posts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/content/posts/:id/approve
router.put('/posts/:id/approve', requireRole('creator', 'director', 'vice_director', 'art_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE content_posts SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
             WHERE id = $2 AND status IN ('pending_approval', 'draft') RETURNING *`,
            [req.user.id, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не можна затвердити цей пост' });
        log.info(`Post #${req.params.id} approved by user ${req.user.id}`);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /posts/:id/approve error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/content/posts/:id/reject
router.put('/posts/:id/reject', requireRole('creator', 'director', 'vice_director', 'art_director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE content_posts SET status = 'draft', notes = COALESCE($1, notes), updated_at = NOW()
             WHERE id = $2 AND status = 'pending_approval' RETURNING *`,
            [req.body.reason || null, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не можна відхилити цей пост' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /posts/:id/reject error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/content/posts/:id/schedule
router.put('/posts/:id/schedule', async (req, res) => {
    try {
        const { scheduled_at } = req.body;
        if (!scheduled_at) return res.status(400).json({ success: false, error: 'Дата публікації обовʼязкова' });
        const result = await pool.query(
            `UPDATE content_posts SET status = 'scheduled', scheduled_at = $1, updated_at = NOW()
             WHERE id = $2 AND status IN ('approved', 'draft', 'pending_approval') RETURNING *`,
            [scheduled_at, req.params.id]
        );
        if (!result.rows.length) return res.status(400).json({ success: false, error: 'Не можна запланувати цей пост' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /posts/:id/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/content/posts/:id/regenerate — mock AI regeneration
router.put('/posts/:id/regenerate', async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM content_posts WHERE id = $1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Пост не знайдено' });
        const post = existing.rows[0];

        const mockBodies = [
            `🎉 Запрошуємо на ${post.topic || 'свято'} в Парку Закревського!\n\nНезабутні емоції для дітей та дорослих. Деталі за посиланням у шапці профілю 👆`,
            `✨ ${post.title}\n\nКожного дня ми створюємо магію для ваших дітей! Приходьте в Парк Закревського — тут завжди весело 🎭`,
            `🌟 Новинка в Парку Закревського!\n\n${post.title} — це те, що ваші діти точно полюблять. Бронюйте вже зараз! 📞`,
        ];
        const newBody = mockBodies[Math.floor(Math.random() * mockBodies.length)];

        const result = await pool.query(
            `UPDATE content_posts SET body = $1, ai_generated = true, updated_at = NOW()
             WHERE id = $2 RETURNING *`, [newBody, req.params.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /posts/:id/regenerate error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/content/posts/:id
router.delete('/posts/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM content_posts WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Пост не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /posts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// WEEKLY PLAN GENERATION (mock)
// ==========================================

router.post('/generate-week', async (req, res) => {
    try {
        const { week_number, year, platforms = ['instagram', 'telegram'], topics } = req.body;
        if (!week_number || !year) return res.status(400).json({ success: false, error: 'Тиждень і рік обовʼязкові' });

        // Guard: check if week already has posts
        const existing = await pool.query(
            'SELECT COUNT(*) AS cnt FROM content_posts WHERE week_number = $1 AND year = $2',
            [week_number, year]
        );
        if (parseInt(existing.rows[0].cnt) > 0) {
            return res.status(400).json({
                success: false,
                error: `Тиждень ${week_number}/${year} вже має ${existing.rows[0].cnt} постів. Видаліть існуючі або оберіть інший тиждень.`
            });
        }

        const topicList = topics && topics.length ? topics : ['animation', 'quest', 'birthday', 'show', 'masterclass'];
        const dayNames = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
        const posts = [];

        const count = Math.min(topicList.length, 7);
        for (let i = 0; i < count; i++) {
            const topic = topicList[i % topicList.length];
            const dayOfWeek = i + 1;
            const title = `${topic === 'animation' ? '🎭 Анімація' : topic === 'quest' ? '🔍 Квест' : topic === 'birthday' ? '🎂 День народження' : topic === 'show' ? '🎪 Шоу' : topic === 'masterclass' ? '🎨 Майстер-клас' : '📱 Пост'} — ${dayNames[i]}`;
            const body = `✨ ${title}\n\nЗапрошуємо в Парк Закревського! Деталі та бронювання: 📞`;

            const result = await pool.query(
                `INSERT INTO content_posts (title, body, platforms, topic, status, week_number, year, day_of_week, ai_generated, created_by)
                 VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, true, $8) RETURNING *`,
                [title, body, platforms, topic, week_number, year, dayOfWeek, req.user?.id || null]
            );
            posts.push(result.rows[0]);
        }
        log.info(`Generated ${posts.length} posts for week ${week_number}/${year}`);
        res.json({ success: true, data: posts, count: posts.length });
    } catch (err) {
        log.error('POST /generate-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// TEMPLATES
// ==========================================

router.get('/templates', async (req, res) => {
    try {
        const { platform, topic } = req.query;
        const params = []; const conds = ['is_active = true'];
        if (platform) { params.push(platform); conds.push(`platform = $${params.length}`); }
        if (topic) { params.push(topic); conds.push(`topic = $${params.length}`); }
        const result = await pool.query(`SELECT * FROM content_post_templates WHERE ${conds.join(' AND ')} ORDER BY name`, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/templates', requireRole('creator', 'director', 'art_director'), async (req, res) => {
    try {
        const { name, platform, topic, body_template, hashtags, media_type } = req.body;
        if (!name || !platform) return res.status(400).json({ success: false, error: 'Назва і платформа обовʼязкові' });
        const result = await pool.query(
            `INSERT INTO content_post_templates (name, platform, topic, body_template, hashtags, media_type)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [name, platform, topic, body_template, hashtags || '{}', media_type]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SOCIAL ACCOUNTS
// ==========================================

router.get('/accounts', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, platform, account_name, account_id, is_connected, connected_at, config,
             created_at, updated_at FROM social_accounts ORDER BY platform`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /accounts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.put('/accounts/:platform', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { account_name, account_id, is_connected, config } = req.body;
        const result = await pool.query(
            `UPDATE social_accounts SET
             account_name = COALESCE($1, account_name), account_id = COALESCE($2, account_id),
             is_connected = COALESCE($3, is_connected), config = COALESCE($4, config),
             connected_at = CASE WHEN $3 = true THEN NOW() ELSE connected_at END,
             updated_at = NOW()
             WHERE platform = $5 RETURNING *`,
            [account_name, account_id, is_connected, config ? JSON.stringify(config) : null, req.params.platform]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Платформу не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /accounts/:platform error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// STATS
// ==========================================

router.get('/stats', async (req, res) => {
    try {
        const { week, year } = req.query;
        const params = []; const conds = [];
        if (week) { params.push(parseInt(week)); conds.push(`week_number = $${params.length}`); }
        if (year) { params.push(parseInt(year)); conds.push(`year = $${params.length}`); }

        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
                COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending,
                COUNT(*) FILTER (WHERE status = 'approved') AS approved,
                COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
                COUNT(*) FILTER (WHERE status = 'published') AS published,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed
            FROM content_posts ${where}
        `, params);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /stats error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

module.exports = router;
