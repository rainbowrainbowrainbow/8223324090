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
        if (display_name && display_name.length > 100) {
            return res.status(400).json({ error: 'Ім\'я занадто довге (макс 100)' });
        }
        if (bio && bio.length > 500) {
            return res.status(400).json({ error: 'Біо занадто довге (макс 500)' });
        }
        if (hobbies && (!Array.isArray(hobbies) || hobbies.length > 10)) {
            return res.status(400).json({ error: 'Максимум 10 хобі' });
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
        const { shopItemId } = req.body;
        if (!shopItemId) {
            return res.status(400).json({ error: 'shopItemId обов\'язковий' });
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
        const { itemId } = req.body;
        if (!itemId) {
            return res.status(400).json({ error: 'itemId обов\'язковий' });
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
router.post('/unequip', async (req, res) => {
    try {
        const { slot } = req.body;
        if (!slot) {
            return res.status(400).json({ error: 'slot обов\'язковий' });
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
        const { limit = 50, offset = 0 } = req.query;
        const history = await gamification.getCoinHistory(
            req.user.username,
            parseInt(limit) || 50,
            parseInt(offset) || 0
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
        const { toUser, amount } = req.body;
        if (!toUser || !amount) {
            return res.status(400).json({ error: 'toUser та amount обов\'язкові' });
        }
        if (toUser === req.user.username) {
            return res.status(400).json({ error: 'Не можна дарувати собі' });
        }

        const result = await gamification.giftCoins(req.user.username, toUser, parseInt(amount));
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
        const { username, amount, reason } = req.body;
        if (!username || !amount) {
            return res.status(400).json({ error: 'username та amount обов\'язкові' });
        }

        await gamification.awardCoins(username, parseInt(amount), reason || 'Нагорода від адміна', 'admin');
        res.json({ success: true });
    } catch (err) {
        log.error('Award coins error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /leaderboard — top users
router.get('/leaderboard', async (req, res) => {
    try {
        const { sort = 'xp', limit = 20 } = req.query;
        const leaderboard = await gamification.getLeaderboard(sort, parseInt(limit) || 20);
        res.json(leaderboard);
    } catch (err) {
        log.error('Leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
