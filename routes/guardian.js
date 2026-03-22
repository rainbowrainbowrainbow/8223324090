/**
 * routes/guardian.js — Guardian AI Agent API
 *
 * Endpoints for guardian reports, actions, and management.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    generateDailyReport, runDailyReports, ensureGuardianMemberships,
    getMood, getGuardianState, clearMuteCache, alertDirector,
    setEmergencyStop, getEmergencyStop,
    getChannelSettings, invalidateChannelSettingsCache,
    alertDirectorTelegram
} = require('../services/guardian');

const { authenticateToken } = require('../middleware/auth');

const log = createLogger('GuardianRoute');

// All guardian routes require authentication
router.use(authenticateToken);

// Phase 3 functions — optional, may not be available yet
let handleGuardianCommand, calculateChannelHealth, getChannelMoodSummary, getUserMoodProfile, generateWeeklyReport, getActivityHeatmap, getTrustScore, updateTrustScore, checkEscalation;
try {
    ({ handleGuardianCommand, calculateChannelHealth, getChannelMoodSummary, getUserMoodProfile, generateWeeklyReport, getActivityHeatmap, getTrustScore, updateTrustScore, checkEscalation } = require('../services/guardian'));
} catch (e) {
    log.warn('Some guardian phase3 functions not yet available');
}

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

// ==========================================
// GUARDIAN RULES CRUD (Contour 2)
// ==========================================

/**
 * GET /api/guardian/rules
 * List all guardian rules (active by default).
 */
router.get('/rules', async (req, res) => {
    try {
        const { active } = req.query;
        let query = 'SELECT * FROM guardian_rules';
        const params = [];
        if (active !== 'all') {
            query += ' WHERE is_active = true';
        }
        query += ' ORDER BY severity DESC, created_at';
        const result = await pool.query(query, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            ruleType: r.rule_type,
            name: r.name,
            pattern: r.pattern,
            action: r.action,
            severity: r.severity,
            channelScope: r.channel_scope,
            isActive: r.is_active,
            metadata: r.metadata,
            createdBy: r.created_by,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /rules error', err);
        res.status(500).json({ error: 'Не вдалось отримати правила' });
    }
});

/**
 * POST /api/guardian/rules
 * Create a new guardian rule.
 */
router.post('/rules', async (req, res) => {
    try {
        const { ruleType, name, pattern, action, severity, channelScope, metadata } = req.body;
        if (!name || !action) {
            return res.status(400).json({ error: 'name та action обовʼязкові' });
        }
        const result = await pool.query(
            `INSERT INTO guardian_rules (rule_type, name, pattern, action, severity, channel_scope, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [ruleType || 'keyword', name, pattern, action, severity || 'medium',
             channelScope || null, JSON.stringify(metadata || {}), req.user.id]
        );
        const r = result.rows[0];
        res.json({
            id: r.id, ruleType: r.rule_type, name: r.name, pattern: r.pattern,
            action: r.action, severity: r.severity, isActive: r.is_active
        });
    } catch (err) {
        log.error('POST /rules error', err);
        res.status(500).json({ error: 'Не вдалось створити правило' });
    }
});

/**
 * PUT /api/guardian/rules/:id
 * Update a guardian rule.
 */
router.put('/rules/:id', async (req, res) => {
    try {
        const { name, pattern, action, severity, channelScope, isActive, metadata } = req.body;
        const result = await pool.query(
            `UPDATE guardian_rules SET
                name = COALESCE($1, name),
                pattern = COALESCE($2, pattern),
                action = COALESCE($3, action),
                severity = COALESCE($4, severity),
                channel_scope = COALESCE($5, channel_scope),
                is_active = COALESCE($6, is_active),
                metadata = COALESCE($7, metadata),
                updated_at = NOW()
             WHERE id = $8 RETURNING *`,
            [name, pattern, action, severity, channelScope, isActive,
             metadata ? JSON.stringify(metadata) : null, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Правило не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /rules error', err);
        res.status(500).json({ error: 'Не вдалось оновити правило' });
    }
});

/**
 * DELETE /api/guardian/rules/:id
 * Delete a guardian rule.
 */
router.delete('/rules/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM guardian_rules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /rules error', err);
        res.status(500).json({ error: 'Не вдалось видалити правило' });
    }
});

/**
 * POST /api/guardian/action
 * Handle inline action buttons from Guardian DM alerts.
 * Actions: mute_both, warn, watch, unmute
 */
router.post('/action', async (req, res) => {
    try {
        const { action, channelId, userId, username } = req.body;
        if (!action) {
            return res.status(400).json({ error: 'action обовʼязковий' });
        }

        const adminUser = req.user;
        let response = '';

        switch (action) {
            case 'mute_both': {
                // Mute both parties in the channel (find recent conflict aggressors)
                const recentMutes = await pool.query(`
                    SELECT DISTINCT user_id, (details->>'username')::text AS username
                    FROM guardian_actions
                    WHERE channel_id = $1 AND action_type = 'mute'
                    AND created_at > NOW() - INTERVAL '10 minutes'
                    ORDER BY created_at DESC LIMIT 2
                `, [channelId]);
                for (const mute of recentMutes.rows) {
                    await pool.query(
                        'INSERT INTO chat_mutes (channel_id, user_id, reason, muted_until) VALUES ($1, $2, $3, NOW() + INTERVAL \'10 minutes\')',
                        [channelId, mute.user_id, 'Директор: мютити обох']
                    );
                }
                response = `🔇 Обох учасників замютовано на 10 хв (${adminUser.username})`;
                break;
            }
            case 'warn': {
                // Send warning to user
                await alertDirector(
                    `⚠️ <b>Попередження від директора</b>\n` +
                    `@${username}, будь ласка, дотримуйтесь правил спілкування.\n` +
                    `Наступне порушення — блокування на довший термін.`
                );
                response = `⚠️ Попередження відправлено @${username} (${adminUser.username})`;
                break;
            }
            case 'watch': {
                response = `👀 Директор спостерігає за ситуацією (${adminUser.username})`;
                break;
            }
            case 'unmute': {
                if (userId) {
                    await pool.query('UPDATE chat_mutes SET muted_until = NOW() WHERE user_id = $1 AND channel_id = $2 AND muted_until > NOW()', [userId, channelId]);
                    clearMuteCache(channelId, userId);
                    response = `🔊 @${username || userId} розмютовано (${adminUser.username})`;
                }
                break;
            }
            default:
                return res.status(400).json({ error: `Невідома дія: ${action}` });
        }

        // Log the director's action
        await pool.query(
            'INSERT INTO guardian_actions (action_type, channel_id, target_user_id, details) VALUES ($1, $2, $3, $4)',
            [`director_${action}`, channelId || null, userId || null, JSON.stringify({ response, adminId: adminUser.id })]
        );

        res.json({ success: true, message: response });
    } catch (err) {
        log.error('POST /action error', err);
        res.status(500).json({ error: 'Не вдалось виконати дію' });
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

// ==========================================
// CHANNEL HEALTH (Phase 3)
// ==========================================

/**
 * GET /api/guardian/health/:channelId
 * Get channel health score + history
 */
router.get('/health/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;

        // Try service function first
        let health = null;
        if (calculateChannelHealth) {
            try {
                health = await calculateChannelHealth(channelId);
            } catch (e) {
                log.warn('calculateChannelHealth not available, using DB fallback');
            }
        }

        // Fallback: query DB directly
        if (!health) {
            const latest = await pool.query(`
                SELECT score, level, factors, trend
                FROM guardian_channel_health
                WHERE channel_id = $1
                ORDER BY recorded_at DESC LIMIT 1
            `, [channelId]);
            health = latest.rows[0]
                ? { score: latest.rows[0].score, level: latest.rows[0].level, factors: latest.rows[0].factors, trend: latest.rows[0].trend }
                : { score: 100, level: 'healthy', factors: {}, trend: 'stable' };
        }

        const history = await pool.query(`
            SELECT score, level, recorded_at
            FROM guardian_channel_health
            WHERE channel_id = $1
            ORDER BY recorded_at DESC LIMIT 30
        `, [channelId]);

        res.json({
            score: health.score,
            level: health.level,
            factors: health.factors || {},
            trend: health.trend || 'stable',
            history: history.rows.map(r => ({
                score: r.score,
                level: r.level,
                recordedAt: r.recorded_at
            }))
        });
    } catch (err) {
        log.error('GET /health/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch channel health' });
    }
});

/**
 * GET /api/guardian/health
 * Get all channels health summary
 */
router.get('/health', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (gch.channel_id)
                gch.channel_id, cc.name AS channel_name, gch.score, gch.level
            FROM guardian_channel_health gch
            LEFT JOIN chat_channels cc ON cc.id = gch.channel_id
            ORDER BY gch.channel_id, gch.recorded_at DESC
        `);
        res.json(result.rows.map(r => ({
            channelId: r.channel_id,
            channelName: r.channel_name,
            score: r.score,
            level: r.level
        })));
    } catch (err) {
        log.error('GET /health error', err);
        res.status(500).json({ error: 'Failed to fetch health summary' });
    }
});

// ==========================================
// MOOD / SENTIMENT (Phase 3)
// ==========================================

/**
 * GET /api/guardian/mood/channel/:channelId
 * Get channel mood/sentiment summary
 */
router.get('/mood/channel/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { period = 'today' } = req.query;

        if (getChannelMoodSummary) {
            try {
                const mood = await getChannelMoodSummary(channelId, period);
                return res.json(mood);
            } catch (e) {
                log.warn('getChannelMoodSummary failed, using DB fallback');
            }
        }

        const interval = period === 'week' ? '7 days' : '1 day';
        const result = await pool.query(`
            SELECT score, sentiment, analyzed_at
            FROM guardian_mood_tracking
            WHERE channel_id = $1 AND analyzed_at > NOW() - $2::interval
            ORDER BY analyzed_at DESC
        `, [channelId, interval]);

        const rows = result.rows;
        const avgScore = rows.length > 0 ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
        const distribution = { positive: 0, neutral: 0, negative: 0 };
        const emotionCount = {};
        rows.forEach(r => {
            if (distribution[r.sentiment] !== undefined) distribution[r.sentiment]++;
        });

        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';
        const trend = rows.length >= 2
            ? (rows[0].score > rows[rows.length - 1].score ? 'improving' : rows[0].score < rows[rows.length - 1].score ? 'declining' : 'stable')
            : 'stable';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            trend,
            distribution,
            topEmotions: []
        });
    } catch (err) {
        log.error('GET /mood/channel/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch channel mood' });
    }
});

/**
 * GET /api/guardian/mood/user/:userId
 * Get user mood profile
 */
router.get('/mood/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (getUserMoodProfile) {
            try {
                const profile = await getUserMoodProfile(userId);
                return res.json(profile);
            } catch (e) {
                log.warn('getUserMoodProfile failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT score, sentiment, analyzed_at
            FROM guardian_mood_tracking
            WHERE user_id = $1
            ORDER BY analyzed_at DESC LIMIT 30
        `, [userId]);

        const rows = result.rows;
        const avgScore = rows.length > 0 ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';
        const trend = rows.length >= 2
            ? (rows[0].score > rows[rows.length - 1].score ? 'improving' : rows[0].score < rows[rows.length - 1].score ? 'declining' : 'stable')
            : 'stable';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            recentMood: rows.slice(0, 10).map(r => ({
                score: r.score,
                sentiment: r.sentiment,
                analyzedAt: r.analyzed_at
            })),
            trend
        });
    } catch (err) {
        log.error('GET /mood/user/:userId error', err);
        res.status(500).json({ error: 'Failed to fetch user mood' });
    }
});

/**
 * GET /api/guardian/mood/team
 * Get team-wide mood summary
 */
router.get('/mood/team', async (req, res) => {
    try {
        const { period = 'today' } = req.query;
        const interval = period === 'week' ? '7 days' : '1 day';

        const [overall, byChannel, byUser] = await Promise.all([
            pool.query(`
                SELECT AVG(score) AS avg_score
                FROM guardian_mood_tracking
                WHERE analyzed_at > NOW() - $1::interval
            `, [interval]),
            pool.query(`
                SELECT gmt.channel_id, cc.name, AVG(gmt.score) AS avg_score
                FROM guardian_mood_tracking gmt
                LEFT JOIN chat_channels cc ON cc.id = gmt.channel_id
                WHERE gmt.analyzed_at > NOW() - $1::interval AND gmt.channel_id IS NOT NULL
                GROUP BY gmt.channel_id, cc.name
                ORDER BY avg_score ASC
            `, [interval]),
            pool.query(`
                SELECT gmt.user_id, u.username, AVG(gmt.score) AS avg_score
                FROM guardian_mood_tracking gmt
                LEFT JOIN users u ON u.id = gmt.user_id
                WHERE gmt.analyzed_at > NOW() - $1::interval AND gmt.user_id IS NOT NULL
                GROUP BY gmt.user_id, u.username
                ORDER BY avg_score ASC
            `, [interval])
        ]);

        const avgScore = overall.rows[0]?.avg_score ? parseFloat(overall.rows[0].avg_score) : 0;
        const sentiment = avgScore >= 0.6 ? 'positive' : avgScore >= 0.4 ? 'neutral' : 'negative';

        res.json({
            avgScore: Math.round(avgScore * 100) / 100,
            sentiment,
            byChannel: byChannel.rows.map(r => ({
                channelId: r.channel_id,
                name: r.name,
                avgScore: Math.round(parseFloat(r.avg_score) * 100) / 100
            })),
            byUser: byUser.rows.map(r => ({
                userId: r.user_id,
                username: r.username,
                avgScore: Math.round(parseFloat(r.avg_score) * 100) / 100
            }))
        });
    } catch (err) {
        log.error('GET /mood/team error', err);
        res.status(500).json({ error: 'Failed to fetch team mood' });
    }
});

// ==========================================
// TRUST SCORES (Phase 3)
// ==========================================

/**
 * GET /api/guardian/trust/:userId
 * Get trust score for a specific user
 */
router.get('/trust/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (getTrustScore) {
            try {
                const trust = await getTrustScore(userId);
                if (trust) return res.json(trust);
            } catch (e) {
                log.warn('getTrustScore failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT trust_score, level, positive_actions, negative_actions, last_incident, notes
            FROM guardian_trust_scores
            WHERE user_id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.json({ trustScore: 100, level: 'trusted', positiveActions: 0, negativeActions: 0, lastIncident: null, notes: null });
        }

        const r = result.rows[0];
        res.json({
            trustScore: r.trust_score,
            level: r.level,
            positiveActions: r.positive_actions,
            negativeActions: r.negative_actions,
            lastIncident: r.last_incident,
            notes: r.notes
        });
    } catch (err) {
        log.error('GET /trust/:userId error', err);
        res.status(500).json({ error: 'Failed to fetch trust score' });
    }
});

/**
 * GET /api/guardian/trust
 * Get all users trust scores sorted by score
 */
router.get('/trust', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT gts.user_id, u.username, gts.trust_score, gts.level, gts.negative_actions
            FROM guardian_trust_scores gts
            LEFT JOIN users u ON u.id = gts.user_id
            ORDER BY gts.trust_score ASC
        `);
        res.json(result.rows.map(r => ({
            userId: r.user_id,
            username: r.username,
            trustScore: r.trust_score,
            level: r.level,
            negativeActions: r.negative_actions
        })));
    } catch (err) {
        log.error('GET /trust error', err);
        res.status(500).json({ error: 'Failed to fetch trust scores' });
    }
});

// ==========================================
// ANALYTICS (Phase 3)
// ==========================================

/**
 * GET /api/guardian/analytics/heatmap/:channelId
 * Get activity heatmap for a channel
 */
router.get('/analytics/heatmap/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { days = 7 } = req.query;

        if (getActivityHeatmap) {
            try {
                const heatmap = await getActivityHeatmap(channelId, parseInt(days));
                return res.json(heatmap);
            } catch (e) {
                log.warn('getActivityHeatmap failed, using DB fallback');
            }
        }

        const result = await pool.query(`
            SELECT
                EXTRACT(HOUR FROM cm.created_at) AS hour_bucket,
                COUNT(*) AS message_count,
                COUNT(*) FILTER (WHERE ga_conflict.id IS NOT NULL) AS conflict_count,
                COUNT(*) FILTER (WHERE ga_mute.id IS NOT NULL) AS mute_count,
                AVG(gmt.score) AS avg_sentiment
            FROM chat_messages cm
            LEFT JOIN guardian_actions ga_conflict ON ga_conflict.channel_id = cm.channel_id
                AND ga_conflict.action_type = 'conflict' AND ga_conflict.message_id = cm.id
            LEFT JOIN guardian_actions ga_mute ON ga_mute.channel_id = cm.channel_id
                AND ga_mute.action_type = 'mute' AND ga_mute.message_id = cm.id
            LEFT JOIN guardian_mood_tracking gmt ON gmt.channel_id = cm.channel_id
                AND DATE_TRUNC('hour', gmt.analyzed_at) = DATE_TRUNC('hour', cm.created_at)
            WHERE cm.channel_id = $1 AND cm.created_at > NOW() - ($2 || ' days')::interval
            GROUP BY hour_bucket
            ORDER BY hour_bucket
        `, [channelId, parseInt(days)]);

        res.json(result.rows.map(r => ({
            hourBucket: parseInt(r.hour_bucket),
            messageCount: parseInt(r.message_count),
            conflictCount: parseInt(r.conflict_count),
            muteCount: parseInt(r.mute_count),
            avgSentiment: r.avg_sentiment ? Math.round(parseFloat(r.avg_sentiment) * 100) / 100 : null
        })));
    } catch (err) {
        log.error('GET /analytics/heatmap/:channelId error', err);
        res.status(500).json({ error: 'Failed to fetch heatmap' });
    }
});

/**
 * GET /api/guardian/analytics/top-offenders
 * Get top offenders by mute count
 */
router.get('/analytics/top-offenders', async (req, res) => {
    try {
        const { period = 'week', limit = 10 } = req.query;
        const interval = period === 'month' ? '30 days' : '7 days';

        const result = await pool.query(`
            SELECT ga.target_user_id AS user_id, u.username,
                   COUNT(*) AS mute_count,
                   MAX(ga.created_at) AS last_incident
            FROM guardian_actions ga
            LEFT JOIN users u ON u.id = ga.target_user_id
            WHERE ga.action_type = 'mute' AND ga.created_at > NOW() - $1::interval
            GROUP BY ga.target_user_id, u.username
            ORDER BY mute_count DESC
            LIMIT $2
        `, [interval, parseInt(limit)]);

        res.json(result.rows.map(r => ({
            userId: r.user_id,
            username: r.username,
            muteCount: parseInt(r.mute_count),
            lastIncident: r.last_incident
        })));
    } catch (err) {
        log.error('GET /analytics/top-offenders error', err);
        res.status(500).json({ error: 'Failed to fetch top offenders' });
    }
});

/**
 * GET /api/guardian/analytics/effectiveness
 * Get guardian effectiveness metrics
 */
router.get('/analytics/effectiveness', async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        const interval = period === 'month' ? '30 days' : '7 days';

        const [current, previous] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE action_type IN ('scan', 'mask', 'mute', 'warn')) AS total_scanned,
                    COUNT(*) FILTER (WHERE action_type IN ('mask', 'mute')) AS total_blocked,
                    COUNT(*) FILTER (WHERE action_type = 'false_positive') AS false_positives,
                    AVG(EXTRACT(EPOCH FROM (created_at - COALESCE((details->>'detected_at')::timestamptz, created_at)))) AS avg_response_time
                FROM guardian_actions
                WHERE created_at > NOW() - $1::interval
            `, [interval]),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE action_type IN ('scan', 'mask', 'mute', 'warn')) AS total_scanned,
                    COUNT(*) FILTER (WHERE action_type IN ('mask', 'mute')) AS total_blocked
                FROM guardian_actions
                WHERE created_at > NOW() - ($1::interval * 2) AND created_at <= NOW() - $1::interval
            `, [interval])
        ]);

        const cur = current.rows[0];
        const prev = previous.rows[0];
        const totalScanned = parseInt(cur.total_scanned) || 0;
        const totalBlocked = parseInt(cur.total_blocked) || 0;
        const blockRate = totalScanned > 0 ? Math.round((totalBlocked / totalScanned) * 10000) / 100 : 0;
        const prevScanned = parseInt(prev.total_scanned) || 0;
        const prevBlocked = parseInt(prev.total_blocked) || 0;

        res.json({
            totalScanned,
            totalBlocked,
            blockRate,
            falsePositives: parseInt(cur.false_positives) || 0,
            avgResponseTime: cur.avg_response_time ? Math.round(parseFloat(cur.avg_response_time) * 100) / 100 : null,
            trendsVsPrevious: {
                scannedChange: totalScanned - prevScanned,
                blockedChange: totalBlocked - prevBlocked
            }
        });
    } catch (err) {
        log.error('GET /analytics/effectiveness error', err);
        res.status(500).json({ error: 'Failed to fetch effectiveness metrics' });
    }
});

/**
 * GET /api/guardian/analytics/overview
 * Get guardian analytics overview
 */
router.get('/analytics/overview', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM chat_messages) AS total_messages,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mute') AS total_mutes,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mask') AS total_masks,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'conflict') AS total_conflicts,
                (SELECT COUNT(DISTINCT channel_id) FROM chat_messages WHERE created_at > NOW() - INTERVAL '24 hours') AS active_channels,
                (SELECT AVG(score) FROM guardian_channel_health WHERE recorded_at > NOW() - INTERVAL '24 hours') AS health_avg,
                (SELECT AVG(score) FROM guardian_mood_tracking WHERE analyzed_at > NOW() - INTERVAL '24 hours') AS mood_avg
        `);

        const r = result.rows[0];
        res.json({
            totalMessages: parseInt(r.total_messages) || 0,
            totalMutes: parseInt(r.total_mutes) || 0,
            totalMasks: parseInt(r.total_masks) || 0,
            totalConflicts: parseInt(r.total_conflicts) || 0,
            activeChannels: parseInt(r.active_channels) || 0,
            healthAvg: r.health_avg ? Math.round(parseFloat(r.health_avg) * 100) / 100 : null,
            moodAvg: r.mood_avg ? Math.round(parseFloat(r.mood_avg) * 100) / 100 : null
        });
    } catch (err) {
        log.error('GET /analytics/overview error', err);
        res.status(500).json({ error: 'Failed to fetch analytics overview' });
    }
});

// ==========================================
// ESCALATION CONFIG (Phase 3)
// ==========================================

/**
 * GET /api/guardian/escalation
 * Get all escalation config levels
 */
router.get('/escalation', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, level, name, threshold, action, mute_duration_minutes, notify_telegram, is_active
            FROM guardian_escalation_config
            ORDER BY level ASC
        `);
        res.json(result.rows.map(r => ({
            id: r.id,
            level: r.level,
            name: r.name,
            threshold: r.threshold,
            action: r.action,
            muteDurationMinutes: r.mute_duration_minutes,
            notifyTelegram: r.notify_telegram,
            isActive: r.is_active
        })));
    } catch (err) {
        log.error('GET /escalation error', err);
        res.status(500).json({ error: 'Failed to fetch escalation config' });
    }
});

/**
 * PUT /api/guardian/escalation/:id
 * Update an escalation config level
 */
router.put('/escalation/:id', async (req, res) => {
    try {
        const { threshold, muteDurationMinutes, notifyTelegram, isActive } = req.body;
        const result = await pool.query(`
            UPDATE guardian_escalation_config SET
                threshold = COALESCE($1, threshold),
                mute_duration_minutes = COALESCE($2, mute_duration_minutes),
                notify_telegram = COALESCE($3, notify_telegram),
                is_active = COALESCE($4, is_active),
                updated_at = NOW()
            WHERE id = $5 RETURNING *
        `, [threshold, muteDurationMinutes, notifyTelegram, isActive, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Escalation config not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /escalation/:id error', err);
        res.status(500).json({ error: 'Failed to update escalation config' });
    }
});

// ==========================================
// WEEKLY REPORTS (Phase 3)
// ==========================================

/**
 * GET /api/guardian/weekly-reports
 * List recent weekly reports
 */
router.get('/weekly-reports', async (req, res) => {
    try {
        const { limit = 4 } = req.query;
        const result = await pool.query(`
            SELECT id, week_start, week_end, summary, stats, top_offenders, recommendations, created_at
            FROM guardian_weekly_reports
            ORDER BY week_start DESC
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows.map(r => ({
            id: r.id,
            weekStart: r.week_start,
            weekEnd: r.week_end,
            summary: r.summary,
            stats: r.stats,
            topOffenders: r.top_offenders,
            recommendations: r.recommendations,
            createdAt: r.created_at
        })));
    } catch (err) {
        log.error('GET /weekly-reports error', err);
        res.status(500).json({ error: 'Failed to fetch weekly reports' });
    }
});

/**
 * POST /api/guardian/weekly-reports/generate
 * Manually trigger weekly report generation
 */
router.post('/weekly-reports/generate', async (req, res) => {
    try {
        if (!generateWeeklyReport) {
            return res.status(501).json({ error: 'generateWeeklyReport not yet available' });
        }
        const report = await generateWeeklyReport();
        res.json({ success: true, report });
    } catch (err) {
        log.error('POST /weekly-reports/generate error', err);
        res.status(500).json({ error: 'Failed to generate weekly report' });
    }
});

// ==========================================
// GUARDIAN COMMAND (Phase 3)
// ==========================================

/**
 * POST /api/guardian/command
 * Execute a guardian command
 */
router.post('/command', async (req, res) => {
    try {
        const { channelId, command } = req.body;
        if (!command) {
            return res.status(400).json({ error: 'command is required' });
        }
        if (!handleGuardianCommand) {
            return res.status(501).json({ error: 'handleGuardianCommand not yet available' });
        }
        const response = await handleGuardianCommand(channelId, command);
        res.json({ success: true, response });
    } catch (err) {
        log.error('POST /command error', err);
        res.status(500).json({ error: 'Failed to execute command' });
    }
});

// ==========================================
// ETAP 1: PER-CHANNEL TOGGLE
// ==========================================

/**
 * POST /api/guardian/toggle
 * Enable/disable Guardian per channel.
 * Body: { channelId, guardianEnabled, contour2Enabled }
 * Auth: creator/director only
 */
router.post('/toggle', async (req, res) => {
    try {
        const { channelId, guardianEnabled, contour2Enabled } = req.body;
        if (!channelId) {
            return res.status(400).json({ error: 'channelId is required' });
        }

        const updates = [];
        const params = [];
        let paramIdx = 1;

        if (guardianEnabled !== undefined) {
            updates.push(`guardian_enabled = $${paramIdx++}`);
            params.push(!!guardianEnabled);
        }
        if (contour2Enabled !== undefined) {
            updates.push(`contour2_enabled = $${paramIdx++}`);
            params.push(!!contour2Enabled);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        params.push(channelId);
        await pool.query(
            `UPDATE chat_channels SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
            params
        );

        // Invalidate cache
        invalidateChannelSettingsCache(channelId);

        // Return updated settings
        const settings = await getChannelSettings(channelId);

        log.info(`Guardian toggle: channel ${channelId} → guardian=${settings.guardian_enabled}, contour2=${settings.contour2_enabled}`);

        res.json({
            success: true,
            channelId,
            guardianEnabled: settings.guardian_enabled,
            contour2Enabled: settings.contour2_enabled
        });
    } catch (err) {
        log.error('POST /toggle error', err);
        res.status(500).json({ error: 'Failed to toggle guardian' });
    }
});

/**
 * GET /api/guardian/toggle/:channelId
 * Get current toggle state for a channel.
 */
router.get('/toggle/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const settings = await getChannelSettings(parseInt(channelId));
        res.json({
            channelId: parseInt(channelId),
            guardianEnabled: settings.guardian_enabled,
            contour2Enabled: settings.contour2_enabled
        });
    } catch (err) {
        log.error('GET /toggle/:channelId error', err);
        res.status(500).json({ error: 'Failed to get guardian settings' });
    }
});

// ==========================================
// ETAP 1: EMERGENCY STOP
// ==========================================

/**
 * POST /api/guardian/emergency-stop
 * Activate or deactivate Guardian Emergency Stop.
 * Body: { stop: true/false }
 * Auth: creator only
 */
router.post('/emergency-stop', async (req, res) => {
    try {
        const { stop } = req.body;
        if (stop === undefined) {
            return res.status(400).json({ error: 'stop (true/false) is required' });
        }

        setEmergencyStop(stop);

        const username = req.user?.username || req.body.username || 'unknown';
        const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

        if (stop) {
            // Alert director via Telegram
            alertDirectorTelegram(
                `🛑 <b>Guardian EMERGENCY STOP активовано</b>\n` +
                `Ким: ${username}\n` +
                `Час: ${timestamp}\n` +
                `Усі перевірки зупинено.`,
                'emergency-stop'
            );
            log.warn(`Guardian Emergency Stop ACTIVATED by ${username}`);
        } else {
            alertDirectorTelegram(
                `✅ <b>Guardian EMERGENCY STOP знято</b>\n` +
                `Ким: ${username}\n` +
                `Час: ${timestamp}\n` +
                `Перевірки відновлено.`,
                'emergency-stop-off'
            );
            log.info(`Guardian Emergency Stop DEACTIVATED by ${username}`);
        }

        res.json({ success: true, emergencyStop: getEmergencyStop() });
    } catch (err) {
        log.error('POST /emergency-stop error', err);
        res.status(500).json({ error: 'Failed to set emergency stop' });
    }
});

/**
 * GET /api/guardian/emergency-stop
 * Get current Emergency Stop state.
 */
router.get('/emergency-stop', async (req, res) => {
    res.json({ emergencyStop: getEmergencyStop() });
});

// ==========================================
// ETAP 1: WHITELIST MANAGEMENT
// ==========================================

/**
 * GET /api/guardian/whitelist
 * List all whitelist phrases.
 */
router.get('/whitelist', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT gw.*, u.username AS added_by_username FROM guardian_whitelist gw LEFT JOIN users u ON u.id = gw.added_by ORDER BY gw.created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('GET /whitelist error', err);
        res.status(500).json({ error: 'Failed to fetch whitelist' });
    }
});

/**
 * POST /api/guardian/whitelist
 * Add a phrase to the whitelist.
 * Body: { phrase }
 */
router.post('/whitelist', async (req, res) => {
    try {
        const { phrase } = req.body;
        if (!phrase || !phrase.trim()) {
            return res.status(400).json({ error: 'phrase is required' });
        }
        const userId = req.user?.id || null;
        const result = await pool.query(
            'INSERT INTO guardian_whitelist (phrase, added_by) VALUES ($1, $2) ON CONFLICT (phrase) DO NOTHING RETURNING *',
            [phrase.trim().toLowerCase(), userId]
        );

        // Reload whitelist in service
        const { loadDynamicWhitelist } = require('../services/guardian');
        await loadDynamicWhitelist();

        res.json({ success: true, phrase: phrase.trim().toLowerCase(), inserted: result.rowCount > 0 });
    } catch (err) {
        log.error('POST /whitelist error', err);
        res.status(500).json({ error: 'Failed to add whitelist phrase' });
    }
});

/**
 * DELETE /api/guardian/whitelist/:id
 * Remove a phrase from the whitelist.
 */
router.delete('/whitelist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM guardian_whitelist WHERE id = $1', [parseInt(id)]);

        const { loadDynamicWhitelist } = require('../services/guardian');
        await loadDynamicWhitelist();

        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /whitelist/:id error', err);
        res.status(500).json({ error: 'Failed to delete whitelist phrase' });
    }
});

module.exports = router;
