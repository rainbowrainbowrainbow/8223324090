/**
 * routes/marketing-agent.js — Marketing Subagent API (v42.3)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const agent = require('../lib/marketing-agent');

const log = createLogger('MarketingAPI');

router.use(authenticateToken);

// POST /api/marketing-agent/generate-plan
router.post('/generate-plan', requireRole('creator', 'director', 'vice_director', 'art_director', 'marketer'), async (req, res) => {
    try {
        const { week, year, platforms, topics } = req.body;
        if (!week || !year) return res.status(400).json({ success: false, error: 'Тиждень і рік обовʼязкові' });

        const posts = await agent.generateWeeklyPlan(
            parseInt(week), parseInt(year),
            platforms, topics, req.user?.id
        );
        res.json({ success: true, data: posts, count: posts.length });
    } catch (err) {
        log.error('POST /generate-plan error', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /api/marketing-agent/generate-post
router.post('/generate-post', requireRole('creator', 'director', 'vice_director', 'art_director', 'marketer'), async (req, res) => {
    try {
        const { slug, platform, scheduled_at } = req.body;
        if (!slug || !platform) return res.status(400).json({ success: false, error: 'slug і platform обовʼязкові' });

        const post = await agent.generatePost(slug, platform, scheduled_at, req.user?.id);
        res.json({ success: true, data: post });
    } catch (err) {
        log.error('POST /generate-post error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/marketing-agent/regenerate/:id
router.post('/regenerate/:id', async (req, res) => {
    try {
        const post = await agent.regeneratePost(parseInt(req.params.id));
        res.json({ success: true, data: post });
    } catch (err) {
        log.error('POST /regenerate error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/marketing-agent/publish/:id
router.post('/publish/:id', requireRole('creator', 'director', 'vice_director', 'art_director'), async (req, res) => {
    try {
        const result = await agent.publishPost(parseInt(req.params.id));
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('POST /publish error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/marketing-agent/publish-scheduled (cron trigger)
router.post('/publish-scheduled', requireRole('creator', 'director'), async (req, res) => {
    try {
        const results = await agent.publishScheduled();
        res.json({ success: true, data: results, count: results.length });
    } catch (err) {
        log.error('POST /publish-scheduled error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/marketing-agent/status
router.get('/status', async (req, res) => {
    try {
        const status = await agent.getStatus();
        res.json({ success: true, data: status });
    } catch (err) {
        log.error('GET /status error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/marketing-agent/log
router.get('/log', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, title, status, platforms, topic, ai_generated, scheduled_at, published_at,
                   platform_post_ids, platform_urls, created_at, updated_at
            FROM content_posts
            WHERE ai_generated = true
            ORDER BY updated_at DESC LIMIT 50
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /log error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
