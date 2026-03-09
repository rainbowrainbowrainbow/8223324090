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

module.exports = router;
