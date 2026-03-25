/**
 * routes/streaks.js — Multi-type Streak System
 * v22.10.0
 *
 * Tracks daily activity streaks for: minigame, task, booking, quiz, login
 * Rewards bonus coins at milestones (3, 7, 14, 30 days)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Streaks');

const STREAK_MILESTONES = [
    { days: 3, coins: 15, label: '3 дні поспіль' },
    { days: 7, coins: 40, label: '7 днів поспіль' },
    { days: 14, coins: 100, label: '14 днів поспіль' },
    { days: 30, coins: 300, label: '30 днів поспіль' },
];

const STREAK_TYPES = {
    minigame: { icon: '🎮', label: 'Ігровий' },
    task: { icon: '✅', label: 'Завдання' },
    booking: { icon: '📋', label: 'Бронювання' },
    quiz: { icon: '🧠', label: 'Вікторина' },
    login: { icon: '📅', label: 'Вхід' }
};

/**
 * Update streak for a specific type.
 * Called from other routes when user performs the action.
 * Returns { current, best, milestone } or null
 */
async function updateStreak(userId, streakType) {
    if (!STREAK_TYPES[streakType]) return null;

    try {
        const today = new Date().toISOString().split('T')[0];

        // v38.4.0: Upsert with atomic streak logic to prevent race conditions
        const { rows } = await pool.query(
            `INSERT INTO game_streaks (user_id, streak_type, current_count, best_count, last_date)
             VALUES ($1, $2, 1, 1, $3)
             ON CONFLICT (user_id, streak_type) DO UPDATE SET
                current_count = CASE
                    WHEN game_streaks.last_date::date = $3::date THEN game_streaks.current_count
                    WHEN game_streaks.last_date::date = ($3::date - 1) THEN game_streaks.current_count + 1
                    ELSE 1
                END,
                best_count = GREATEST(game_streaks.best_count, CASE
                    WHEN game_streaks.last_date::date = $3::date THEN game_streaks.current_count
                    WHEN game_streaks.last_date::date = ($3::date - 1) THEN game_streaks.current_count + 1
                    ELSE 1
                END),
                last_date = $3,
                updated_at = NOW()
             RETURNING current_count, best_count, (xmax = 0) AS was_insert`,
            [userId, streakType, today]
        );

        const current = rows[0]?.current_count || 1;
        const best = rows[0]?.best_count || 1;
        let milestone = null;

        // Check milestones
        for (const m of STREAK_MILESTONES) {
            if (current === m.days) {
                milestone = m;
                // Award bonus coins
                try {
                    await pool.query(
                        'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
                        [m.coins, userId]
                    );
                    await pool.query(
                        'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                        [userId, m.coins, 'streak', `${STREAK_TYPES[streakType].label} streak: ${m.label} (+${m.coins} монет)`]
                    );
                    log.info(`Streak milestone: user ${userId}, ${streakType} ${m.days} days, +${m.coins} coins`);
                } catch (e) {
                    log.error('Streak milestone reward error', e);
                }
                break;
            }
        }

        return { current, best, milestone };
    } catch (err) {
        log.error('Update streak error', err);
        return null;
    }
}

// GET /api/streaks — all streaks for current user
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM game_streaks WHERE user_id = $1 ORDER BY streak_type',
            [req.user.id]
        );

        const streaks = {};
        for (const type of Object.keys(STREAK_TYPES)) {
            const s = rows.find(r => r.streak_type === type);
            const today = new Date().toISOString().split('T')[0];
            const lastDate = s?.last_date ? new Date(s.last_date).toISOString().split('T')[0] : null;

            // Check if streak is still active (did something today or yesterday)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            const isActive = lastDate === today || lastDate === yesterdayStr;

            streaks[type] = {
                ...STREAK_TYPES[type],
                current: isActive ? (s?.current_count || 0) : 0,
                best: s?.best_count || 0,
                lastDate: s?.last_date || null,
                activeToday: lastDate === today,
                nextMilestone: getNextMilestone(isActive ? (s?.current_count || 0) : 0)
            };
        }

        res.json(streaks);
    } catch (err) {
        log.error('Get streaks error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function getNextMilestone(current) {
    for (const m of STREAK_MILESTONES) {
        if (current < m.days) return m;
    }
    return null;
}

// GET /api/streaks/leaderboard — best streakers
router.get('/leaderboard', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const type = req.query.type || 'login';
        const { rows } = await pool.query(`
            SELECT gs.user_id, gs.current_count, gs.best_count, u.name, u.username
            FROM game_streaks gs
            JOIN users u ON u.id = gs.user_id
            WHERE gs.streak_type = $1
            ORDER BY gs.best_count DESC
            LIMIT 10
        `, [type]);

        res.json(rows.map(r => ({
            userId: r.user_id,
            name: r.name || r.username,
            current: r.current_count,
            best: r.best_count
        })));
    } catch (err) {
        log.error('Streak leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
module.exports.updateStreak = updateStreak;
