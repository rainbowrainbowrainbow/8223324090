/**
 * routes/music.js — Music Center API v33.15.0
 * Announcements CRUD, real delivery, TTS, scheduling, playlists.
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { deliverAnnouncement } = require('../services/music-delivery');
const log = createLogger('Music');

// ============================================
// Announcements — CRUD
// ============================================

router.get('/announcements', async (req, res) => {
    try {
        const { status, type, includeDeleted } = req.query;
        const conds = includeDeleted ? [] : ['deleted_at IS NULL'];
        const params = [];
        if (status) { params.push(status); conds.push(`status = $${params.length}`); }
        if (type)   { params.push(type);   conds.push(`announcement_type = $${params.length}`); }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const r = await pool.query(
            `SELECT * FROM announcements ${where} ORDER BY priority DESC, created_at DESC LIMIT 200`, params
        );
        res.json({ success: true, announcements: r.rows, total: r.rows.length });
    } catch (err) { log.error('List announcements', err); res.status(500).json({ error: err.message }); }
});

router.post('/announcements', async (req, res) => {
    try {
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, zone_id } = req.body;
        if (!title?.trim() || !text_content?.trim()) return res.status(400).json({ error: 'Назва і текст обов\'язкові' });
        const initStatus = scheduled_at ? 'scheduled' : 'draft';
        const r = await pool.query(
            `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, zone_id, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [title.trim(), text_content.trim(), announcement_type || 'promo', schedule_type || 'once',
             scheduled_at || null, repeat_cron || null, duration_seconds || 30, priority || 0,
             zone_id || null, initStatus, req.user?.username || 'system']
        );
        res.json({ success: true, announcement: r.rows[0] });
    } catch (err) { log.error('Create announcement', err); res.status(500).json({ error: err.message }); }
});

router.put('/announcements/:id', async (req, res) => {
    try {
        const { title, text_content, announcement_type, schedule_type, scheduled_at, repeat_cron, duration_seconds, priority, status, zone_id } = req.body;
        const r = await pool.query(
            `UPDATE announcements SET title=$1, text_content=$2, announcement_type=$3, schedule_type=$4,
             scheduled_at=$5, repeat_cron=$6, duration_seconds=$7, priority=$8, status=$9, zone_id=$10, updated_at=NOW()
             WHERE id=$11 AND deleted_at IS NULL RETURNING *`,
            [title, text_content, announcement_type, schedule_type, scheduled_at || null, repeat_cron || null,
             duration_seconds || 30, priority || 0, status || 'draft', zone_id || null, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, announcement: r.rows[0] });
    } catch (err) { log.error('Update announcement', err); res.status(500).json({ error: err.message }); }
});

router.delete('/announcements/:id', async (req, res) => {
    try {
        const r = await pool.query(
            `UPDATE announcements SET deleted_at=NOW(), status='archived' WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
            [req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) { log.error('Delete announcement', err); res.status(500).json({ error: err.message }); }
});

router.post('/announcements/:id/restore', async (req, res) => {
    try {
        await pool.query('UPDATE announcements SET deleted_at=NULL, status=\'draft\' WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================
// PLAY — real delivery
// ============================================

router.post('/announcements/:id/play', async (req, res) => {
    try {
        const { zone_id } = req.body;
        const annRes = await pool.query('SELECT * FROM announcements WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
        if (!annRes.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        const ann = annRes.rows[0];

        const delivery = await deliverAnnouncement(ann, { triggeredBy: 'manual', zoneId: zone_id || ann.zone_id });

        await pool.query(
            `UPDATE announcements SET played_count=played_count+1, last_played_at=NOW(),
             last_delivery_status=$1, last_delivery_mode=$2, last_delivery_detail=$3, last_delivery_at=NOW()
             WHERE id=$4`,
            [delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail, ann.id]
        );

        await pool.query(
            `INSERT INTO music_log (action, announcement_id, delivery_status, delivery_mode, delivery_detail, triggered_by, details)
             VALUES ('play', $1, $2, $3, $4, 'manual', $5)`,
            [ann.id, delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail,
             JSON.stringify({ played_by: req.user?.username || 'system', zone_id })]
        );

        res.json({ success: delivery.success, delivery, announcement: { id: ann.id, title: ann.title } });
    } catch (err) { log.error('Play announcement', err); res.status(500).json({ error: err.message }); }
});

router.post('/announcements/:id/play-in', async (req, res) => {
    try {
        const mins = parseInt(req.body.minutes, 10);
        if (!mins || mins < 1 || mins > 1440) return res.status(400).json({ error: 'minutes: 1-1440' });
        const scheduledAt = new Date(Date.now() + mins * 60000).toISOString();
        const r = await pool.query(
            `UPDATE announcements SET status='scheduled', scheduled_at=$1, updated_at=NOW()
             WHERE id=$2 AND deleted_at IS NULL RETURNING id, title`,
            [scheduledAt, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, scheduledAt, message: `Заплановано через ${mins} хв` });
    } catch (err) { log.error('Play-in', err); res.status(500).json({ error: err.message }); }
});

// ============================================
// Playlists
// ============================================

router.get('/playlists', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM playlists ORDER BY category, name');
        res.json({ success: true, playlists: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/playlists', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Назва обов\'язкова' });
        const r = await pool.query(
            `INSERT INTO playlists (name, description, category, tracks, schedule_start, schedule_end)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [name.trim(), description || null, category || 'background', JSON.stringify(tracks || []),
             schedule_start || null, schedule_end || null]
        );
        res.json({ success: true, playlist: r.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/playlists/:id', async (req, res) => {
    try {
        const { name, description, category, tracks, schedule_start, schedule_end, is_active } = req.body;
        const r = await pool.query(
            `UPDATE playlists SET name=$1, description=$2, category=$3, tracks=$4,
             schedule_start=$5, schedule_end=$6, is_active=$7 WHERE id=$8 RETURNING *`,
            [name, description, category, JSON.stringify(tracks || []),
             schedule_start || null, schedule_end || null, is_active !== false, req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, playlist: r.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/playlists/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM playlists WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================
// Now Playing + Overview + Stats
// ============================================

router.get('/now-playing', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ml.*, a.title, a.text_content, a.duration_seconds, a.announcement_type
             FROM music_log ml LEFT JOIN announcements a ON a.id = ml.announcement_id
             WHERE ml.action = 'play' AND ml.delivery_status = 'success'
             ORDER BY ml.created_at DESC LIMIT 1`
        );
        const scheduled = await pool.query(
            `SELECT id, title, announcement_type, scheduled_at, duration_seconds
             FROM announcements WHERE status='scheduled' AND scheduled_at > NOW() AND deleted_at IS NULL
             ORDER BY scheduled_at ASC LIMIT 5`
        );
        res.json({ success: true, lastPlayed: r.rows[0] || null, upcoming: scheduled.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/overview', async (req, res) => {
    try {
        const [ann, pl, today] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status='active' AND deleted_at IS NULL)::int AS active,
                COUNT(*) FILTER (WHERE status='draft' AND deleted_at IS NULL)::int AS draft,
                COUNT(*) FILTER (WHERE status='scheduled' AND deleted_at IS NULL)::int AS scheduled,
                COALESCE(SUM(played_count) FILTER (WHERE deleted_at IS NULL), 0)::int AS total_plays
             FROM announcements`),
            pool.query(`SELECT COUNT(*) FILTER (WHERE is_active)::int AS active, COUNT(*)::int AS total FROM playlists`),
            pool.query(`SELECT COUNT(*)::int AS plays_today FROM music_log WHERE action='play' AND created_at>CURRENT_DATE`)
        ]);
        res.json({ success: true, announcements: ann.rows[0], playlists: pl.rows[0], today: today.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/log', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '100'), 500);
        const r = await pool.query(
            `SELECT ml.*, a.title AS announcement_title, a.announcement_type
             FROM music_log ml LEFT JOIN announcements a ON ml.announcement_id = a.id
             ORDER BY ml.created_at DESC LIMIT $1`, [limit]
        );
        res.json({ success: true, log: r.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
