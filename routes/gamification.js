/**
 * routes/gamification.js — Gamification API (v22.2.0)
 *
 * Endpoints:
 *   GET  /api/gamification/profile/:username    — user profile + character + achievements
 *   PUT  /api/gamification/profile              — update own profile
 *   GET  /api/gamification/achievements         — achievement catalog
 *   POST /api/gamification/achievements/check   — trigger achievement check
 *   POST /api/gamification/achievements/unlock  — manually unlock (admin)
 *   GET  /api/gamification/shop                 — shop catalog
 *   POST /api/gamification/shop/buy             — purchase item
 *   POST /api/gamification/equip                — equip item
 *   POST /api/gamification/unequip              — unequip slot
 *   GET  /api/gamification/coins/history        — coin transactions
 *   POST /api/gamification/coins/gift           — gift coins
 *   POST /api/gamification/coins/award          — admin: award coins
 *   GET  /api/gamification/leaderboard          — leaderboard
 */
const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const gamification = require('../services/gamification');
const { createLogger } = require('../utils/logger');

const log = createLogger('GamificationAPI');

// GET /profile/:username — full profile
router.get('/profile/:username', async (req, res) => {
    try {
        const { username } = req.params;

        // Check if profile is public or user is viewing their own
        if (username !== req.user.username) {
            const { pool } = require('../db');
            const { rows } = await pool.query(
                'SELECT is_public FROM user_profiles_ext WHERE username = $1',
                [username]
            );
            if (rows.length > 0 && !rows[0].is_public) {
                return res.status(403).json({ error: 'Профіль приватний' });
            }
        }

        const profile = await gamification.getProfile(username);
        res.json(profile);
    } catch (err) {
        log.error('Get profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /profile — update own profile
router.put('/profile', async (req, res) => {
    try {
        const { display_name, bio, hobbies, avatar_url, is_public } = req.body;

        // Validate
        if (display_name && (typeof display_name !== 'string' || display_name.length > 100)) {
            return res.status(400).json({ error: 'Ім\'я занадто довге (макс 100)' });
        }
        if (bio && (typeof bio !== 'string' || bio.length > 500)) {
            return res.status(400).json({ error: 'Біо занадто довге (макс 500)' });
        }
        if (hobbies && (!Array.isArray(hobbies) || hobbies.length > 10)) {
            return res.status(400).json({ error: 'Максимум 10 хобі' });
        }
        if (avatar_url && (typeof avatar_url !== 'string' || avatar_url.length > 500 || !/^https?:\/\//.test(avatar_url))) {
            return res.status(400).json({ error: 'Невалідний URL аватарки' });
        }

        await gamification.updateProfile(req.user.username, {
            display_name, bio, hobbies, avatar_url, is_public
        });

        const profile = await gamification.getProfile(req.user.username);
        res.json(profile);
    } catch (err) {
        log.error('Update profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /achievements — catalog (with user unlock status)
router.get('/achievements', async (req, res) => {
    try {
        const achievements = await gamification.getAchievementCatalog(req.user.username);
        res.json(achievements);
    } catch (err) {
        log.error('Get achievements error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /achievements/check — trigger check for current user
router.post('/achievements/check', async (req, res) => {
    try {
        const unlocked = await gamification.checkAchievements(req.user.username);
        res.json({ unlocked });
    } catch (err) {
        log.error('Check achievements error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /achievements/unlock — admin: manually unlock achievement
router.post('/achievements/unlock', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        const { username, achievementKey } = req.body;
        if (!username || !achievementKey) {
            return res.status(400).json({ error: 'username та achievementKey обов\'язкові' });
        }

        const unlocked = await gamification.checkAchievements(username, { manualKey: achievementKey });
        res.json({ unlocked });
    } catch (err) {
        log.error('Unlock achievement error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /shop — shop catalog
router.get('/shop', async (req, res) => {
    try {
        const items = await gamification.getShopCatalog(req.user.username);
        res.json(items);
    } catch (err) {
        log.error('Get shop error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /shop/buy — purchase item
router.post('/shop/buy', async (req, res) => {
    try {
        const shopItemId = parseInt(req.body.shopItemId);
        if (!Number.isInteger(shopItemId) || shopItemId <= 0) {
            return res.status(400).json({ error: 'shopItemId обов\'язковий (позитивне число)' });
        }

        const result = await gamification.purchaseShopItem(req.user.username, shopItemId);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        log.error('Shop buy error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /equip — equip item
router.post('/equip', async (req, res) => {
    try {
        const itemId = parseInt(req.body.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ error: 'itemId обов\'язковий (позитивне число)' });
        }

        const result = await gamification.equipItem(req.user.username, itemId);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        log.error('Equip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /unequip — unequip slot
const VALID_SLOTS = ['wallpaper', 'floor', 'hat', 'frame', 'badge', 'pet', 'effect'];
router.post('/unequip', async (req, res) => {
    try {
        const { slot } = req.body;
        if (!slot || !VALID_SLOTS.includes(slot)) {
            return res.status(400).json({ error: `slot обов\'язковий (${VALID_SLOTS.join(', ')})` });
        }

        const result = await gamification.unequipSlot(req.user.username, slot);
        res.json(result);
    } catch (err) {
        log.error('Unequip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /coins/history — coin transaction history
router.get('/coins/history', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const history = await gamification.getCoinHistory(
            req.user.username,
            limit,
            offset
        );
        res.json(history);
    } catch (err) {
        log.error('Coin history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /coins/gift — gift coins to another user
router.post('/coins/gift', async (req, res) => {
    try {
        const { toUser } = req.body;
        const amount = parseInt(req.body.amount);
        if (!toUser || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
            return res.status(400).json({ error: 'toUser та amount (1-10000) обов\'язкові' });
        }
        if (toUser === req.user.username) {
            return res.status(400).json({ error: 'Не можна дарувати собі' });
        }

        const result = await gamification.giftCoins(req.user.username, toUser, amount);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        log.error('Gift coins error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /coins/award — admin: award coins
router.post('/coins/award', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        const { username, reason } = req.body;
        const amount = parseInt(req.body.amount);
        if (!username || !Number.isInteger(amount) || amount === 0 || amount < -10000 || amount > 10000) {
            return res.status(400).json({ error: 'username та amount (-10000..10000, не 0) обов\'язкові' });
        }

        await gamification.awardCoins(username, amount, reason || 'Нагорода від адміна', 'admin');
        res.json({ success: true });
    } catch (err) {
        log.error('Award coins error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /leaderboard — top users
router.get('/leaderboard', async (req, res) => {
    try {
        const VALID_SORTS = ['xp', 'coins', 'level', 'achievements'];
        const sort = VALID_SORTS.includes(req.query.sort) ? req.query.sort : 'xp';
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const leaderboard = await gamification.getLeaderboard(sort, limit);
        res.json(leaderboard);
    } catch (err) {
        log.error('Leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// MONTHLY LEADERBOARD (v30.8.0)
// ============================================================

const { pool } = require('../db');

// GET /leaderboard/monthly — monthly ranking
router.get('/leaderboard/monthly', async (req, res) => {
    try {
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || now.getMonth() + 1;
        const category = ['overall', 'bookings', 'tasks', 'xp', 'coins'].includes(req.query.category)
            ? req.query.category : 'overall';
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);

        const leaderboard = await gamification.getMonthlyLeaderboard(year, month, category, limit);
        res.json({ year, month, category, leaderboard });
    } catch (err) {
        log.error('Monthly leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /leaderboard/recalculate — admin: recalculate monthly leaderboard
router.post('/leaderboard/recalculate', requireRole('admin', 'creator'), async (req, res) => {
    try {
        const now = new Date();
        const year = parseInt(req.body.year) || now.getFullYear();
        const month = parseInt(req.body.month) || now.getMonth() + 1;
        const count = await gamification.recalculateMonthlyLeaderboard(year, month);
        res.json({ success: true, usersRanked: count });
    } catch (err) {
        log.error('Recalculate leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// SEASONAL QUESTS (v30.8.0)
// ============================================================

// GET /seasons — active seasonal quests with user progress
router.get('/seasons', async (req, res) => {
    try {
        const quests = await gamification.getSeasonalQuests(req.user.username);
        res.json(quests);
    } catch (err) {
        log.error('Get seasonal quests error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /seasons/check — update seasonal progress
router.post('/seasons/check', async (req, res) => {
    try {
        const updated = await gamification.checkSeasonalProgress(req.user.username);
        res.json({ updated });
    } catch (err) {
        log.error('Check seasonal progress error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /seasons/:id/claim — claim seasonal reward
router.post('/seasons/:id/claim', async (req, res) => {
    try {
        const questId = parseInt(req.params.id);
        if (!Number.isInteger(questId) || questId <= 0) {
            return res.status(400).json({ error: 'Невірний ID квесту' });
        }
        const result = await gamification.claimSeasonalReward(req.user.username, questId);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Claim seasonal reward error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// TEAMS & CHALLENGES (v30.8.0)
// ============================================================

// GET /teams — all teams with members
router.get('/teams', async (req, res) => {
    try {
        const teams = await gamification.getTeams();
        const userTeam = await gamification.getUserTeam(req.user.username);
        res.json({ teams, userTeamId: userTeam?.id || null });
    } catch (err) {
        log.error('Get teams error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /teams/:id/join — join a team
router.post('/teams/:id/join', async (req, res) => {
    try {
        const teamId = parseInt(req.params.id);
        if (!Number.isInteger(teamId) || teamId <= 0) {
            return res.status(400).json({ error: 'Невірний ID команди' });
        }
        const result = await gamification.joinTeam(req.user.username, teamId);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Join team error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /teams/leave — leave current team
router.post('/teams/leave', async (req, res) => {
    try {
        const result = await gamification.leaveTeam(req.user.username);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Leave team error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /challenges — active team challenges
router.get('/challenges', async (req, res) => {
    try {
        const challenges = await gamification.getTeamChallenges(req.user.username);
        res.json(challenges);
    } catch (err) {
        log.error('Get challenges error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /challenges/recalculate — admin: recalculate team challenge scores
router.post('/challenges/recalculate', requireRole('admin', 'creator'), async (req, res) => {
    try {
        await gamification.recalculateTeamChallenges();
        res.json({ success: true });
    } catch (err) {
        log.error('Recalculate challenges error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// REFERRAL SYSTEM (v30.8.0)
// ============================================================

// GET /referral — get own referral code and stats
router.get('/referral', async (req, res) => {
    try {
        const stats = await gamification.getReferralStats(req.user.username);
        res.json(stats);
    } catch (err) {
        log.error('Get referral error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /referral/apply — apply a referral code
router.post('/referral/apply', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string' || code.length < 3 || code.length > 20) {
            return res.status(400).json({ error: 'Невірний реферальний код' });
        }
        const result = await gamification.applyReferralCode(req.user.username, code);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Apply referral error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /referral/check — check pending referral rewards
router.post('/referral/check', async (req, res) => {
    try {
        const result = await gamification.checkReferralReward(req.user.username);
        res.json(result);
    } catch (err) {
        log.error('Check referral error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// BONUS REDEMPTIONS (v30.8.0)
// ============================================================

// GET /redemptions — own redemption history (or all for admin)
router.get('/redemptions', async (req, res) => {
    try {
        const isAdmin = ['admin', 'creator', 'director'].includes(req.user.role);
        const redemptions = await gamification.getRedemptions(req.user.username, isAdmin && req.query.all === 'true');
        res.json(redemptions);
    } catch (err) {
        log.error('Get redemptions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /redemptions/:id — admin: update redemption status
router.put('/redemptions/:id', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        const { status, adminNote } = req.body;
        const result = await gamification.updateRedemption(
            parseInt(req.params.id), status, adminNote, req.user.username
        );
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Update redemption error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// STREAK FREEZE (v30.8.0)
// ============================================================

// POST /streak/freeze — purchase streak freeze (50 coins, 1/week)
router.post('/streak/freeze', async (req, res) => {
    try {
        const result = await gamification.purchaseStreakFreeze(req.user.username);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        log.error('Streak freeze error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// PENALTY POINTS SYSTEM (v25.4.0)
// ============================================================

// POST /penalty — issue penalty points (manager+)
router.post('/penalty', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const { username, points, reason, category, meetingDate } = req.body;
        if (!username || !reason) {
            return res.status(400).json({ error: 'username та reason обов\'язкові' });
        }
        const penaltyPoints = Math.max(1, Math.min(parseInt(points) || 1, 100));
        const validCategories = ['discipline', 'initiative', 'quality', 'attendance', 'safety'];
        const cat = validCategories.includes(category) ? category : 'discipline';

        const result = await pool.query(
            `INSERT INTO staff_penalties (staff_username, points, reason, category, issued_by, meeting_date)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [username, penaltyPoints, reason, cat, req.user.username, meetingDate || null]
        );

        // Deduct coins
        try {
            await gamification.awardCoins(username, -penaltyPoints * 5, `Штраф: ${reason}`, 'penalty');
        } catch (e) { /* wallet may not exist */ }

        log.info(`Penalty ${penaltyPoints} pts to ${username} by ${req.user.username}: ${reason}`);
        res.json({ success: true, penalty: result.rows[0] });
    } catch (err) {
        log.error('Create penalty error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /penalties/:username — penalty history
router.get('/penalties/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const result = await pool.query(
            `SELECT * FROM staff_penalties WHERE staff_username = $1 ORDER BY created_at DESC LIMIT 50`,
            [username]
        );
        const totalResult = await pool.query(
            `SELECT COALESCE(SUM(CASE WHEN reversed = false THEN points ELSE 0 END), 0) AS total_points
             FROM staff_penalties WHERE staff_username = $1`,
            [username]
        );
        res.json({
            penalties: result.rows,
            totalPoints: parseInt(totalResult.rows[0].total_points)
        });
    } catch (err) {
        log.error('Get penalties error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /penalty/:id/reverse — reverse a penalty (director+)
router.post('/penalty/:id/reverse', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE staff_penalties SET reversed = true, reversed_by = $1, reversed_at = NOW()
             WHERE id = $2 AND reversed = false RETURNING *`,
            [req.user.username, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Штраф не знайдено або вже скасовано' });
        }
        // Refund coins
        const penalty = result.rows[0];
        try {
            await gamification.awardCoins(penalty.staff_username, penalty.points * 5, 'Скасування штрафу', 'penalty_reverse');
        } catch (e) { /* ok */ }

        res.json({ success: true, penalty: result.rows[0] });
    } catch (err) {
        log.error('Reverse penalty error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /penalty-stats — aggregate penalty statistics
router.get('/penalty-stats', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT staff_username, category,
                   SUM(CASE WHEN reversed = false THEN points ELSE 0 END) AS total_points,
                   COUNT(*) AS total_count
            FROM staff_penalties
            GROUP BY staff_username, category
            ORDER BY total_points DESC
        `);
        res.json({ stats: result.rows });
    } catch (err) {
        log.error('Penalty stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
