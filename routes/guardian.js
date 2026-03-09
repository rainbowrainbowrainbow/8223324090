/**
 * routes/guardian.js — Guardian AI Agent API
 *
 * Endpoints for guardian reports, actions, and management.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { generateDailyReport, runDailyReports, ensureGuardianMemberships, getMood, getGuardianState, clearMuteCache } = require('../services/guardian');

const log = createLogger('GuardianRoute');

/**
 * GET /api/guardian/reports
 * List daily reports (optionally filter by channel)
 */
router.get('/reports', async (req, res) => {
    try {
        const { channelId, limit = 7 } = req.query;
        let query = `
            SELECT gr.*, cc.name AS channel_name, cc.slug AS channel_slug
            FROM guardian_reports gr
            LEFT JOIN chat_channels cc ON cc.id = gr.channel_id
        `;
        const params = [];
        if (channelId) {
            params.push(channelId);
            query += ' WHERE gr.channel_id = $1';
        }
        query += ' ORDER BY gr.report_date DESC, gr.channel_id LIMIT $' + (params.length + 1);
        params.push(parseInt(limit));

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            reportDate: r.report_date,
            channelId: r.channel_id,
            channelName: r.channel_name,
            channelSlug: r.channel_slug,
            summary: r.summary,
            importantMessages: r.important_messages,
            conflictsDetected: r.conflicts_detected,
            sensitiveMasked: r.sensitive_masked,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /reports error', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

/**
 * POST /api/guardian/reports/generate
 * Manually trigger report generation for a channel/date
 */
router.post('/reports/generate', async (req, res) => {
    try {
        const { channelId, date } = req.body;
        const dateStr = date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });

        if (channelId) {
            const report = await generateDailyReport(channelId, dateStr);
            res.json({ success: true, report });
        } else {
            await runDailyReports();
            res.json({ success: true, message: 'Reports generated for all channels' });
        }
    } catch (err) {
        log.error('POST /reports/generate error', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

/**
 * GET /api/guardian/actions
 * List guardian actions (mutes, masks, warns)
 */
router.get('/actions', async (req, res) => {
    try {
        const { type, channelId, limit = 50 } = req.query;
        let query = `
            SELECT ga.*, u.username AS target_username, cc.name AS channel_name
            FROM guardian_actions ga
            LEFT JOIN users u ON u.id = ga.target_user_id
            LEFT JOIN chat_channels cc ON cc.id = ga.channel_id
            WHERE 1=1
        `;
        const params = [];

        if (type) {
            params.push(type);
            query += ` AND ga.action_type = $${params.length}`;
        }
        if (channelId) {
            params.push(channelId);
            query += ` AND ga.channel_id = $${params.length}`;
        }

        params.push(parseInt(limit));
        query += ` ORDER BY ga.created_at DESC LIMIT $${params.length}`;

        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            actionType: r.action_type,
            channelId: r.channel_id,
            channelName: r.channel_name,
            targetUserId: r.target_user_id,
            targetUsername: r.target_username,
            messageId: r.message_id,
            details: r.details,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /actions error', err);
        res.status(500).json({ error: 'Failed to fetch actions' });
    }
});

/**
 * GET /api/guardian/mutes/active
 * List currently active mutes
 */
router.get('/mutes/active', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name, cc.name AS channel_name
            FROM chat_mutes cm
            JOIN users u ON u.id = cm.user_id
            LEFT JOIN chat_channels cc ON cc.id = cm.channel_id
            WHERE cm.muted_until > NOW()
            ORDER BY cm.muted_until ASC
        `);
        res.json(result.rows.map(r => ({
            id: r.id,
            channelId: r.channel_id,
            channelName: r.channel_name,
            userId: r.user_id,
            username: r.username,
            displayName: r.display_name,
            reason: r.reason,
            mutedUntil: r.muted_until,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /mutes/active error', err);
        res.status(500).json({ error: 'Failed to fetch mutes' });
    }
});

/**
 * DELETE /api/guardian/mutes/:id
 * Manually unmute a user
 */
router.delete('/mutes/:id', async (req, res) => {
    try {
        // Get mute info before clearing (need channelId + userId for cache)
        const muteInfo = await pool.query('SELECT channel_id, user_id FROM chat_mutes WHERE id = $1', [req.params.id]);
        await pool.query('UPDATE chat_mutes SET muted_until = NOW() WHERE id = $1', [req.params.id]);
        // Clear in-memory cache so user can send messages immediately
        if (muteInfo.rows.length > 0) {
            const { channel_id, user_id } = muteInfo.rows[0];
            clearMuteCache(channel_id, user_id);
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /mutes error', err);
        res.status(500).json({ error: 'Failed to unmute' });
    }
});

/**
 * GET /api/guardian/stats
 * Guardian statistics summary
 */
router.get('/stats', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
        const [todayActions, totalActions, activeMutes] = await Promise.all([
            pool.query(`
                SELECT action_type, COUNT(*) cnt
                FROM guardian_actions WHERE created_at::date = $1
                GROUP BY action_type
            `, [today]),
            pool.query(`
                SELECT action_type, COUNT(*) cnt
                FROM guardian_actions
                GROUP BY action_type
            `),
            pool.query('SELECT COUNT(*) cnt FROM chat_mutes WHERE muted_until > NOW()')
        ]);

        const todayStats = {};
        todayActions.rows.forEach(r => { todayStats[r.action_type] = parseInt(r.cnt); });

        const totalStats = {};
        totalActions.rows.forEach(r => { totalStats[r.action_type] = parseInt(r.cnt); });

        res.json({
            today: todayStats,
            total: totalStats,
            activeMutes: parseInt(activeMutes.rows[0].cnt)
        });
    } catch (err) {
        log.error('GET /stats error', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

/**
 * GET /api/guardian/mood
 * Get current guardian mood
 */
router.get('/mood', (req, res) => {
    res.json(getMood());
});

/**
 * GET /api/guardian/state
 * Get full guardian state (mood, health, memory summary)
 */
router.get('/state', (req, res) => {
    res.json(getGuardianState());
});

module.exports = router;
