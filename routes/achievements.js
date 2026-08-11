/**
 * routes/achievements.js — Achievements API
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { buildTaskOwnerMatch } = require('../services/taskPolicy');
const {
    taskKpiCompletedSql,
    taskKpiEligibleSql
} = require('../services/taskPerformancePolicy');
const log = createLogger('Achievements');

async function optionalAchievementQuery(label, sql, params = [], fallbackRow = {}) {
    try {
        return await pool.query(sql, params);
    } catch (err) {
        log.warn(`Achievement criteria skipped: ${label}`, { code: err.code, message: err.message });
        return { rows: [fallbackRow], rowCount: 0 };
    }
}

async function writeAchievementProgress({ userId, username, achievement, progress, completed, completedAt }) {
    try {
        await pool.query(`
            INSERT INTO user_achievements (user_id, username, achievement_id, achievement_key, progress, completed, completed_at)
            VALUES ($1, $6, $2, $7, $3, $4, $5)
            ON CONFLICT (user_id, achievement_id) DO UPDATE SET
                progress = GREATEST(user_achievements.progress, $3),
                completed = $4,
                completed_at = CASE WHEN $4 AND NOT user_achievements.completed THEN NOW() ELSE user_achievements.completed_at END,
                times_completed = CASE WHEN $4 AND NOT user_achievements.completed THEN user_achievements.times_completed + 1 ELSE user_achievements.times_completed END
        `, [userId, achievement.id, progress, completed, completedAt, username, achievement.code]);
        return true;
    } catch (err) {
        if (!completed) return false;
        try {
            await pool.query(`
                INSERT INTO user_achievements (username, achievement_key, achievement_id, progress, unlocked_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (username, achievement_key) DO UPDATE SET
                    progress = GREATEST(user_achievements.progress, $4),
                    achievement_id = COALESCE(user_achievements.achievement_id, $3)
            `, [username, achievement.code, achievement.id, progress]);
            return true;
        } catch (fallbackErr) {
            log.warn('Achievement progress write skipped', {
                code: fallbackErr.code || err.code,
                message: fallbackErr.message || err.message
            });
            return false;
        }
    }
}

async function awardAchievementCoins(userId, achievement) {
    try {
        await pool.query(
            `UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2`,
            [achievement.reward_coins, userId]
        );
        await pool.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [userId, achievement.reward_coins, 'achievement', `Ачівка: ${achievement.name}`, achievement.id]
        );
        return true;
    } catch (err) {
        log.warn('Achievement coin award skipped', { code: err.code, message: err.message });
        return false;
    }
}

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
            'SELECT * FROM achievements WHERE is_active = true ORDER BY category, rarity DESC LIMIT 500'
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
        const taskOwnerParams = [];
        const taskOwnerMatch = buildTaskOwnerMatch(req.user, taskOwnerParams, 't');

        // Get all active achievements not yet completed by user
        let uncompleted;
        try {
            uncompleted = await pool.query(`
                SELECT a.* FROM achievements a
                LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
                WHERE a.is_active = true AND (ua.completed IS NULL OR ua.completed = false)
                  AND a.type != 'repeatable'
            `, [userId]);
        } catch (err) {
            log.warn('Achievement check skipped: catalog schema unavailable', { code: err.code, message: err.message });
            return res.json({ awarded: [], count: 0 });
        }

        // v38.4.0: Batch all criteria data in parallel to prevent N+1 queries
        const [streakR, quizPlayR, quizPerfR, minigameR, bossR, walletR, roomR, tasksR, giftsR, taskDecompositionR] = await Promise.all([
            optionalAchievementQuery('game_streaks', 'SELECT MAX(best_count) as best FROM game_streaks WHERE user_id = $1', [userId], { best: 0 }),
            optionalAchievementQuery('quiz_sessions_play', "SELECT COUNT(*)::int as cnt FROM quiz_sessions WHERE user_id = $1 AND completed = true", [userId], { cnt: 0 }),
            optionalAchievementQuery('quiz_sessions_perfect', "SELECT COUNT(*)::int as cnt FROM quiz_sessions WHERE user_id = $1 AND completed = true AND correct_count = questions_count", [userId], { cnt: 0 }),
            optionalAchievementQuery('minigame_sessions', 'SELECT MAX(score) as best FROM minigame_sessions WHERE user_id = $1', [userId], { best: 0 }),
            optionalAchievementQuery('boss_rounds', "SELECT COUNT(*)::int as cnt FROM boss_rounds WHERE user_id = $1 AND completed = true", [userId], { cnt: 0 }),
            optionalAchievementQuery('game_wallets', 'SELECT total_earned FROM game_wallets WHERE user_id = $1', [userId], { total_earned: 0 }),
            optionalAchievementQuery('user_rooms', 'SELECT visitor_count, wallpaper_item_id, floor_item_id FROM user_rooms WHERE user_id = $1', [userId], {}),
            optionalAchievementQuery('task_completion', `
                SELECT
                    (
                        COUNT(*) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')})
                        + COALESCE(SUM(COALESCE(st.done, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)
                    )::int AS cnt,
                    COUNT(*) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')})::int AS parent_cnt,
                    COALESCE(SUM(COALESCE(st.done, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)::int AS subtask_cnt
                FROM tasks t
                LEFT JOIN (
                    SELECT task_id,
                           COUNT(*) FILTER (WHERE is_done = true)::int AS done
                    FROM task_subtasks
                    GROUP BY task_id
                ) st ON st.task_id = t.id
                WHERE ${taskOwnerMatch}
            `, taskOwnerParams, { cnt: 0, parent_cnt: 0, subtask_cnt: 0 }),
            optionalAchievementQuery('coin_transactions_gifts', "SELECT COUNT(*)::int as cnt FROM coin_transactions WHERE user_id = $1 AND type = 'gift' AND amount < 0", [userId], { cnt: 0 }),
            optionalAchievementQuery('task_decomposition', `
                SELECT
                    COUNT(DISTINCT t.id) FILTER (WHERE ${taskKpiEligibleSql('t')} AND COALESCE(st.total, 0) > 0)::int AS decomposed_tasks,
                    COUNT(DISTINCT t.id) FILTER (WHERE ${taskKpiEligibleSql('t')} AND COALESCE(st.total, 0) > 0 AND ${taskKpiCompletedSql('t')})::int AS decomposed_tasks_completed,
                    COALESCE(SUM(COALESCE(st.done, 0)) FILTER (WHERE ${taskKpiEligibleSql('t')}), 0)::int AS subtasks_completed,
                    COUNT(DISTINCT t.id) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')} AND COALESCE(st.ai_count, 0) > 0)::int AS ai_decomposed_tasks_completed,
                    COUNT(DISTINCT t.id) FILTER (WHERE ${taskKpiEligibleSql('t')} AND ${taskKpiCompletedSql('t')} AND COALESCE(st.template_count, 0) > 0)::int AS template_decomposed_tasks_completed
                FROM tasks t
                LEFT JOIN (
                    SELECT task_id,
                           COUNT(*)::int AS total,
                           COUNT(*) FILTER (WHERE is_done = true)::int AS done,
                           COUNT(*) FILTER (WHERE source_type = 'ai')::int AS ai_count,
                           COUNT(*) FILTER (WHERE source_type = 'template')::int AS template_count
                    FROM task_subtasks
                    GROUP BY task_id
                ) st ON st.task_id = t.id
                WHERE ${taskOwnerMatch}
            `, taskOwnerParams, {
                decomposed_tasks: 0,
                decomposed_tasks_completed: 0,
                subtasks_completed: 0,
                ai_decomposed_tasks_completed: 0,
                template_decomposed_tasks_completed: 0
            })
        ]);
        const taskDecomposition = taskDecompositionR.rows[0] || {};
        const criteria = {
            streak: streakR.rows[0]?.best || 0,
            quiz_play: quizPlayR.rows[0]?.cnt || 0,
            quiz_perfect: quizPerfR.rows[0]?.cnt || 0,
            minigame_score: minigameR.rows[0]?.best || 0,
            boss_win: bossR.rows[0]?.cnt || 0,
            total_earned: walletR.rows[0]?.total_earned || 0,
            room_decorate: (roomR.rows[0]?.wallpaper_item_id || roomR.rows[0]?.floor_item_id) ? 1 : 0,
            room_visitors: roomR.rows[0]?.visitor_count || 0,
            tasks_completed: tasksR.rows[0]?.cnt || 0,
            completed_parent_tasks: tasksR.rows[0]?.parent_cnt || 0,
            completed_subtasks: tasksR.rows[0]?.subtask_cnt || 0,
            decomposed_tasks: taskDecomposition.decomposed_tasks || 0,
            decomposed_tasks_completed: taskDecomposition.decomposed_tasks_completed || 0,
            subtasks_completed: taskDecomposition.subtasks_completed || 0,
            ai_decomposed_tasks_completed: taskDecomposition.ai_decomposed_tasks_completed || 0,
            template_decomposed_tasks_completed: taskDecomposition.template_decomposed_tasks_completed || 0,
            gift_sent: giftsR.rows[0]?.cnt || 0
        };

        for (const ach of uncompleted.rows) {
            const cond = ach.condition || {};
            let achieved = false;
            let progress = 0;

            if (cond.type === 'login') {
                progress = 1;
                achieved = true;
            } else if (cond.type === 'streak') {
                progress = criteria.streak;
                achieved = progress >= cond.count;
            } else if (cond.type === 'quiz_play') {
                progress = criteria.quiz_play;
                achieved = progress >= cond.count;
            } else if (cond.type === 'quiz_perfect') {
                progress = criteria.quiz_perfect;
                achieved = progress >= cond.count;
            } else if (cond.type === 'minigame_score') {
                progress = criteria.minigame_score;
                achieved = progress >= cond.count;
            } else if (cond.type === 'boss_win') {
                progress = criteria.boss_win;
                achieved = progress >= cond.count;
            } else if (cond.type === 'total_earned') {
                progress = criteria.total_earned;
                achieved = progress >= cond.count;
            } else if (cond.type === 'room_decorate') {
                progress = criteria.room_decorate;
                achieved = progress >= cond.count;
            } else if (cond.type === 'room_visitors') {
                progress = criteria.room_visitors;
                achieved = progress >= cond.count;
            } else if (cond.type === 'tasks_completed') {
                progress = criteria.tasks_completed;
                achieved = progress >= cond.count;
            } else if (cond.type === 'decomposed_tasks') {
                progress = criteria.decomposed_tasks;
                achieved = progress >= cond.count;
            } else if (cond.type === 'decomposed_tasks_completed') {
                progress = criteria.decomposed_tasks_completed;
                achieved = progress >= cond.count;
            } else if (cond.type === 'subtasks_completed') {
                progress = criteria.subtasks_completed;
                achieved = progress >= cond.count;
            } else if (cond.type === 'ai_decomposed_tasks_completed') {
                progress = criteria.ai_decomposed_tasks_completed;
                achieved = progress >= cond.count;
            } else if (cond.type === 'template_decomposed_tasks_completed') {
                progress = criteria.template_decomposed_tasks_completed;
                achieved = progress >= cond.count;
            } else if (cond.type === 'gift_sent') {
                progress = criteria.gift_sent;
                achieved = progress >= cond.count;
            } else if (cond.type === 'combo') {
                continue;
            } else if (cond.type === 'manual_award') {
                continue;
            } else if (cond.type === 'easter_egg' || cond.type === 'rare_drop' || cond.type === 'minigame_late') {
                continue;
            }

            // Update progress
            if (progress > 0 || achieved) {
                const progressWritten = await writeAchievementProgress({
                    userId,
                    username: req.user.username,
                    achievement: ach,
                    progress,
                    completed: achieved,
                    completedAt: achieved ? new Date() : null
                });

                if (achieved && progressWritten) {
                    // Award coins
                    await awardAchievementCoins(userId, ach);
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
