/**
 * routes/minigame.js — Minigame API (match-3 sessions, anti-farm)
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Minigame');

const { updateQuestProgress } = require('./quests');

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

        res.json({ success: true, coinsAwarded: sanitizedCoins });
    } catch (err) {
        log.error('Minigame complete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
