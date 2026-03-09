/**
 * routes/achievements.js — Achievements API
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Achievements');

// GET /api/achievements — my achievements with progress
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, ua.progress, ua.completed, ua.completed_at, ua.times_completed
            FROM achievements a
            LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
            WHERE a.is_active = true
            ORDER BY a.category, a.rarity DESC
        `, [req.user.id]);

        const achievements = result.rows.map(a => ({
            id: a.id,
            code: a.code,
            name: a.is_secret && !a.completed ? '???' : a.name,
            description: a.is_secret && !a.completed ? 'Знайди секрет...' : a.description,
            icon: a.is_secret && !a.completed ? '🔮' : a.icon,
            category: a.category,
            type: a.type,
            rewardCoins: a.reward_coins,
            rarity: a.rarity,
            isSecret: a.is_secret,
            progress: a.progress || 0,
            target: a.condition?.count || 1,
            completed: a.completed || false,
            completedAt: a.completed_at,
            timesCompleted: a.times_completed || 0
        }));

        res.json(achievements);
    } catch (err) {
        log.error('Get achievements error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/achievements/catalog — all achievements (for display)
router.get('/catalog', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM achievements WHERE is_active = true ORDER BY category, rarity DESC'
        );
        const catalog = result.rows.map(a => ({
            id: a.id,
            code: a.code,
            name: a.is_secret ? '???' : a.name,
            description: a.is_secret ? 'Знайди секрет...' : a.description,
            icon: a.is_secret ? '🔮' : a.icon,
            category: a.category,
            type: a.type,
            rewardCoins: a.reward_coins,
            rarity: a.rarity,
            isSecret: a.is_secret
        }));
        res.json(catalog);
    } catch (err) {
        log.error('Get achievements catalog error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/achievements/check — check and award achievements
router.post('/check', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const userId = req.user.id;
        const awarded = [];

        // Get all active achievements not yet completed by user
        const uncompleted = await pool.query(`
            SELECT a.* FROM achievements a
            LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
            WHERE a.is_active = true AND (ua.completed IS NULL OR ua.completed = false)
              AND a.type != 'repeatable'
        `, [userId]);

        for (const ach of uncompleted.rows) {
            const cond = ach.condition || {};
            let achieved = false;
            let progress = 0;

            if (cond.type === 'login') {
                progress = 1; // if checking, user is logged in
                achieved = true;
            } else if (cond.type === 'streak') {
                const r = await pool.query(
                    'SELECT MAX(best_count) as best FROM game_streaks WHERE user_id = $1',
                    [userId]
                );
                progress = r.rows[0]?.best || 0;
                achieved = progress >= cond.count;
            } else if (cond.type === 'quiz_play') {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = $1 AND completed = true",
                    [userId]
                );
                progress = parseInt(r.rows[0].count);
                achieved = progress >= cond.count;
            } else if (cond.type === 'quiz_perfect') {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = $1 AND completed = true AND correct_count = questions_count",
                    [userId]
                );
                progress = parseInt(r.rows[0].count);
                achieved = progress >= cond.count;
            } else if (cond.type === 'minigame_score') {
                const r = await pool.query(
                    'SELECT MAX(score) as best FROM minigame_sessions WHERE user_id = $1',
                    [userId]
                );
                progress = r.rows[0]?.best || 0;
                achieved = progress >= cond.count;
            } else if (cond.type === 'boss_win') {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM boss_rounds WHERE user_id = $1 AND completed = true",
                    [userId]
                );
                progress = parseInt(r.rows[0].count);
                achieved = progress >= cond.count;
            } else if (cond.type === 'total_earned') {
                const r = await pool.query(
                    'SELECT total_earned FROM game_wallets WHERE user_id = $1',
                    [userId]
                );
                progress = r.rows[0]?.total_earned || 0;
                achieved = progress >= cond.count;
            } else if (cond.type === 'room_decorate') {
                const r = await pool.query(
                    'SELECT 1 FROM user_rooms WHERE user_id = $1 AND (wallpaper_item_id IS NOT NULL OR floor_item_id IS NOT NULL)',
                    [userId]
                );
                progress = r.rows.length;
                achieved = progress >= cond.count;
            } else if (cond.type === 'room_visitors') {
                const r = await pool.query(
                    'SELECT visitor_count FROM user_rooms WHERE user_id = $1',
                    [userId]
                );
                progress = r.rows[0]?.visitor_count || 0;
                achieved = progress >= cond.count;
            } else if (cond.type === 'tasks_completed') {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM tasks WHERE assigned_to = $1 AND status = 'done'",
                    [userId]
                );
                progress = parseInt(r.rows[0].count);
                achieved = progress >= cond.count;
            } else if (cond.type === 'gift_sent') {
                const r = await pool.query(
                    "SELECT COUNT(*) FROM coin_transactions WHERE user_id = $1 AND type = 'gift' AND amount < 0",
                    [userId]
                );
                progress = parseInt(r.rows[0].count);
                achieved = progress >= cond.count;
            } else if (cond.type === 'combo') {
                continue; // tracked at game time, not checkable retroactively
            } else if (cond.type === 'manual_award') {
                continue;
            } else if (cond.type === 'easter_egg' || cond.type === 'rare_drop' || cond.type === 'minigame_late') {
                continue;
            }

            // Update progress
            if (progress > 0 || achieved) {
                await pool.query(`
                    INSERT INTO user_achievements (user_id, username, achievement_id, achievement_key, progress, completed, completed_at)
                    VALUES ($1, $6, $2, $7, $3, $4, $5)
                    ON CONFLICT (user_id, achievement_id) DO UPDATE SET
                        progress = GREATEST(user_achievements.progress, $3),
                        completed = $4,
                        completed_at = CASE WHEN $4 AND NOT user_achievements.completed THEN NOW() ELSE user_achievements.completed_at END,
                        times_completed = CASE WHEN $4 AND NOT user_achievements.completed THEN user_achievements.times_completed + 1 ELSE user_achievements.times_completed END
                `, [userId, ach.id, progress, achieved, achieved ? new Date() : null, req.user.username, ach.code]);

                if (achieved) {
                    // Award coins
                    await pool.query(
                        `UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2`,
                        [ach.reward_coins, userId]
                    );
                    await pool.query(
                        'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
                        [userId, ach.reward_coins, 'achievement', `Ачивка: ${ach.name}`, ach.id]
                    );
                    awarded.push({ code: ach.code, name: ach.name, icon: ach.icon, coins: ach.reward_coins });
                }
            }
        }

        res.json({ awarded, count: awarded.length });
    } catch (err) {
        log.error('Check achievements error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/achievements/award — manual award (admin only)
router.post('/award', requireRole('admin', 'creator', 'director'), async (req, res) => {
    const { user_id, achievement_code } = req.body;
    if (!user_id || !achievement_code) {
        return res.status(400).json({ error: 'user_id та achievement_code обов\'язкові' });
    }
    try {
        const ach = await pool.query('SELECT * FROM achievements WHERE code = $1', [achievement_code]);
        if (ach.rows.length === 0) return res.status(404).json({ error: 'Ачивку не знайдено' });

        const a = ach.rows[0];
        // Get username for the target user
        const targetUser = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
        if (targetUser.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });
        const username = targetUser.rows[0].username;

        await pool.query(`
            INSERT INTO user_achievements (user_id, username, achievement_id, achievement_key, progress, completed, completed_at, times_completed)
            VALUES ($1, $3, $2, $4, 1, true, NOW(), 1)
            ON CONFLICT (user_id, achievement_id) DO UPDATE SET
                completed = true, completed_at = NOW(), times_completed = user_achievements.times_completed + 1
        `, [user_id, a.id, username, a.code]);

        await pool.query(
            'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
            [a.reward_coins, user_id]
        );
        await pool.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [user_id, a.reward_coins, 'achievement', `Ачивка: ${a.name}`, a.id]
        );

        res.json({ success: true, achievement: a.name, coins: a.reward_coins });
    } catch (err) {
        log.error('Award achievement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
