/**
 * routes/minigame.js — Minigame API (match-3 sessions, anti-farm, daily records, boss rounds)
 * v22.10.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Minigame');

const { updateQuestProgress } = require('./quests');
const { updateStreak } = require('./streaks');

const ANY_ROLE = ['admin', 'user', 'animator', 'instructor', 'waiter', 'senior_instructor', 'manager', 'senior_manager', 'vice_director', 'director', 'creator'];
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const MAX_DAILY = 5;
const MAX_COINS_PER_GAME = 50;

// GET /api/minigame/status — can I play?
router.get('/status', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        // Last game
        const last = await pool.query(
            "SELECT played_at FROM minigame_sessions WHERE user_id = $1 ORDER BY played_at DESC LIMIT 1",
            [req.user.id]
        );
        // Today's count
        const today = await pool.query(
            "SELECT COUNT(*) FROM minigame_sessions WHERE user_id = $1 AND played_at >= CURRENT_DATE",
            [req.user.id]
        );
        // Best score
        const best = await pool.query(
            "SELECT MAX(coins_earned) as best FROM minigame_sessions WHERE user_id = $1",
            [req.user.id]
        );

        const lastPlayed = last.rows[0]?.played_at;
        const todayCount = parseInt(today.rows[0].count);
        const cooldownLeft = lastPlayed ? Math.max(0, COOLDOWN_MS - (Date.now() - new Date(lastPlayed).getTime())) : 0;
        const canPlay = todayCount < MAX_DAILY && cooldownLeft === 0;

        res.json({
            canPlay,
            cooldownLeft: Math.ceil(cooldownLeft / 1000),
            todayGames: todayCount,
            maxDaily: MAX_DAILY,
            bestScore: best.rows[0]?.best || 0
        });
    } catch (err) {
        log.error('Minigame status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/minigame/complete — submit game result
router.post('/complete', requireRole(...ANY_ROLE), async (req, res) => {
    const { score, coins_earned } = req.body;
    if (typeof score !== 'number' || typeof coins_earned !== 'number') {
        return res.status(400).json({ error: 'score та coins_earned обов\'язкові' });
    }

    // Server-side anti-cheat: cap coins
    const sanitizedCoins = Math.min(Math.max(0, Math.floor(coins_earned)), MAX_COINS_PER_GAME);

    try {
        // Anti-farm checks
        const last = await pool.query(
            "SELECT played_at FROM minigame_sessions WHERE user_id = $1 ORDER BY played_at DESC LIMIT 1",
            [req.user.id]
        );
        if (last.rows.length > 0) {
            const elapsed = Date.now() - new Date(last.rows[0].played_at).getTime();
            if (elapsed < COOLDOWN_MS) {
                return res.status(429).json({ error: 'Кулдаун ще не закінчився' });
            }
        }

        const today = await pool.query(
            "SELECT COUNT(*) FROM minigame_sessions WHERE user_id = $1 AND played_at >= CURRENT_DATE",
            [req.user.id]
        );
        if (parseInt(today.rows[0].count) >= MAX_DAILY) {
            return res.status(429).json({ error: 'Повернись завтра! 🦕' });
        }

        // Record session
        await pool.query(
            'INSERT INTO minigame_sessions (user_id, score, coins_earned) VALUES ($1, $2, $3)',
            [req.user.id, score, sanitizedCoins]
        );

        // Track quest progress (fire-and-forget)
        updateQuestProgress(req.user.id, 'play_minigame').catch(() => {});

        // Award coins
        if (sanitizedCoins > 0) {
            await pool.query(
                'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
                [sanitizedCoins, req.user.id]
            );
            await pool.query(
                'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                [req.user.id, sanitizedCoins, 'minigame', `Міні-гра: ${sanitizedCoins} монет (рахунок: ${score})`]
            );
        }

        // Update minigame streak (fire-and-forget)
        updateStreak(req.user.id, 'minigame').catch(() => {});

        res.json({ success: true, coinsAwarded: sanitizedCoins });
    } catch (err) {
        log.error('Minigame complete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/minigame/daily-records — today's top scores + personal best today
router.get('/daily-records', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        // Top 3 today
        const top3 = await pool.query(`
            SELECT ms.score, ms.coins_earned, ms.played_at, u.name, u.username
            FROM minigame_sessions ms
            JOIN users u ON u.id = ms.user_id
            WHERE ms.played_at >= CURRENT_DATE
            ORDER BY ms.score DESC
            LIMIT 3
        `);

        // My best today
        const myBest = await pool.query(
            "SELECT MAX(score) as best_score, MAX(coins_earned) as best_coins FROM minigame_sessions WHERE user_id = $1 AND played_at >= CURRENT_DATE",
            [req.user.id]
        );

        // My all-time best
        const allTimeBest = await pool.query(
            "SELECT MAX(score) as best_score FROM minigame_sessions WHERE user_id = $1",
            [req.user.id]
        );

        res.json({
            top3: top3.rows.map((r, i) => ({
                rank: i + 1,
                name: r.name || r.username,
                score: r.score,
                coins: r.coins_earned,
                time: r.played_at
            })),
            myBestToday: myBest.rows[0]?.best_score || 0,
            myBestAllTime: allTimeBest.rows[0]?.best_score || 0
        });
    } catch (err) {
        log.error('Daily records error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/minigame/boss — boss round status for this week
router.get('/boss', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const weekStart = getWeekStart();
        const boss = await pool.query(
            'SELECT * FROM boss_rounds WHERE user_id = $1 AND week_start = $2',
            [req.user.id, weekStart]
        );

        // Check if it's boss day (Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sunday
        const isBossDay = dayOfWeek === 0;

        res.json({
            isBossDay,
            weekStart,
            targetScore: 300,
            played: boss.rows.length > 0,
            completed: boss.rows[0]?.completed || false,
            score: boss.rows[0]?.score || 0,
            coinsEarned: boss.rows[0]?.coins_earned || 0
        });
    } catch (err) {
        log.error('Boss status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/minigame/boss/complete — submit boss round result
router.post('/boss/complete', requireRole(...ANY_ROLE), async (req, res) => {
    const { score } = req.body;
    if (typeof score !== 'number') {
        return res.status(400).json({ error: 'score обов\'язковий' });
    }

    try {
        const weekStart = getWeekStart();
        const now = new Date();
        const dayOfWeek = now.getDay();

        if (dayOfWeek !== 0) {
            return res.status(400).json({ error: 'Бос-раунд доступний тільки в неділю!' });
        }

        // Check if already played this week
        const existing = await pool.query(
            'SELECT * FROM boss_rounds WHERE user_id = $1 AND week_start = $2',
            [req.user.id, weekStart]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Бос-раунд вже зіграний цього тижня' });
        }

        const TARGET_SCORE = 300;
        const completed = score >= TARGET_SCORE;
        const coinsEarned = completed ? Math.min(Math.floor(score / 10) * 3, 150) : 0; // x3 rewards, cap 150

        await pool.query(
            'INSERT INTO boss_rounds (user_id, week_start, score, target_score, coins_earned, completed) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, weekStart, score, TARGET_SCORE, coinsEarned, completed]
        );

        // Award coins for boss
        if (coinsEarned > 0) {
            await pool.query(
                'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
                [coinsEarned, req.user.id]
            );
            await pool.query(
                'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                [req.user.id, coinsEarned, 'boss_round', `Бос-раунд: ${score} очок (x3 нагорода: +${coinsEarned} монет)`]
            );
        }

        res.json({ success: true, completed, score, coinsEarned, targetScore: TARGET_SCORE });
    } catch (err) {
        log.error('Boss complete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now);
    monday.setDate(diff);
    return monday.toISOString().split('T')[0];
}

// POST /api/minigame/reset — admin: reset cooldown and daily limit for testing
router.post('/reset', requireRole('admin', 'creator'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM minigame_sessions WHERE user_id = $1',
            [req.user.id]
        );
        log.info(`Minigame reset for user ${req.user.id} by ${req.user.username}`);
        res.json({ success: true, message: 'Кулдаун і ліміт скинуті' });
    } catch (err) {
        log.error('Minigame reset error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
