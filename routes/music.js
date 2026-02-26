/**
 * routes/music.js — Music Center API (v19.0)
 * Announcements, playlists, scheduling.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Music');

// ============================================
// Announcements
// ============================================

// GET /api/music/announcements — list announcements
router.get('/announcements', async (req, res) => {
    try {
        const { status, type } = req.query;
        let query = 'SELECT * FROM announcements';
        const conditions = [];
        const params = [];
        if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
        if (type) { params.push(type); conditions.push(`announcement_type = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY priority DESC, created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List announcements error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/music/announcements — create announcement
router.post('/announcements', async (req, res) => {
    try {
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority } = req.body;
        if (!title || !text_content) {
            return res.status(400).json({ error: 'Назва і текст обов\'язкові' });
        }

        const result = await pool.query(
            `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [title, text_content, announcement_type || 'promo', schedule_type || 'once',
             scheduled_at || null, repeat_cron || null, duration_seconds || 30,
             priority || 0, req.user?.username || 'system']
        );
        log.info(`Announcement created: ${title}`);
        res.json({ success: true, announcement: result.rows[0] });
    } catch (err) {
        log.error('Create announcement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/music/announcements/:id — update announcement
router.put('/announcements/:id', async (req, res) => {
    try {
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, status } = req.body;
        const result = await pool.query(
            `UPDATE announcements SET title=$1, text_content=$2, announcement_type=$3,
             schedule_type=$4, scheduled_at=$5, repeat_cron=$6, duration_seconds=$7,
             priority=$8, status=$9 WHERE id=$10 RETURNING *`,
            [title, text_content, announcement_type, schedule_type, scheduled_at || null,
             repeat_cron || null, duration_seconds || 30, priority || 0,
             status || 'draft', req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Оголошення не знайдено' });
        }
        res.json({ success: true, announcement: result.rows[0] });
    } catch (err) {
        log.error('Update announcement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/music/announcements/:id
router.delete('/announcements/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete announcement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/music/announcements/:id/play — mark as played
router.post('/announcements/:id/play', async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE announcements SET played_count = played_count + 1, last_played_at = NOW()
             WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Оголошення не знайдено' });
        }

        // Log play action
        await pool.query(
            `INSERT INTO music_log (action, announcement_id, details)
             VALUES ('play', $1, $2)`,
            [req.params.id, JSON.stringify({ played_by: req.user?.username || 'system' })]
        );

        res.json({ success: true, announcement: result.rows[0] });
    } catch (err) {
        log.error('Play announcement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Playlists
// ============================================

// GET /api/music/playlists — list playlists
router.get('/playlists', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM playlists ORDER BY category, name');
        res.json(result.rows);
    } catch (err) {
        log.error('List playlists error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/music/playlists — create playlist
router.post('/playlists', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end } = req.body;
        if (!name) return res.status(400).json({ error: 'Назва обов\'язкова' });

        const result = await pool.query(
            `INSERT INTO playlists (name, description, category, tracks, schedule_start, schedule_end)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, description || null, category || 'background',
             JSON.stringify(tracks || []), schedule_start || null, schedule_end || null]
        );
        log.info(`Playlist created: ${name}`);
        res.json({ success: true, playlist: result.rows[0] });
    } catch (err) {
        log.error('Create playlist error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/music/playlists/:id — update playlist
router.put('/playlists/:id', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end, is_active } = req.body;
        const result = await pool.query(
            `UPDATE playlists SET name=$1, description=$2, category=$3, tracks=$4,
             schedule_start=$5, schedule_end=$6, is_active=$7 WHERE id=$8 RETURNING *`,
            [name, description, category, JSON.stringify(tracks || []),
             schedule_start || null, schedule_end || null, is_active !== false, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Плейліст не знайдено' });
        res.json({ success: true, playlist: result.rows[0] });
    } catch (err) {
        log.error('Update playlist error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/music/playlists/:id
router.delete('/playlists/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM playlists WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete playlist error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Music Log + Overview
// ============================================

// GET /api/music/log — recent actions
router.get('/log', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ml.*, a.title as announcement_title, p.name as playlist_name
             FROM music_log ml
             LEFT JOIN announcements a ON ml.announcement_id = a.id
             LEFT JOIN playlists p ON ml.playlist_id = p.id
             ORDER BY ml.created_at DESC LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Music log error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/music/overview — dashboard
router.get('/overview', async (req, res) => {
    try {
        const [announcements, playlists, today] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'active') as active,
                COUNT(*) FILTER (WHERE status = 'draft') as draft,
                COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
                SUM(played_count) as total_plays,
                COUNT(*) as total
             FROM announcements`),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE is_active) as active,
                COUNT(*) as total
             FROM playlists`),
            pool.query(`SELECT COUNT(*) as plays_today FROM music_log WHERE action = 'play' AND created_at > CURRENT_DATE`)
        ]);
        res.json({
            announcements: announcements.rows[0],
            playlists: playlists.rows[0],
            today: today.rows[0]
        });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
